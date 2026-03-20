import React, { useState, useRef, useCallback, useEffect } from "react";
import Svg, { Circle, G, Text as SvgText } from "react-native-svg";
import { VehicleDiagramImage } from "@/components/vehicle-diagram-svg";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  FlatList,
  Alert,
  Modal,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { cameraSessionStore } from "@/lib/camera-session-store";
import { stampPhotoViaServer } from "@/lib/stamp-photo-client";
import { photoQueue } from "@/lib/photo-queue";
import type { Damage, DamageType, DamageSeverity, DamageZone, AdditionalInspection } from "@/lib/data";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const MAIN_IMAGE_HEIGHT = SCREEN_WIDTH * 1.15;
const THUMB_SIZE = 72;
const THUMB_GAP = 8;

// ─── Damage constants ─────────────────────────────────────────────────────────

const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  scratch: "Scratch",
  multiple_scratches: "Multi-Scratch",
  dent: "Dent",
  chip: "Chip",
  crack: "Crack",
  broken: "Broken",
  missing: "Missing",
  other: "Other",
};

const DAMAGE_TYPES: { key: DamageType; label: string }[] = [
  { key: "scratch", label: "Scratch" },
  { key: "multiple_scratches", label: "Multi-Scratch" },
  { key: "dent", label: "Dent" },
  { key: "chip", label: "Chipped" },
  { key: "crack", label: "Crack" },
  { key: "broken", label: "Broken" },
  { key: "missing", label: "Missing" },
  { key: "other", label: "Other" },
];

const DAMAGE_SEVERITIES: DamageSeverity[] = ["minor", "moderate", "severe"];

const SEVERITY_COLORS: Record<DamageSeverity, string> = {
  minor: "#22C55E",
  moderate: "#F59E0B",
  severe: "#EF4444",
};

const SEV_COLORS: Record<string, string> = {
  severe: "#EF4444",
  moderate: "#F59E0B",
  minor: "#22C55E",
};

const ZONE_LABELS: Record<string, string> = {
  front: "Front Bumper",
  rear: "Rear Bumper",
  hood: "Hood",
  trunk: "Trunk",
  roof: "Roof",
  windshield: "Windshield",
  rear_windshield: "Rear Windshield",
  fl_fender: "F.L Fender",
  fr_fender: "F.R Fender",
  fl_door: "F.L Door",
  rl_door: "R.L Door",
  fr_door: "F.R Door",
  rr_door: "R.R Door",
  rl_panel: "R.L Quarter Panel",
  rr_panel: "R.R Quarter Panel",
  driver_front_wheel: "F.L Wheel",
  driver_rear_wheel: "R.L Wheel",
  passenger_front_wheel: "F.R Wheel",
  passenger_rear_wheel: "R.R Wheel",
  driver_side: "Driver Side",
  passenger_side: "Pass. Side",
};

// ─── Zone inference helpers ───────────────────────────────────────────────────

type DiagramView = "top" | "side";

/** Top-down view (y 0–38%): driver's side from above. LEFT = REAR, RIGHT = FRONT */
function inferZoneTop(xPct: number, yPct: number): DamageZone {
  const relY = (yPct / 38) * 100;
  if (relY < 40 && xPct >= 12 && xPct < 28) return "driver_rear_wheel";
  if (relY < 40 && xPct >= 72 && xPct < 88) return "driver_front_wheel";
  if (xPct < 7) return "rear";
  if (xPct > 88) return "front";
  if (xPct < 22) return "rl_panel";
  if (xPct < 42) return "rl_door";
  if (xPct < 62) return "fl_door";
  if (xPct <= 88) return "fl_fender";
  return "roof";
}

/** Body/roof strip (y 38–55%): LEFT = REAR, RIGHT = FRONT */
function inferZoneMiddle(xPct: number): DamageZone {
  if (xPct < 7) return "rear";
  if (xPct > 88) return "front";
  if (xPct < 20) return "trunk";
  if (xPct < 37) return "rear_windshield";
  if (xPct < 58) return "roof";
  if (xPct < 72) return "windshield";
  if (xPct <= 88) return "hood";
  return "roof";
}

/** Side view (y 55–100%): passenger side. LEFT = REAR, RIGHT = FRONT */
function inferZoneBottom(xPct: number, yPct: number): DamageZone {
  const relY = ((yPct - 55) / 45) * 100;
  if (relY < 12) return "roof";
  if (relY > 70 && xPct >= 10 && xPct < 30) return "passenger_rear_wheel";
  if (relY > 70 && xPct >= 65 && xPct < 88) return "passenger_front_wheel";
  if (xPct < 8) return "rear";
  if (xPct > 82) return "front";
  if (xPct < 22) return "rr_panel";
  if (xPct < 45) return "rr_door";
  if (xPct < 62) return "fr_door";
  if (xPct <= 82) return "fr_fender";
  return "roof";
}

// ─── VehicleDiagram component ─────────────────────────────────────────────────

function VehicleDiagram({
  damages,
  noDamage,
  onDiagramTap,
  onNoDamageToggle,
  onPinTap,
}: {
  damages: Damage[];
  noDamage: boolean;
  onDiagramTap?: (xPct: number, yPct: number, view: DiagramView, zone: DamageZone) => void;
  onNoDamageToggle?: () => void;
  onPinTap?: (damage: Damage) => void;
}) {
  const colors = useColors();
  const W = 320;
  const H = Math.round(W / (990 / 751));

  const handleTap = (evt: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!onDiagramTap) return;
    const { locationX, locationY } = evt.nativeEvent;
    const xPct = Math.max(0, Math.min(100, (locationX / W) * 100));
    const yPct = Math.max(0, Math.min(100, (locationY / H) * 100));
    let zone: DamageZone;
    let view: DiagramView;
    if (yPct < 38) {
      zone = inferZoneTop(xPct, yPct);
      view = "top";
    } else if (yPct < 55) {
      zone = inferZoneMiddle(xPct);
      view = "top";
    } else {
      zone = inferZoneBottom(xPct, yPct);
      view = "side";
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDiagramTap(xPct, yPct, view, zone);
  };

  return (
    <View style={[ds.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[ds.cardSub, { color: colors.muted, marginBottom: 12 }]}>
        {onDiagramTap ? "Tap anywhere on the vehicle to mark a damage location" : "View only — inspection is locked"}
      </Text>
      <TouchableOpacity activeOpacity={1} onPress={handleTap} style={[ds.svgWrap, { backgroundColor: "#fff", borderColor: colors.border }]}>
        <VehicleDiagramImage width={W} />
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", top: 0, left: 0 }}>
          {damages.map((d, idx) => {
            if (d.xPct == null || d.yPct == null) return null;
            const cx = (d.xPct / 100) * W;
            const cy = (d.yPct / 100) * H;
            const pinColor = SEV_COLORS[d.severity] ?? "#F59E0B";
            const hasPhotos = d.photos && d.photos.length > 0;
            return (
              <G key={d.id} onPress={hasPhotos && onPinTap ? () => onPinTap(d) : undefined}>
                <Circle cx={cx} cy={cy} r={18} fill={pinColor} opacity={0.15} />
                <Circle cx={cx} cy={cy} r={12} fill={pinColor} opacity={0.95} />
                <Circle cx={cx - 3} cy={cy - 3} r={4} fill="white" opacity={0.25} />
                {hasPhotos && <Circle cx={cx + 8} cy={cy - 8} r={5} fill="#3B82F6" opacity={1} />}
                <SvgText x={cx} y={cy + 4.5} textAnchor="middle" fill="white" fontSize={10} fontWeight="bold">
                  {idx + 1}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onNoDamageToggle}
        activeOpacity={onNoDamageToggle ? 0.8 : 1}
        disabled={!onNoDamageToggle}
        style={[
          ds.noDamageBtn,
          noDamage
            ? { backgroundColor: "#22C55E", borderColor: "#16A34A" }
            : { backgroundColor: colors.background, borderColor: colors.border },
          !onNoDamageToggle && { opacity: 0.7 },
        ]}
      >
        <Text style={[ds.noDamageBtnText, { color: noDamage ? "#fff" : colors.muted }]}>
          {noDamage ? "✓  No Damage Confirmed" : "Vehicle Has No Damage"}
        </Text>
      </TouchableOpacity>

      {!noDamage && (
        <View style={ds.legend}>
          {Object.entries(SEV_COLORS).map(([sev, col]) => (
            <View key={sev} style={ds.legendItem}>
              <View style={[ds.legendDot, { backgroundColor: col }]} />
              <Text style={[ds.legendLabel, { color: colors.muted }]}>
                {sev.charAt(0).toUpperCase() + sev.slice(1)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const ds = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardSub: { fontSize: 11, marginTop: 2 },
  svgWrap: {
    alignSelf: "center",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  noDamageBtn: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  noDamageBtnText: { fontSize: 14, fontWeight: "600" },
  legend: { flexDirection: "row", justifyContent: "center", gap: 18, paddingTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontWeight: "500" },
});

// ─── DamageModal component ────────────────────────────────────────────────────

function DamageModal({
  visible,
  zone,
  existingDamages,
  onClose,
  onSave,
  pendingXPct,
  pendingYPct,
  pendingView,
}: {
  visible: boolean;
  zone: DamageZone | null;
  existingDamages: Damage[];
  onClose: () => void;
  onSave: (damage: Damage, photos: string[]) => void;
  pendingXPct?: number;
  pendingYPct?: number;
  pendingView?: "top" | "side_driver";
}) {
  const colors = useColors();
  const [type, setType] = useState<DamageType>("scratch");
  const [severity, setSeverity] = useState<DamageSeverity>("minor");
  const [description, setDescription] = useState("");
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);
  const [pickingPhoto, setPickingPhoto] = useState(false);

  const zoneLabel = ZONE_LABELS[zone ?? ""] ?? zone ?? "Vehicle";

  useEffect(() => {
    if (!visible) {
      setType("scratch");
      setSeverity("minor");
      setDescription("");
      setDamagePhotos([]);
    }
  }, [visible]);

  const handleTakePhoto = async () => {
    setPickingPhoto(true);
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });  // No compression
      if (!result.canceled && result.assets?.[0]) {
        setDamagePhotos((prev) => [...prev, result.assets[0].uri]);
      }
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleSave = () => {
    if (!zone) return;
    const damage: Damage = {
      id: Date.now().toString(),
      zone,
      type,
      severity,
      description,
      photos: damagePhotos,
      xPct: pendingXPct,
      yPct: pendingYPct,
      diagramView: pendingView,
    };
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave(damage, damagePhotos);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={ms.overlay}>
        <View style={[ms.sheet, { backgroundColor: colors.surface }]}>
          <View style={[ms.handle, { backgroundColor: colors.border }]} />
          <Text style={[ms.title, { color: colors.foreground }]}>Mark Damage — {zoneLabel}</Text>

          {existingDamages.length > 0 && (
            <View style={[ms.existingBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[ms.existingLabel, { color: colors.muted }]}>EXISTING DAMAGES IN THIS ZONE</Text>
              {existingDamages.map((d) => (
                <Text key={d.id} style={[ms.existingItem, { color: colors.foreground }]}>
                  • {d.type} ({d.severity}){d.description ? `: ${d.description}` : ""}
                </Text>
              ))}
            </View>
          )}

          <Text style={[ms.fieldLabel, { color: colors.muted }]}>DAMAGE TYPE</Text>
          <View style={ms.chipRow}>
            {DAMAGE_TYPES.map((dt) => (
              <TouchableOpacity
                key={dt.key}
                style={[ms.chip, { borderColor: colors.border, backgroundColor: colors.background }, type === dt.key && { borderColor: colors.primary, backgroundColor: colors.primary + "18" }]}
                onPress={() => setType(dt.key)}
                activeOpacity={0.7}
              >
                <Text style={[ms.chipText, { color: type === dt.key ? colors.primary : colors.muted }]}>{dt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[ms.fieldLabel, { color: colors.muted }]}>SEVERITY</Text>
          <View style={ms.chipRow}>
            {DAMAGE_SEVERITIES.map((sv) => {
              const sColor = sv === "severe" ? colors.error : colors.warning;
              return (
                <TouchableOpacity
                  key={sv}
                  style={[ms.chip, { borderColor: colors.border, backgroundColor: colors.background }, severity === sv && { borderColor: sColor, backgroundColor: sColor + "18" }]}
                  onPress={() => setSeverity(sv)}
                  activeOpacity={0.7}
                >
                  <Text style={[ms.chipText, { color: severity === sv ? sColor : colors.muted }]}>
                    {sv.charAt(0).toUpperCase() + sv.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[ms.fieldLabel, { color: colors.muted }]}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[ms.notesInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Describe the damage..."
            placeholderTextColor={colors.muted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={2}
          />

          <Text style={[ms.fieldLabel, { color: colors.muted }]}>DAMAGE PHOTOS (OPTIONAL)</Text>
          <View style={ms.photoRow}>
            <TouchableOpacity
              style={[ms.photoAddBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={handleTakePhoto}
              activeOpacity={0.7}
              disabled={pickingPhoto}
            >
              <Text style={{ fontSize: 22, color: colors.muted }}>📷</Text>
              <Text style={[ms.photoAddText, { color: colors.muted }]}>
                {damagePhotos.length > 0 ? `${damagePhotos.length} photo${damagePhotos.length > 1 ? "s" : ""}` : "Add Photos"}
              </Text>
            </TouchableOpacity>
            {damagePhotos.map((uri, idx) => (
              <View key={idx} style={ms.photoThumb}>
                <Image source={{ uri }} style={ms.photoThumbImg} />
                <TouchableOpacity style={ms.photoRemove} onPress={() => setDamagePhotos((prev) => prev.filter((_, i) => i !== idx))}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={ms.actions}>
            <TouchableOpacity style={[ms.cancelBtn, { borderColor: colors.border }]} onPress={onClose} activeOpacity={0.7}>
              <Text style={[ms.cancelText, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ms.saveBtn, { backgroundColor: colors.error }]} onPress={handleSave} activeOpacity={0.85}>
              <Text style={ms.saveText}>Add Damage</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const ms = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 16 },
  existingBox: { borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 14 },
  existingLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 },
  existingItem: { fontSize: 13, lineHeight: 20 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 13, fontWeight: "600" },
  notesInput: { borderRadius: 10, borderWidth: 1.5, padding: 10, fontSize: 14, minHeight: 60, textAlignVertical: "top", marginBottom: 16 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  photoAddBtn: { width: 72, height: 72, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4 },
  photoAddText: { fontSize: 10, fontWeight: "500", textAlign: "center" },
  photoThumb: { width: 72, height: 72, borderRadius: 10, overflow: "hidden", position: "relative" },
  photoThumbImg: { width: 72, height: 72, borderRadius: 10 },
  photoRemove: { position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  saveBtn: { flex: 2, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function InspectionReviewScreen() {
  const colors = useColors();
  const { loadId, vehicleId } = useLocalSearchParams<{ loadId: string; vehicleId: string }>();
  const { getLoad, savePickupInspection, saveDeliveryInspection } = useLoads();
  const { driver } = useAuth();
  const load = getLoad(loadId);
  const vehicle = load?.vehicles.find((v) => v.id === vehicleId);

  const searchParams = useLocalSearchParams<{ type?: string }>();
  const inspectionType: "pickup" | "delivery" =
    searchParams.type === "delivery" ? "delivery" : "pickup";

  // Lock the inspection record once the vehicle has moved past that stage
  // Pickup locks when load is picked_up or delivered; delivery locks when delivered
  const loadStatus = load?.status ?? "pending";
  const isLocked =
    inspectionType === "pickup"
      ? loadStatus === "picked_up" || loadStatus === "delivered"
      : loadStatus === "delivered";

  const inspection =
    inspectionType === "delivery"
      ? vehicle?.deliveryInspection
      : vehicle?.pickupInspection;

  const [photos, setPhotos] = useState<string[]>(inspection?.photos ?? []);
  const savedDamages = inspection?.damages ?? [];
  const savedNoDamage = inspection?.noDamage ?? false;
  const existingAdditional = inspection?.additionalInspection;

  // Local editable damage state (synced back on every change)
  const [damages, setDamages] = useState<Damage[]>(savedDamages);
  const [noDamage, setNoDamage] = useState(savedNoDamage);

  // Editable additional inspection fields
  const [odometer, setOdometer] = useState(existingAdditional?.odometer ?? "");
  const [notes, setNotes] = useState(inspection?.notes ?? "");
  const [drivable, setDrivable] = useState<boolean | null>(existingAdditional?.drivable ?? null);
  const [windscreen, setWindscreen] = useState<boolean | null>(existingAdditional?.windscreen ?? null);
  const [glassesIntact, setGlassesIntact] = useState<boolean | null>(existingAdditional?.glassesIntact ?? null);
  const [titlePresent, setTitlePresent] = useState<boolean | null>(existingAdditional?.titlePresent ?? null);
  const [billOfSale, setBillOfSale] = useState<boolean | null>(existingAdditional?.billOfSale ?? null);
  const [keys, setKeys] = useState<number | null>(existingAdditional?.keys ?? null);
  const [remotes, setRemotes] = useState<number | null>(existingAdditional?.remotes ?? null);
  const [headrests, setHeadrests] = useState<number | null>(existingAdditional?.headrests ?? null);
  const [cargoCover, setCargoCover] = useState<boolean | null>(existingAdditional?.cargoCover ?? null);
  const [spareTire, setSpareTire] = useState<boolean | null>(existingAdditional?.spareTire ?? null);
  const [radio, setRadio] = useState<boolean | null>(existingAdditional?.radio ?? null);
  const [manuals, setManuals] = useState<boolean | null>(existingAdditional?.manuals ?? null);
  const [navigationDisk, setNavigationDisk] = useState<boolean | null>(existingAdditional?.navigationDisk ?? null);
  const [pluginChargerCable, setPluginChargerCable] = useState<boolean | null>(existingAdditional?.pluginChargerCable ?? null);
  const [headphones, setHeadphones] = useState<boolean | null>(existingAdditional?.headphones ?? null);

  // Diagram modal state
  const [selectedZone, setSelectedZone] = useState<DamageZone | null>(null);
  const [showDamageModal, setShowDamageModal] = useState(false);
  const [pendingXPct, setPendingXPct] = useState<number | undefined>();
  const [pendingYPct, setPendingYPct] = useState<number | undefined>();
  const [pendingDiagramView, setPendingDiagramView] = useState<"top" | "side_driver">("top");

  // Consume photos from camera session on first mount (new inspection flow)
  const didConsume = useRef(false);
  useEffect(() => {
    if (didConsume.current) return;
    didConsume.current = true;
    const pending = cameraSessionStore.consumePendingPhotos();
    if (pending.length > 0) {
      setPhotos((prev) => [...prev, ...pending].slice(0, 200));
      if (vehicle && load) {
        const base = inspection ?? { vehicleId, damages: [], photos: [], notes: "", noDamage: false };
        const merged = [...(base.photos ?? []), ...pending].slice(0, 200);
        const updated = { ...base, photos: merged };
        if (inspectionType === "delivery") {
          saveDeliveryInspection(loadId, vehicleId, updated);
        } else {
          savePickupInspection(loadId, vehicleId, updated);
        }
      }
    }
    cameraSessionStore.clearMeta();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Photo gallery state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const mainListRef = useRef<FlatList>(null);
  const thumbListRef = useRef<FlatList>(null);

  const buildAdditional = useCallback((): AdditionalInspection => ({
    odometer,
    notes: "",
    drivable,
    windscreen,
    glassesIntact,
    titlePresent,
    billOfSale,
    keys,
    remotes,
    headrests,
    cargoCover,
    spareTire,
    radio,
    manuals,
    navigationDisk,
    pluginChargerCable,
    headphones,
  }), [odometer, drivable, windscreen, glassesIntact, titlePresent, billOfSale, keys, remotes, headrests, cargoCover, spareTire, radio, manuals, navigationDisk, pluginChargerCable, headphones]);

  const persistAll = useCallback((overrides?: { newDamages?: Damage[]; newNoDamage?: boolean; newPhotos?: string[] }) => {
    if (!vehicle || !load) return;
    const base = inspection ?? { vehicleId, damages: [], photos: [], notes: "", noDamage: false };
    const updated = {
      ...base,
      damages: overrides?.newDamages ?? damages,
      noDamage: overrides?.newNoDamage ?? noDamage,
      photos: overrides?.newPhotos ?? photos,
      notes,
      additionalInspection: buildAdditional(),
    };
    if (inspectionType === "delivery") {
      saveDeliveryInspection(loadId, vehicleId, updated);
    } else {
      savePickupInspection(loadId, vehicleId, updated);
    }
  }, [inspection, vehicle, load, inspectionType, loadId, vehicleId, damages, noDamage, photos, notes, buildAdditional, savePickupInspection, saveDeliveryInspection]);

  // Alias for damage-only persists (called from diagram handlers)
  const persistDamages = useCallback((newDamages: Damage[], newNoDamage: boolean) => {
    persistAll({ newDamages, newNoDamage });
  }, [persistAll]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const handleBack = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleSave = () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    persistAll();
    router.back();
  };

  // ── Photo navigation ────────────────────────────────────────────────────────
  const handleSelectPhoto = useCallback((index: number) => {
    setSelectedIndex(index);
    mainListRef.current?.scrollToIndex({ index, animated: true });
    thumbListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, []);

  const handleMainScroll = useCallback((event: any) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const newIndex = Math.round(offsetX / SCREEN_WIDTH);
    if (newIndex >= 0 && newIndex < photos.length && newIndex !== selectedIndex) {
      setSelectedIndex(newIndex);
      thumbListRef.current?.scrollToIndex({ index: newIndex, animated: true, viewPosition: 0.5 });
    }
  }, [photos.length, selectedIndex]);

  // ── Take more photos ────────────────────────────────────────────────────────
  const handleTakePhoto = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (photos.length >= 200) {
      Alert.alert("Photo Limit", "Maximum 200 photos per vehicle inspection.");
      return;
    }
    cameraSessionStore.open(
      (uris: string[]) => {
        cameraSessionStore.consumePendingPhotos();
        setPhotos((prev) => {
          const merged = [...prev, ...uris].slice(0, 200);
          const base = inspection ?? { vehicleId, damages: [], photos: [], notes: "", noDamage: false };
          const updated = { ...base, damages, noDamage, photos: merged, notes, additionalInspection: buildAdditional() };
          if (inspectionType === "delivery") {
            saveDeliveryInspection(loadId, vehicleId, updated);
          } else {
            savePickupInspection(loadId, vehicleId, updated);
          }
          return merged;
        });
      },
      { loadId, vehicleId, inspectionType }
    );
    router.push("/camera-session" as any);
  };

  // ── Diagram handlers ────────────────────────────────────────────────────────
  const handleDiagramTap = (xPct: number, yPct: number, view: DiagramView, zone: DamageZone) => {
    setPendingXPct(xPct);
    setPendingYPct(yPct);
    setPendingDiagramView(view === "top" ? "top" : "side_driver");
    setSelectedZone(zone);
    setShowDamageModal(true);
  };

  const handleAddDamage = (damage: Damage, damagePhotos: string[]) => {
    const newDamages = [...damages, damage];
    setDamages(newDamages);
    setShowDamageModal(false);
    setSelectedZone(null);
    if (damagePhotos.length > 0) {
      const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";
      const isDelivery = inspectionType === "delivery";
      (async () => {
        const stampedUris: string[] = [];
        for (const uri of damagePhotos) {
          const stamped = await stampPhotoViaServer(uri, {
            inspectionType: isDelivery ? "Delivery Damage" : "Pickup Damage",
            driverCode,
            companyName: load?.orgName ?? undefined,
            locationLabel: inspection?.locationLabel ?? undefined,
            coords: inspection?.locationLat && inspection?.locationLng
              ? { latitude: inspection.locationLat, longitude: inspection.locationLng }
              : undefined,
            vin: vehicle?.vin ?? undefined,
          });
          photoQueue.enqueue({
            localUri: stamped,
            loadId,
            vehicleId,
            inspectionType,
            zone: damage.zone,
            damageId: damage.id,
          });
          stampedUris.push(stamped);
        }
        setPhotos((prev) => [...prev, ...stampedUris].slice(0, 200));
      })();
    }
    persistDamages(newDamages, noDamage);
  };

  const handleRemoveDamage = (id: string) => {
    Alert.alert("Remove Damage", "Remove this damage entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          const newDamages = damages.filter((d) => d.id !== id);
          setDamages(newDamages);
          persistDamages(newDamages, noDamage);
        },
      },
    ]);
  };

  const handleNoDamageToggle = () => {
    const next = !noDamage;
    setNoDamage(next);
    persistDamages(damages, next);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  if (!load || !vehicle) {
    return (
      <ScreenContainer>
        <View style={s.centered}>
          <Text style={[s.errorText, { color: colors.foreground }]}>Vehicle not found.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const vehicleTitle = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unknown Vehicle";
  const vinDisplay = vehicle.vin || "VIN# Not Available";

  const existingZoneDamages = damages.filter((d) => d.zone === selectedZone);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Vehicle Inspection</Text>
        {isLocked ? (
          <View style={{ padding: 2 }}>
            <IconSymbol name="lock.fill" size={18} color={colors.muted} />
          </View>
        ) : (
          <TouchableOpacity onPress={handleSave} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={[s.headerSaveBtn, { color: colors.primary }]}>Save</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={s.scrollView} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Vehicle Info ───────────────────────────────────────────────────── */}
        <View style={s.vehicleInfoSection}>
          <Text style={[s.vehicleTitle, { color: colors.foreground }]}>{vehicleTitle}</Text>
          {vehicle.bodyType ? <Text style={[s.vehicleSubtitle, { color: colors.muted }]}>{vehicle.bodyType}</Text> : null}
          <Text style={[s.vinText, { color: vehicle.vin ? colors.muted : colors.warning }]}>{vinDisplay}</Text>
        </View>

        {/* ── Locked Banner ────────────────────────────────────────────────────── */}
        {isLocked && (
          <View style={[s.lockedBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="lock.fill" size={14} color={colors.muted} />
            <Text style={[s.lockedBannerText, { color: colors.muted }]}>
              {inspectionType === "pickup" ? "Pickup inspection locked — vehicle has been picked up" : "Delivery inspection locked — vehicle has been delivered"}
            </Text>
          </View>
        )}

        {/* ── Photos & Videos Section ────────────────────────────────────────── */}
        <View style={s.photosSection}>
          <View style={s.photosSectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Photos & Videos</Text>
            {!isLocked && (
              <TouchableOpacity style={[s.takePhotoBtn, { borderColor: colors.primary }]} onPress={handleTakePhoto} activeOpacity={0.8}>
                <Text style={[s.takePhotoBtnText, { color: colors.primary }]}>Take Photo</Text>
              </TouchableOpacity>
            )}
          </View>

          {photos.length > 0 ? (
            <>
              <View style={[s.mainImageContainer, { backgroundColor: colors.background }]}>
                <FlatList
                  ref={mainListRef}
                  data={photos}
                  keyExtractor={(_, i) => `main-${i}`}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={handleMainScroll}
                  getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
                  renderItem={({ item }) => (
                    <View style={{ width: SCREEN_WIDTH, height: MAIN_IMAGE_HEIGHT }}>
                      <Image source={{ uri: item }} style={s.mainImage} contentFit="contain" />
                    </View>
                  )}
                />
                <View style={[s.photoCountBadge, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
                  <IconSymbol name="camera.fill" size={13} color="#FFFFFF" />
                  <Text style={s.photoCountText}>{selectedIndex + 1}/{photos.length}</Text>
                </View>
              </View>
              <FlatList
                ref={thumbListRef}
                data={photos}
                keyExtractor={(_, i) => `thumb-${i}`}
                initialNumToRender={15}
                maxToRenderPerBatch={10}
                windowSize={5}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.thumbStrip}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectPhoto(index)}
                    activeOpacity={0.85}
                    style={[s.thumbWrap, index === selectedIndex && { borderColor: colors.primary, borderWidth: 2.5 }]}
                  >
                    <Image source={{ uri: item }} style={s.thumbImage} contentFit="cover" />
                  </TouchableOpacity>
                )}
              />
            </>
          ) : (
            <View style={[s.noPhotosContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <IconSymbol name="camera.fill" size={36} color={colors.muted} />
              <Text style={[s.noPhotosText, { color: colors.muted }]}>
                {isLocked ? "No photos were taken" : "No photos taken yet"}
              </Text>
              {!isLocked && (
                <TouchableOpacity style={[s.takePhotoLargeBtn, { backgroundColor: colors.primary }]} onPress={handleTakePhoto} activeOpacity={0.85}>
                  <IconSymbol name="camera.fill" size={16} color="#FFFFFF" />
                  <Text style={s.takePhotoLargeBtnText}>Take Photos</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ── Damages Section ────────────────────────────────────────────────── */}
        <View style={[s.damagesSection, { borderTopColor: colors.border }]}>
          <View style={s.damagesSectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>
              Damages{damages.length > 0 ? ` (${damages.length})` : ""}
            </Text>
          </View>

          {damages.length > 0 ? (
            <View style={s.damagesList}>
              {damages.map((damage, index) => (
                <DamageItem
                  key={damage.id}
                  damage={damage}
                  index={index}
                  onRemove={handleRemoveDamage}
                  isLocked={isLocked}
                />
              ))}
            </View>
          ) : (
            <View style={[s.noDamagesContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={[s.noDamagesIcon, { backgroundColor: colors.success + "18" }]}>
                <IconSymbol name="checkmark.circle.fill" size={32} color={colors.success} />
              </View>
              <Text style={[s.noDamagesTitle, { color: colors.foreground }]}>
                {noDamage ? "No Damages" : "No Damages Recorded"}
              </Text>
              <Text style={[s.noDamagesSubtitle, { color: colors.muted }]}>
                {noDamage
                  ? "Driver confirmed vehicle has no visible damage."
                  : isLocked
                    ? "No damage was recorded during this inspection."
                    : "Tap the diagram below to mark any damage."}
              </Text>
            </View>
          )}
        </View>

        {/* ── Vehicle Condition Diagram ──────────────────────────────────────── */}
        <View style={[s.diagramSection, { borderTopColor: colors.border }]}>
          <Text style={[s.diagramSectionLabel, { color: colors.muted }]}>
            VEHICLE CONDITION{damages.length > 0 ? ` (${damages.length} damage${damages.length !== 1 ? "s" : ""})` : ""}
          </Text>
          <VehicleDiagram
            damages={damages}
            noDamage={noDamage}
            onDiagramTap={isLocked ? undefined : handleDiagramTap}
            onNoDamageToggle={isLocked ? undefined : handleNoDamageToggle}
          />
        </View>

        {/* ── Odometer ──────────────────────────────────────────────────────── */}
        {!isLocked && (
          <View style={[s.editSection, { borderTopColor: colors.border }]}>
            <View style={s.inlineRow}>
              <IconSymbol name="gauge" size={18} color={colors.muted} />
              <TextInput
                style={[s.inlineInput, { color: colors.foreground }]}
                placeholder="Odometer"
                placeholderTextColor={colors.muted}
                value={odometer}
                onChangeText={setOdometer}
                keyboardType="numeric"
                returnKeyType="done"
              />
            </View>
          </View>
        )}
        {isLocked && odometer ? (
          <View style={[s.editSection, { borderTopColor: colors.border }]}>
            <AdditionalItem label="Odometer" value={odometer} />
          </View>
        ) : null}

        {/* ── Additional Inspection ────────────────────────────────────────── */}
        <View style={[s.editSection, { borderTopColor: colors.border }]}>
          <Text style={[s.editSectionLabel, { color: colors.muted }]}>ADDITIONAL INSPECTION</Text>
          {([
            { label: "Drivable", value: drivable, setter: setDrivable },
            { label: "Windscreen", value: windscreen, setter: setWindscreen },
            { label: "Glasses (all intact)", value: glassesIntact, setter: setGlassesIntact },
            { label: "Title", value: titlePresent, setter: setTitlePresent },
            { label: "Bill of Sale", value: billOfSale, setter: setBillOfSale },
          ] as { label: string; value: boolean | null; setter: (v: boolean | null) => void }[]).map((item, idx, arr) => (
            <View key={item.label} style={[s.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: idx < arr.length - 1 ? 1 : 0 }]}>
              <Text style={[s.toggleLabel, { color: colors.foreground }]}>{item.label}</Text>
              {isLocked ? (
                <Text style={[s.toggleLockedVal, { color: item.value === true ? colors.success : item.value === false ? colors.error : colors.muted }]}>
                  {item.value === true ? "YES" : item.value === false ? "NO" : "—"}
                </Text>
              ) : (
                <View style={[s.toggleGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <TouchableOpacity
                    style={[s.toggleBtn, item.value === true && { backgroundColor: colors.primary }]}
                    onPress={() => { item.setter(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.toggleBtnText, { color: item.value === true ? "#fff" : colors.foreground }]}>YES</Text>
                  </TouchableOpacity>
                  <View style={[s.toggleDivider, { backgroundColor: colors.border }]} />
                  <TouchableOpacity
                    style={[s.toggleBtn, item.value === false && { backgroundColor: colors.error }]}
                    onPress={() => { item.setter(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.toggleBtnText, { color: item.value === false ? "#fff" : colors.foreground }]}>NO</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* ── Loose Items ──────────────────────────────────────────────────── */}
        <View style={[s.editSection, { borderTopColor: colors.border }]}>
          <Text style={[s.editSectionLabel, { color: colors.muted }]}>LOOSE ITEMS</Text>
          {([
            { label: "Keys", value: keys, setter: setKeys },
            { label: "Remotes", value: remotes, setter: setRemotes },
            { label: "Headrests", value: headrests, setter: setHeadrests },
          ] as { label: string; value: number | null; setter: (v: number | null) => void }[]).map((item) => (
            <View key={item.label} style={[s.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Text style={[s.toggleLabel, { color: colors.foreground }]}>{item.label}</Text>
              {isLocked ? (
                <Text style={[s.toggleLockedVal, { color: item.value !== null ? colors.foreground : colors.muted }]}>
                  {item.value !== null ? String(item.value) : "—"}
                </Text>
              ) : (
                <View style={s.countPickerRow}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <TouchableOpacity
                      key={n}
                      style={[s.countChip, { borderColor: colors.border, backgroundColor: item.value === n ? colors.primary : colors.surface }]}
                      onPress={() => { item.setter(n); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.countChipText, { color: item.value === n ? "#fff" : colors.foreground }]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
          {([
            { label: "Cargo Cover", value: cargoCover, setter: setCargoCover },
            { label: "Spare Tire", value: spareTire, setter: setSpareTire },
            { label: "Radio", value: radio, setter: setRadio },
            { label: "Manuals", value: manuals, setter: setManuals },
            { label: "Navigation Disk", value: navigationDisk, setter: setNavigationDisk },
            { label: "Charger Cable", value: pluginChargerCable, setter: setPluginChargerCable },
            { label: "Headphones", value: headphones, setter: setHeadphones },
          ] as { label: string; value: boolean | null; setter: (v: boolean | null) => void }[]).map((item, idx, arr) => (
            <View key={item.label} style={[s.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: idx < arr.length - 1 ? 1 : 0 }]}>
              <Text style={[s.toggleLabel, { color: colors.foreground }]}>{item.label}</Text>
              {isLocked ? (
                <Text style={[s.toggleLockedVal, { color: item.value === true ? colors.success : item.value === false ? colors.error : colors.muted }]}>
                  {item.value === true ? "YES" : item.value === false ? "NO" : "—"}
                </Text>
              ) : (
                <View style={[s.toggleGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <TouchableOpacity
                    style={[s.toggleBtn, item.value === true && { backgroundColor: colors.primary }]}
                    onPress={() => { item.setter(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.toggleBtnText, { color: item.value === true ? "#fff" : colors.foreground }]}>YES</Text>
                  </TouchableOpacity>
                  <View style={[s.toggleDivider, { backgroundColor: colors.border }]} />
                  <TouchableOpacity
                    style={[s.toggleBtn, item.value === false && { backgroundColor: colors.error }]}
                    onPress={() => { item.setter(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.toggleBtnText, { color: item.value === false ? "#fff" : colors.foreground }]}>NO</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* ── Notes ──────────────────────────────────────────────────────────── */}
        <View style={[s.editSection, { borderTopColor: colors.border }]}>
          <Text style={[s.editSectionLabel, { color: colors.muted }]}>NOTES</Text>
          {isLocked ? (
            <Text style={[s.notesText, { color: notes ? colors.foreground : colors.muted }]}>{notes || "No notes"}</Text>
          ) : (
            <TextInput
              style={[s.notesInput, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]}
              placeholder="Add any additional notes about vehicle condition..."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlignVertical="top"
            />
          )}
        </View>

        {/* ── Save Button ────────────────────────────────────────────────────── */}
        {!isLocked && (
          <View style={s.saveSection}>
            <TouchableOpacity style={[s.saveBtn, { backgroundColor: colors.primary }]} onPress={handleSave} activeOpacity={0.85}>
              <IconSymbol name="checkmark.circle.fill" size={18} color="#FFFFFF" />
              <Text style={s.saveBtnText}>Save Inspection</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Damage Modal ────────────────────────────────────────────────────── */}
      <DamageModal
        visible={showDamageModal}
        zone={selectedZone}
        existingDamages={existingZoneDamages}
        onClose={() => { setShowDamageModal(false); setSelectedZone(null); }}
        onSave={handleAddDamage}
        pendingXPct={pendingXPct}
        pendingYPct={pendingYPct}
        pendingView={pendingDiagramView}
      />
    </ScreenContainer>
  );
}

// ─── Damage Item Component ───────────────────────────────────────────────────

function DamageItem({ damage, index, onRemove, isLocked = false }: { damage: Damage; index: number; onRemove: (id: string) => void; isLocked?: boolean }) {
  const colors = useColors();
  const sevColor = SEVERITY_COLORS[damage.severity] ?? colors.muted;
  return (
    <View style={[s.damageItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={s.damageItemHeader}>
        <View style={[s.damageNumber, { backgroundColor: sevColor + "22" }]}>
          <Text style={[s.damageNumberText, { color: sevColor }]}>{index + 1}</Text>
        </View>
        <View style={s.damageItemInfo}>
          <Text style={[s.damageItemType, { color: colors.foreground }]}>
            {DAMAGE_TYPE_LABELS[damage.type] ?? damage.type}
          </Text>
          <Text style={[s.damageItemZone, { color: colors.muted }]}>
            {ZONE_LABELS[damage.zone] ?? damage.zone}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={[s.severityBadge, { backgroundColor: sevColor + "18", borderColor: sevColor + "44" }]}>
            <View style={[s.severityDot, { backgroundColor: sevColor }]} />
            <Text style={[s.severityText, { color: sevColor }]}>
              {damage.severity.charAt(0).toUpperCase() + damage.severity.slice(1)}
            </Text>
          </View>
          {!isLocked && (
            <TouchableOpacity
              onPress={() => onRemove(damage.id)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <IconSymbol name="trash.fill" size={15} color={colors.error} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {damage.description ? (
        <Text style={[s.damageDescription, { color: colors.muted }]}>{damage.description}</Text>
      ) : null}
      {damage.photos && damage.photos.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#3B82F6" }} />
          <Text style={{ fontSize: 11, color: "#3B82F6", fontWeight: "600" }}>
            {damage.photos.length} photo{damage.photos.length !== 1 ? "s" : ""} attached
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Additional Inspection Item ──────────────────────────────────────────────

function AdditionalItem({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={[s.additionalItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[s.additionalLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[s.additionalValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  headerSaveBtn: { fontSize: 16, fontWeight: "700" },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 20 },
  vehicleInfoSection: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  vehicleTitle: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  vehicleSubtitle: { fontSize: 15, fontWeight: "500", marginTop: 2 },
  vinText: { fontSize: 14, fontWeight: "500", marginTop: 4 },
  photosSection: { paddingTop: 8 },
  photosSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  takePhotoBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  takePhotoBtnText: { fontSize: 14, fontWeight: "600" },
  mainImageContainer: { width: SCREEN_WIDTH, height: MAIN_IMAGE_HEIGHT, position: "relative" },
  mainImage: { width: "100%", height: "100%" },
  photoCountBadge: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  photoCountText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  thumbStrip: { paddingHorizontal: 16, paddingVertical: 10, gap: THUMB_GAP },
  thumbWrap: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 6, overflow: "hidden", marginRight: THUMB_GAP, borderWidth: 2, borderColor: "transparent" },
  thumbImage: { width: "100%", height: "100%" },
  noPhotosContainer: { marginHorizontal: 20, borderRadius: 14, borderWidth: 1, paddingVertical: 40, alignItems: "center", gap: 10 },
  noPhotosText: { fontSize: 15, fontWeight: "500" },
  takePhotoLargeBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  takePhotoLargeBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  damagesSection: { paddingTop: 20, borderTopWidth: 0.5, marginTop: 8 },
  damagesSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 14 },
  damagesList: { paddingHorizontal: 20, gap: 10 },
  damageItem: { borderRadius: 12, borderWidth: 1, padding: 14 },
  damageItemHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  damageNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  damageNumberText: { fontSize: 13, fontWeight: "700" },
  damageItemInfo: { flex: 1 },
  damageItemType: { fontSize: 15, fontWeight: "600" },
  damageItemZone: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  severityBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  severityDot: { width: 6, height: 6, borderRadius: 3 },
  severityText: { fontSize: 11, fontWeight: "700" },
  damageDescription: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  noDamagesContainer: { marginHorizontal: 20, borderRadius: 14, borderWidth: 1, paddingVertical: 32, alignItems: "center", gap: 6 },
  noDamagesIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  noDamagesTitle: { fontSize: 17, fontWeight: "700" },
  noDamagesSubtitle: { fontSize: 13, fontWeight: "500", textAlign: "center", paddingHorizontal: 30 },
  // Diagram section
  diagramSection: { paddingTop: 20, paddingHorizontal: 16, borderTopWidth: 0.5, marginTop: 8 },
  diagramSectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 10 },
  additionalItem: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, minWidth: 100 },
  additionalLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },
  additionalValue: { fontSize: 15, fontWeight: "600", marginTop: 2 },
  notesText: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, fontWeight: "500" },
  // Editable sections
  editSection: { paddingTop: 16, paddingHorizontal: 16, borderTopWidth: 0.5, marginTop: 8 },
  editSectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 12 },
  inlineInput: { flex: 1, fontSize: 16, fontWeight: "500", padding: 0 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  toggleLabel: { fontSize: 15, fontWeight: "500", flex: 1 },
  toggleLockedVal: { fontSize: 14, fontWeight: "700" },
  toggleGroup: { flexDirection: "row", borderRadius: 10, borderWidth: 1.5, overflow: "hidden" },
  toggleBtn: { paddingHorizontal: 18, alignItems: "center", justifyContent: "center", paddingVertical: 8 },
  toggleBtnText: { fontSize: 13, fontWeight: "700" },
  toggleDivider: { width: 1 },
  countPickerRow: { flexDirection: "row", gap: 6 },
  countChip: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  countChipText: { fontSize: 13, fontWeight: "600" },
  notesInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: "top" },
  saveSection: { paddingHorizontal: 16, paddingTop: 20 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 14 },
  saveBtnText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  lockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  lockedBannerText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
});
