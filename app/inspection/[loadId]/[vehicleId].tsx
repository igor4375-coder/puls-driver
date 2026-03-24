import React, { useState, useEffect, useCallback } from "react";
import Svg, { Circle, G, Text as SvgText } from "react-native-svg";
import { VehicleDiagramImage } from "@/components/vehicle-diagram-svg";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  Platform,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { photoQueue } from "@/lib/photo-queue";
import type { PhotoQueueEntry } from "@/lib/photo-queue";
import { stampPhotoViaServer } from "@/lib/stamp-photo-client";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { cameraSessionStore } from "@/lib/camera-session-store";
import { pickupHighlightStore } from "@/lib/pickup-highlight-store";
import { useSettings } from "@/lib/settings-context";
import {
  type Damage,
  type DamageType,
  type DamageSeverity,
  type DamageZone,
  type VehicleInspection,
} from "@/lib/data";

// ─── Damage Zone Definitions ─────────────────────────────────────────────────

const DAMAGE_ZONES: { key: DamageZone; label: string }[] = [
  { key: "front",                 label: "Front Bumper" },
  { key: "rear",                  label: "Rear Bumper" },
  { key: "hood",                  label: "Hood" },
  { key: "trunk",                 label: "Trunk" },
  { key: "roof",                  label: "Roof" },
  { key: "windshield",            label: "Windshield" },
  { key: "rear_windshield",       label: "Rear Windshield" },
  { key: "fl_fender",             label: "F.L Fender" },
  { key: "fr_fender",             label: "F.R Fender" },
  { key: "fl_door",               label: "F.L Door" },
  { key: "rl_door",               label: "R.L Door" },
  { key: "fr_door",               label: "F.R Door" },
  { key: "rr_door",               label: "R.R Door" },
  { key: "rl_panel",              label: "R.L Quarter Panel" },
  { key: "rr_panel",              label: "R.R Quarter Panel" },
  { key: "driver_front_wheel",    label: "F.L Wheel" },
  { key: "driver_rear_wheel",     label: "R.L Wheel" },
  { key: "passenger_front_wheel", label: "F.R Wheel" },
  { key: "passenger_rear_wheel",  label: "R.R Wheel" },
];

const DAMAGE_TYPES: { key: DamageType; abbr: string; label: string }[] = [
  { key: "scratch", abbr: "S", label: "Scratch" },
  { key: "multiple_scratches", abbr: "MS", label: "Multi-Scratch" },
  { key: "dent", abbr: "D", label: "Dent" },
  { key: "chip", abbr: "CH", label: "Chipped" },
  { key: "crack", abbr: "CR", label: "Crack" },
  { key: "broken", abbr: "BR", label: "Broken" },
  { key: "missing", abbr: "MI", label: "Missing" },
  { key: "other", abbr: "OT", label: "Other" },
];
const DAMAGE_SEVERITIES: DamageSeverity[] = ["minor", "moderate", "severe"];

// ─── Vehicle Diagram (SVG tap-anywhere) ──────────────────────────────────────
type DiagramView = "top" | "side";

const ABBR_MAP: Record<DamageType, string> = {
  scratch: "S",
  multiple_scratches: "MS",
  dent: "D",
  chip: "CH",
  crack: "CR",
  broken: "BR",
  missing: "MI",
  other: "OT",
};

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

// ── Severity colours ─────────────────────────────────────────────────────────
const SEV_COLORS: Record<string, string> = {
  severe: "#EF4444",
  moderate: "#F59E0B",
  minor: "#22C55E",
};

function VehicleDiagram({
  damages,
  noDamage,
  onDiagramTap,
  onNoDamageToggle,
  onPinTap,
}: {
  damages: Damage[];
  noDamage: boolean;
  onDiagramTap: (xPct: number, yPct: number, view: DiagramView, zone: DamageZone) => void;
  onNoDamageToggle: () => void;
  onPinTap?: (damage: Damage) => void;
}) {
  const colors = useColors();
  // Image-based diagram: both views in one image
  // Image aspect ratio is 3:2 (1536 x 1024)
  const W = 320;
  const H = Math.round(W / (990 / 751)); // ~243 (cropped image aspect ratio)

  const handleTap = (evt: { nativeEvent: { locationX: number; locationY: number } }) => {
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDiagramTap(xPct, yPct, view, zone);
  };

  return (
    <View style={[diagramStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* ── Header hint ─────────────────────────────────────────────────── */}
      <Text style={[diagramStyles.cardSub, { color: colors.muted, marginBottom: 12 }]}>
        Tap anywhere on the vehicle to mark a damage location
      </Text>
      {/* ── Vehicle diagram image ───────────────────────────────────────────────────────────────── */}
      <TouchableOpacity activeOpacity={1} onPress={handleTap} style={[diagramStyles.svgWrap, { backgroundColor: "#fff", borderColor: colors.border }]}>
        <VehicleDiagramImage width={W} />
        {/* ── Damage pins overlay ──────────────────────────────────────── */}
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", top: 0, left: 0 }}>
          {damages.map((d, idx) => {
            if (d.xPct == null || d.yPct == null) return null;
            const cx = (d.xPct / 100) * W;
            const cy = (d.yPct / 100) * H;
            const pinColor = SEV_COLORS[d.severity] ?? "#F59E0B";
            const num = idx + 1;
            const hasPhotos = d.photos && d.photos.length > 0;
            return (
              <G
                key={d.id}
                onPress={hasPhotos && onPinTap ? () => onPinTap(d) : undefined}
              >
                <Circle cx={cx} cy={cy} r={18} fill={pinColor} opacity={0.15} />
                <Circle cx={cx} cy={cy} r={12} fill={pinColor} opacity={0.95} />
                <Circle cx={cx - 3} cy={cy - 3} r={4} fill="white" opacity={0.25} />
                {hasPhotos && (
                  <Circle cx={cx + 8} cy={cy - 8} r={5} fill="#3B82F6" opacity={1} />
                )}
                <SvgText
                  x={cx}
                  y={cy + 4.5}
                  textAnchor="middle"
                  fill="white"
                  fontSize={10}
                  fontWeight="bold"
                >
                  {num}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </TouchableOpacity>

      {/* ── No Damage button ──────────────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={onNoDamageToggle}
        activeOpacity={0.8}
        style={[
          diagramStyles.noDamageBtn,
          noDamage
            ? { backgroundColor: "#22C55E", borderColor: "#16A34A" }
            : { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Text style={[diagramStyles.noDamageBtnText, { color: noDamage ? "#fff" : colors.muted }]}>
          {noDamage ? "✓  No Damage Confirmed" : "Vehicle Has No Damage"}
        </Text>
      </TouchableOpacity>

      {/* ── Severity legend ──────────────────────────────────────────────────── */}
      {!noDamage && (
        <View style={diagramStyles.legend}>
          {Object.entries(SEV_COLORS).map(([sev, col]) => (
            <View key={sev} style={diagramStyles.legendItem}>
              <View style={[diagramStyles.legendDot, { backgroundColor: col }]} />
              <Text style={[diagramStyles.legendLabel, { color: colors.muted }]}>
                {sev.charAt(0).toUpperCase() + sev.slice(1)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const diagramStyles = StyleSheet.create({
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  cardSub: {
    fontSize: 11,
    marginTop: 2,
  },
  segControl: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    padding: 2,
    gap: 2,
  },
  segBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  segBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  segBadge: {
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  segBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  svgWrap: {
    alignSelf: "center",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
    paddingTop: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  noDamageBtn: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  noDamageBtnText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
});

// ─── Damage Detail Modal ──────────────────────────────────────────────────────

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

  const zoneLabel = DAMAGE_ZONES.find((z) => z.key === zone)?.label ?? zone ?? "Vehicle";

  // Reset state when modal closes
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
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 1,  // No compression — preserve original quality
      });
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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave(damage, damagePhotos);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />

          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            Mark Damage — {zoneLabel}
          </Text>

          {/* Existing damages in this zone */}
          {existingDamages.length > 0 && (
            <View style={[styles.existingDamages, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.existingTitle, { color: colors.muted }]}>
                EXISTING DAMAGES IN THIS ZONE
              </Text>
              {existingDamages.map((d) => (
                <Text key={d.id} style={[styles.existingItem, { color: colors.foreground }]}>
                  • {d.type} ({d.severity}){d.description ? `: ${d.description}` : ""}
                </Text>
              ))}
            </View>
          )}

          <Text style={[styles.fieldLabel, { color: colors.muted }]}>DAMAGE TYPE</Text>
          <View style={styles.chipRow}>
            {DAMAGE_TYPES.map((dt) => (
              <TouchableOpacity
                key={dt.key}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: colors.background },
                  type === dt.key && { borderColor: colors.primary, backgroundColor: colors.primary + "18" },
                ]}
                onPress={() => setType(dt.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, { color: type === dt.key ? colors.primary : colors.muted }]}>
                  {dt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.muted }]}>SEVERITY</Text>
          <View style={styles.chipRow}>
            {DAMAGE_SEVERITIES.map((s) => {
              const sColor = s === "minor" ? colors.warning : s === "moderate" ? colors.warning : colors.error;
              return (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.chip,
                    { borderColor: colors.border, backgroundColor: colors.background },
                    severity === s && { borderColor: sColor, backgroundColor: sColor + "18" },
                  ]}
                  onPress={() => setSeverity(s)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, { color: severity === s ? sColor : colors.muted }]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.muted }]}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[styles.notesInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Describe the damage..."
            placeholderTextColor={colors.muted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={2}
          />

          {/* Damage Photos */}
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>DAMAGE PHOTOS (OPTIONAL)</Text>
          <View style={styles.damagePhotoRow}>
            <TouchableOpacity
              style={[styles.damagePhotoAddBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={handleTakePhoto}
              activeOpacity={0.7}
              disabled={pickingPhoto}
            >
              <Text style={{ fontSize: 22, color: colors.muted }}>📷</Text>
              <Text style={[styles.damagePhotoAddText, { color: colors.muted }]}>
                {damagePhotos.length > 0 ? `${damagePhotos.length} photo${damagePhotos.length > 1 ? "s" : ""}` : "Add Photos"}
              </Text>
            </TouchableOpacity>
            {damagePhotos.map((uri, idx) => (
              <View key={idx} style={styles.damagePhotoThumb}>
                <Image source={{ uri }} style={styles.damagePhotoThumbImg} />
                <TouchableOpacity
                  style={styles.damagePhotoRemove}
                  onPress={() => setDamagePhotos((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.modalCancelBtn, { borderColor: colors.border }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalCancelText, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSaveBtn, { backgroundColor: colors.error }]}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <Text style={styles.modalSaveText}>Add Damage</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Inspection Screen ───────────────────────────────────────────────────

export default function InspectionScreen() {
  const colors = useColors();
  const { loadId, vehicleId } = useLocalSearchParams<{ loadId: string; vehicleId: string }>();
  const { getLoad, savePickupInspection, saveDeliveryInspection, updateVehicleInfo, updateLoadStatus } = useLoads();
  const { driver } = useAuth();
  const syncInspectionAction = useAction(api.platform.syncInspection);
  const markAsPickedUpAction = useAction(api.platform.markAsPickedUp);
  const { settings } = useSettings();
  const load = getLoad(loadId);
  const vehicle = load?.vehicles.find((v) => v.id === vehicleId);

  const isDelivery = load?.status === "picked_up";
  // pickupConfirm = true when driver arrived here via "Mark as Picked Up" button
  const pickupConfirm = !isDelivery && (cameraSessionStore.getMeta().pickupConfirm === true);

  // Lock pickup inspection once vehicle is picked_up or delivered;
  // lock delivery inspection once delivered.
  const loadStatus = load?.status ?? "pending";
  const isPickupLocked = !isDelivery && (loadStatus === "picked_up" || loadStatus === "delivered");
  const isDeliveryLocked = isDelivery && loadStatus === "delivered";
  const isLocked = isPickupLocked || isDeliveryLocked;

  const [completing, setCompleting] = useState(false);

  const [damages, setDamages] = useState<Damage[]>(
    isDelivery
      ? vehicle?.deliveryInspection?.damages ?? []
      : vehicle?.pickupInspection?.damages ?? []
  );
  const [noDamage, setNoDamage] = useState(
    isDelivery
      ? vehicle?.deliveryInspection?.noDamage ?? false
      : vehicle?.pickupInspection?.noDamage ?? false
  );
  const [photos, setPhotos] = useState<string[]>(
    isDelivery
      ? vehicle?.deliveryInspection?.photos ?? []
      : vehicle?.pickupInspection?.photos ?? []
  );
  const [notes, setNotes] = useState(
    isDelivery
      ? vehicle?.deliveryInspection?.notes ?? ""
      : vehicle?.pickupInspection?.notes ?? ""
  );
  // ── Additional Inspection state ──────────────────────────────────────────
  const existingAdditional = isDelivery
    ? vehicle?.deliveryInspection?.additionalInspection
    : vehicle?.pickupInspection?.additionalInspection;
  const [odometer, setOdometer] = useState(existingAdditional?.odometer ?? "");
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
  const [handoffNote, setHandoffNote] = useState(
    isDelivery ? vehicle?.deliveryInspection?.handoffNote ?? "" : ""
  );

  const [selectedZone, setSelectedZone] = useState<DamageZone | null>(null);
  const [showDamageModal, setShowDamageModal] = useState(false);
  const [pinPhotoViewer, setPinPhotoViewer] = useState<{ damage: Damage; photoIdx: number } | null>(null);
  const [pendingXPct, setPendingXPct] = useState<number | undefined>(undefined);
  const [pendingYPct, setPendingYPct] = useState<number | undefined>(undefined);
  const [pendingDiagramView, setPendingDiagramView] = useState<"top" | "side_driver">("top");
  const [scannedVin, setScannedVin] = useState<string | null>(null);
  const [scannedVehicleInfo, setScannedVehicleInfo] = useState<{ year: string; make: string; model: string } | null>(null);
  const [queueEntries, setQueueEntries] = useState<PhotoQueueEntry[]>([]);
  const [retrying, setRetrying] = useState(false);

  // On mount: consume any photos taken in the camera-first flow (load detail → camera → here)
  useEffect(() => {
    const pending = cameraSessionStore.consumePendingPhotos();
    if (pending.length > 0) {
      setPhotos((prev) => {
        const combined = [...prev, ...pending];
        return combined.slice(0, 200);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to photo queue to show upload status
  useEffect(() => {
    const unsub = photoQueue.subscribe(setQueueEntries);
    return unsub;
  }, []);

  // Compute upload stats for this vehicle's photos
  const vehicleQueueEntries = queueEntries.filter(
    (e) => e.loadId === loadId && e.vehicleId === vehicleId
  );
  const failedUploads = vehicleQueueEntries.filter((e) => e.status === "failed").length;
  const pendingUploads = vehicleQueueEntries.filter((e) => e.status === "pending" || e.status === "uploading").length;
  const doneUploads = vehicleQueueEntries.filter((e) => e.status === "done").length;

  const handleRetryUploads = async () => {
    setRetrying(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await photoQueue.retryFailed();
    setRetrying(false);
  };

  // ── VIN callback ──────────────────────────────────────────────────────────
  useEffect(() => {
    const { registerVINCallback, unregisterVINCallback } = require("@/lib/vin-store");
    registerVINCallback((_vehicleId: string, result: { vin: string; year: string; make: string; model: string; bodyType: string }) => {
      setScannedVin(result.vin);
      if (result.make || result.model || result.year) {
        setScannedVehicleInfo({ year: result.year, make: result.make, model: result.model });
      }
      updateVehicleInfo(loadId, vehicleId, {
        vin: result.vin,
        ...(result.year && { year: result.year }),
        ...(result.make && { make: result.make }),
        ...(result.model && { model: result.model }),
      });
    });
    return () => unregisterVINCallback();
  }, [loadId, vehicleId]);

  // ── Camera session callback — fires when driver taps Done in camera ───────
  // We use useFocusEffect so the callback is registered every time this screen
  // regains focus (i.e. after returning from camera-session).
  useFocusEffect(
    useCallback(() => {
      // Photos are picked up via the cameraSessionStore callback registered in handleOpenCamera
      return () => {};
    }, [])
  );

  if (!load || !vehicle) {
    return (
      <ScreenContainer>
        <Text style={{ color: colors.foreground, padding: 20 }}>Vehicle not found.</Text>
      </ScreenContainer>
    );
  }

  // If this inspection is locked, redirect to the read-only review screen
  if (isLocked) {
    const inspectionType = isDelivery ? "delivery" : "pickup";
    router.replace(`/inspection-review/${loadId}/${vehicleId}?type=${inspectionType}` as any);
    return null;
  }

  const handleDiagramTap = (xPct: number, yPct: number, view: "top" | "side", zone: DamageZone) => {
    setPendingXPct(xPct);
    setPendingYPct(yPct);
    setPendingDiagramView(view === "top" ? "top" : "side_driver");
    setSelectedZone(zone);
    setShowDamageModal(true);
  };

  const handleAddDamage = (damage: Damage, damagePhotos: string[]) => {
    setDamages((prev) => [...prev, damage]);
    if (damagePhotos.length > 0) {
      const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";
      const existingInsp = isDelivery ? vehicle?.deliveryInspection : vehicle?.pickupInspection;
      (async () => {
        const stampedUris: string[] = [];
        for (const uri of damagePhotos) {
          const stamped = await stampPhotoViaServer(uri, {
            inspectionType: isDelivery ? "Delivery Damage" : "Pickup Damage",
            driverCode,
            companyName: load?.orgName ?? undefined,
            locationLabel: existingInsp?.locationLabel ?? undefined,
            coords: existingInsp?.locationLat && existingInsp?.locationLng
              ? { latitude: existingInsp.locationLat, longitude: existingInsp.locationLng }
              : undefined,
            vin: vehicle?.vin ?? undefined,
          });
          photoQueue.enqueue({
            localUri: stamped,
            loadId,
            vehicleId,
            inspectionType: isDelivery ? "delivery" : "pickup",
            zone: damage.zone,
            damageId: damage.id,
          });
          stampedUris.push(stamped);
        }
        setPhotos((prev) => [...prev, ...stampedUris].slice(0, 200));
      })();
    }
    setShowDamageModal(false);
    setSelectedZone(null);
  };

  const handleRemoveDamage = (id: string) => {
    Alert.alert("Remove Damage", "Remove this damage entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => setDamages((prev) => prev.filter((d) => d.id !== id)),
      },
    ]);
  };

  // ── Open full-screen camera session ──────────────────────────────────────
  const handleOpenCamera = () => {
    if (photos.length >= 200) {
      Alert.alert("Photo Limit Reached", "You've already captured 200 photos for this vehicle.");
      return;
    }
    // Register callback — fires when driver taps Done in camera-session
    cameraSessionStore.open(
      (uris: string[]) => {
        setPhotos((prev) => {
          const combined = [...prev, ...uris];
          // Enforce 200-photo cap
          return combined.slice(0, 200);
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
      { loadId, vehicleId, inspectionType: isDelivery ? "delivery" : "pickup" }
    );
    router.push("/camera-session" as any);
  };


  const handleSave = async () => {
    // Reuse GPS from the existing inspection (captured during camera session)
    // instead of blocking on a fresh GPS request.
    const existingInsp = isDelivery ? vehicle?.deliveryInspection : vehicle?.pickupInspection;
    const locationLat = existingInsp?.locationLat;
    const locationLng = existingInsp?.locationLng;
    const locationLabel = existingInsp?.locationLabel;

    const inspection: VehicleInspection = {
      vehicleId,
      damages,
      noDamage,
      photos,
      notes,
      completedAt: new Date().toISOString(),
      locationLat,
      locationLng,
      locationLabel,
      ...(isDelivery && handoffNote.trim() ? { handoffNote: handoffNote.trim() } : {}),
      additionalInspection: {
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
      },
    };
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Save locally first — always succeeds
    if (isDelivery) {
      saveDeliveryInspection(loadId, vehicleId, inspection);
    } else {
      savePickupInspection(loadId, vehicleId, inspection);
    }

    // Navigate back immediately — don't block the driver on uploads
    if (router.canGoBack()) {
      router.dismiss(1);
    } else {
      router.replace(`/load/${loadId}` as any);
    }

    // Upload remaining photos and sync to platform in the background.
    // Photos already started uploading when they were taken; this flushes any stragglers.
    const isPlatformLoad = loadId.startsWith("platform-");
    const platformTripId = isPlatformLoad ? (load?.platformTripId ?? loadId.replace("platform-", "")) : null;
    const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";

    (async () => {
      let uploadedPhotoUrls: string[] = [];
      try {
        uploadedPhotoUrls = await photoQueue.flushAndGetUrls(loadId, vehicleId);
      } catch {
        photoQueue.flushForVehicle(loadId, vehicleId).catch(() => {});
      }

      const existingS3Urls = photos.filter((p) => p.startsWith("http"));
      const allUploadedPhotos = [...new Set([...existingS3Urls, ...uploadedPhotoUrls])];

      if (isPlatformLoad && platformTripId && driverCode && vehicle) {
        try {
          const syncDamages = damages.map((d) => ({
            id: d.id,
            zone: d.zone,
            type: d.type,
            severity: d.severity,
            x: d.xPct != null ? d.xPct / 100 : 0.5,
            y: d.yPct != null ? d.yPct / 100 : 0.5,
            diagramView: d.diagramView,
            note: d.description || undefined,
          }));
          const additionalData: Record<string, unknown> = {};
          if (odometer) additionalData.odometer = odometer;
          if (drivable !== null) additionalData.drivable = drivable;
          if (windscreen !== null) additionalData.windscreen = windscreen;
          if (glassesIntact !== null) additionalData.glassesIntact = glassesIntact;
          if (titlePresent !== null) additionalData.titlePresent = titlePresent;
          if (billOfSale !== null) additionalData.billOfSale = billOfSale;
          if (keys !== null) additionalData.keys = keys;
          if (remotes !== null) additionalData.remotes = remotes;
          if (headrests !== null) additionalData.headrests = headrests;
          if (cargoCover !== null) additionalData.cargoCover = cargoCover;
          if (spareTire !== null) additionalData.spareTire = spareTire;
          if (radio !== null) additionalData.radio = radio;
          if (manuals !== null) additionalData.manuals = manuals;
          if (navigationDisk !== null) additionalData.navigationDisk = navigationDisk;
          if (pluginChargerCable !== null) additionalData.pluginChargerCable = pluginChargerCable;
          if (headphones !== null) additionalData.headphones = headphones;

          await syncInspectionAction({
            loadNumber: load?.loadNumber || "",
            legId: platformTripId,
            driverCode,
            inspectionType: isDelivery ? "delivery" : "pickup",
            vehicleVin: vehicle.vin || "",
            photos: allUploadedPhotos,
            damages: syncDamages,
            noDamage,
            gps: { lat: locationLat ?? 0, lng: locationLng ?? 0 },
            timestamp: new Date().toISOString(),
            notes: notes || undefined,
            ...(isDelivery && handoffNote.trim() ? { handoffNote: handoffNote.trim() } : {}),
            ...(Object.keys(additionalData).length > 0 && { additionalInspection: additionalData }),
          });
        } catch (err) {
          console.error("[Inspection] SYNC FAILED:", err);
        }
      }
    })();
  };

  // ── Complete Pickup: save inspection + capture GPS + upload photos + call markAsPickedUp ──
  const handleCompletePickup = async () => {
    if (photos.length === 0) {
      Alert.alert("Photos Required", "Please take at least one inspection photo before completing pickup.");
      return;
    }
    setCompleting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Reuse GPS from camera session (already captured during photo taking)
      const existingInsp = vehicle?.pickupInspection;
      const gpsLat = existingInsp?.locationLat ?? 0;
      const gpsLng = existingInsp?.locationLng ?? 0;
      const locationLabel = existingInsp?.locationLabel;

      const inspection: VehicleInspection = {
        vehicleId,
        damages,
        photos,
        notes,
        completedAt: new Date().toISOString(),
        locationLat: gpsLat || undefined,
        locationLng: gpsLng || undefined,
        locationLabel,
        additionalInspection: {
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
        },
      };
      savePickupInspection(loadId, vehicleId, inspection);

      // 3. Upload photos via the unified photo queue (handles compression + retry)
      let uploadedUrls: string[] = [];
      try {
        uploadedUrls = await photoQueue.flushAndGetUrls(loadId, vehicleId);
      } catch (flushErr) {
        console.warn("[CompletePickup] Photo flush failed, retrying in background:", flushErr);
        photoQueue.flushForVehicle(loadId, vehicleId).catch(() => {});
      }
      const existingS3Urls = photos.filter((p) => p.startsWith("http"));
      uploadedUrls = [...new Set([...existingS3Urls, ...uploadedUrls])];

      if (uploadedUrls.length === 0) {
        Alert.alert(
          "Upload Failed",
          "Could not upload inspection photos. Please check your connection and try again."
        );
        setCompleting(false);
        return;
      }

      // 4. Mark load status locally
      updateLoadStatus(loadId, "picked_up");
      pickupHighlightStore.signal("picked_up", "Vehicle picked up — moved to Picked Up tab");

      // 5. Call markAsPickedUp on the company platform (platform loads only)
      const isPlatformLoad = loadId.startsWith("platform-");
      // Read platformTripId from the load object (fresh from latest platform fetch),
      // NOT from parsing load.id which may contain a stale legId.
      const legId = isPlatformLoad ? (load?.platformTripId ?? loadId.replace("platform-", "")) : null;
      // Use platform-assigned driverCode (D-68544 style), not local app code (D-11903 style)
      const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";

      if (isPlatformLoad && legId && driverCode && load) {
        const syncDamages = damages.map((d) => ({
          id: d.id,
          zone: d.zone,
          type: d.type,
          severity: d.severity,
          x: d.xPct != null ? d.xPct / 100 : 0.5,
          y: d.yPct != null ? d.yPct / 100 : 0.5,
          diagramView: d.diagramView,
          note: d.description || undefined,
        }));
        const additionalData: Record<string, unknown> = {};
        if (odometer) additionalData.odometer = odometer;
        if (drivable !== null) additionalData.drivable = drivable;
        if (windscreen !== null) additionalData.windscreen = windscreen;
        if (glassesIntact !== null) additionalData.glassesIntact = glassesIntact;
        if (titlePresent !== null) additionalData.titlePresent = titlePresent;
        if (billOfSale !== null) additionalData.billOfSale = billOfSale;
        if (keys !== null) additionalData.keys = keys;
        if (remotes !== null) additionalData.remotes = remotes;
        if (headrests !== null) additionalData.headrests = headrests;
        if (cargoCover !== null) additionalData.cargoCover = cargoCover;
        if (spareTire !== null) additionalData.spareTire = spareTire;
        if (radio !== null) additionalData.radio = radio;
        if (manuals !== null) additionalData.manuals = manuals;
        if (navigationDisk !== null) additionalData.navigationDisk = navigationDisk;
        if (pluginChargerCable !== null) additionalData.pluginChargerCable = pluginChargerCable;
        if (headphones !== null) additionalData.headphones = headphones;

        const savedSigPaths = settings.driverSignaturePaths.filter((p) => !p.d.startsWith("__live__"));
        const driverSigStr = savedSigPaths.length > 0 ? savedSigPaths.map((p) => p.d).join(" ") : undefined;

        try {
          await markAsPickedUpAction({
            loadNumber: load.loadNumber,
            legId,
            driverCode,
            pickupTime: new Date().toISOString(),
            pickupGPS: { lat: gpsLat, lng: gpsLng },
            pickupPhotos: uploadedUrls,
            customerNotAvailable: true,
            ...(driverSigStr ? { driverSig: driverSigStr } : {}),
            damages: syncDamages,
            noDamage,
            vehicleVin: vehicle?.vin || "",
            ...(Object.keys(additionalData).length > 0 ? { additionalInspection: additionalData } : {}),
          });
        } catch (platformErr) {
          console.warn("[CompletePickup] Platform markAsPickedUp failed:", platformErr);
        }

        try {
          await syncInspectionAction({
            loadNumber: load.loadNumber,
            legId,
            driverCode,
            inspectionType: "pickup",
            vehicleVin: vehicle?.vin || "",
            photos: uploadedUrls,
            damages: syncDamages,
            noDamage,
            gps: { lat: gpsLat, lng: gpsLng },
            timestamp: new Date().toISOString(),
            notes: notes || undefined,
            ...(Object.keys(additionalData).length > 0 ? { additionalInspection: additionalData } : {}),
          });
        } catch (syncErr) {
          console.error("[CompletePickup] syncInspection failed:", syncErr);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Dismiss all modals (camera-session + inspection) and return to loads list.
      // Use while-loop to pop everything, then navigate fresh to the tabs screen
      // so the useFocusEffect reliably fires and switches to the Picked Up tab.
      while (router.canGoBack()) router.back();
      setTimeout(() => router.replace("/(tabs)/" as any), 100);
    } catch (err) {
      console.error("[CompletePickup] Unexpected error:", err);
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setCompleting(false);
    }
  };

  const existingZoneDamages = selectedZone
    ? damages.filter((d) => d.zone === selectedZone)
    : [];

  const remainingPhotos = 200 - photos.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.navHeader, { backgroundColor: colors.primary }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <IconSymbol name="xmark" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.navHeaderCenter}>
          <Text style={styles.navTitle}>
            {isDelivery ? "Delivery" : "Pickup"} Inspection
          </Text>
          <Text style={styles.navSubtitle}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
          onPress={handleSave}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Vehicle Info */}
        <View style={[styles.vehicleInfoBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.vehicleInfoText, { color: colors.foreground }]}>
              {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.color}
            </Text>
            <Text style={[styles.vehicleVin, { color: colors.muted }]}>VIN: {vehicle.vin}</Text>
            {scannedVehicleInfo && (
              <View style={[styles.vinScannedBadge, { backgroundColor: colors.success + "18" }]}>
                <IconSymbol name="checkmark.circle.fill" size={12} color={colors.success} />
                <Text style={[styles.vinScannedText, { color: colors.success }]}>
                  VIN verified: {scannedVehicleInfo.year} {scannedVehicleInfo.make} {scannedVehicleInfo.model}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Photos ─────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.photoSectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              INSPECTION PHOTOS {photos.length > 0 ? `(${photos.length})` : ""}
            </Text>
            {photos.length > 0 && (
              <Text style={[styles.photoCaption, { color: colors.muted }]}>
                {remainingPhotos} remaining
              </Text>
            )}
          </View>

          {/* Primary CTA — open full-screen camera session */}
          <TouchableOpacity
            style={[
              styles.cameraSessionBtn,
              { backgroundColor: colors.primary, opacity: photos.length >= 200 ? 0.5 : 1 },
            ]}
            onPress={handleOpenCamera}
            activeOpacity={0.85}
          >
            <IconSymbol name="camera.fill" size={22} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={styles.cameraSessionBtnTitle}>
                {photos.length === 0 ? "Take Photos" : "Add More Photos"}
              </Text>
              <Text style={styles.cameraSessionBtnSub}>
                {photos.length === 0
                  ? "Keep camera open · shoot up to 200 photos · tap Done when finished"
                  : `${photos.length} photo${photos.length !== 1 ? "s" : ""} captured · tap to add more`}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>

          {/* Photo grid — virtualized for large photo sets */}
          {photos.length > 0 && (
            <FlatList
              data={photos}
              keyExtractor={(_uri, idx) => `photo-${idx}`}
              numColumns={Math.floor((Dimensions.get("window").width - 48) / 88)}
              scrollEnabled={false}
              initialNumToRender={20}
              maxToRenderPerBatch={15}
              columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
              renderItem={({ item: uri, index: idx }) => (
                <View style={styles.photoThumb}>
                  <Image source={{ uri }} style={styles.photoImage} contentFit="cover" />
                  <TouchableOpacity
                    style={[styles.photoRemove, { backgroundColor: colors.error }]}
                    onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    activeOpacity={0.8}
                  >
                    <IconSymbol name="xmark" size={10} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              )}
              style={{ marginBottom: 12 }}
            />
          )}

          {/* Upload status banner — only shown after Save triggers upload */}
          {vehicleQueueEntries.length > 0 && (pendingUploads < vehicleQueueEntries.length || doneUploads > 0 || failedUploads > 0) && (
            <View style={[
              styles.uploadBanner,
              { backgroundColor:
                failedUploads > 0 ? colors.error + "18" :
                pendingUploads > 0 ? colors.warning + "18" :
                colors.success + "18",
                borderColor:
                failedUploads > 0 ? colors.error :
                pendingUploads > 0 ? colors.warning :
                colors.success,
              }
            ]}>
              <View style={styles.uploadBannerLeft}>
                {pendingUploads > 0 && !failedUploads ? (
                  <ActivityIndicator size="small" color={colors.warning} />
                ) : (
                  <IconSymbol
                    name={failedUploads > 0 ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
                    size={16}
                    color={failedUploads > 0 ? colors.error : colors.success}
                  />
                )}
                <Text style={[styles.uploadBannerText, {
                  color: failedUploads > 0 ? colors.error :
                    pendingUploads > 0 ? colors.warning : colors.success
                }]}>
                  {failedUploads > 0
                    ? `${failedUploads} photo${failedUploads !== 1 ? "s" : ""} failed to upload`
                    : pendingUploads > 0
                    ? `Uploading ${pendingUploads} photo${pendingUploads !== 1 ? "s" : ""}…`
                    : `${doneUploads} photo${doneUploads !== 1 ? "s" : ""} uploaded`
                  }
                </Text>
              </View>
              {failedUploads > 0 && (
                <TouchableOpacity
                  style={[styles.retryBtn, { backgroundColor: colors.error }]}
                  onPress={handleRetryUploads}
                  activeOpacity={0.8}
                  disabled={retrying}
                >
                  {retrying ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.retryBtnText}>Retry</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

        </View>

        {/* ── Damage Diagram ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            VEHICLE CONDITION{damages.length > 0 ? ` (${damages.length} damage${damages.length !== 1 ? "s" : ""})` : ""}
          </Text>
          <VehicleDiagram
            damages={damages}
            noDamage={noDamage}
            onDiagramTap={handleDiagramTap}
            onNoDamageToggle={() => {
              setNoDamage((prev) => !prev);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            onPinTap={(damage) => {
              if (damage.photos && damage.photos.length > 0) {
                setPinPhotoViewer({ damage, photoIdx: 0 });
              }
            }}
          />
        </View>

        {/* ── Damage List ─────────────────────────────────────────────────────── */}
        {damages.length > 0 && (
          <View style={[styles.section, { paddingTop: 8 }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>DAMAGE ENTRIES ({damages.length})</Text>
            {damages.map((d, idx) => {
              const pinColor = SEV_COLORS[d.severity] ?? "#F59E0B";
              const zoneLabel = DAMAGE_ZONES.find((z) => z.key === d.zone)?.label ?? d.zone;
              const typeLabel = DAMAGE_TYPES.find((t) => t.key === d.type)?.label ?? d.type;
              return (
                <View key={d.id} style={[styles.damageItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.damagePin, { backgroundColor: pinColor }]}>
                    <Text style={styles.damagePinText}>{idx + 1}</Text>
                  </View>
                  <View style={styles.damageItemLeft}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={[styles.damageTypeBadge, { backgroundColor: pinColor + "22" }]}>
                        <Text style={[styles.damageTypeText, { color: pinColor }]}>{typeLabel}</Text>
                      </View>
                      {d.photos && d.photos.length > 0 && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#3B82F6" }} />
                          <Text style={{ fontSize: 11, color: "#3B82F6", fontWeight: "600" }}>
                            {d.photos.length} photo{d.photos.length !== 1 ? "s" : ""}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.damageZone, { color: colors.foreground }]}>{zoneLabel}</Text>
                    {d.description ? (
                      <Text style={[styles.damageDesc, { color: colors.muted }]}>{d.description}</Text>
                    ) : null}
                  </View>
                  <View style={styles.damageItemRight}>
                    {d.photos && d.photos.length > 0 && (
                      <TouchableOpacity
                        onPress={() => setPinPhotoViewer({ damage: d, photoIdx: 0 })}
                        activeOpacity={0.7}
                        style={{ padding: 4 }}
                      >
                        <IconSymbol name="photo.fill" size={16} color="#3B82F6" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => handleRemoveDamage(d.id)}
                      activeOpacity={0.7}
                      style={{ padding: 4 }}
                    >
                      <IconSymbol name="trash.fill" size={16} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Notes */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>NOTES</Text>
          <TextInput
            style={[styles.notesField, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Add any additional notes about vehicle condition..."
            placeholderTextColor={colors.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Handoff Note — delivery only, for next leg's driver */}
        {isDelivery && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>NOTE FOR NEXT DRIVER</Text>
            <Text style={[styles.handoffHint, { color: colors.muted }]}>
              Leave instructions for whoever picks up this vehicle next (optional)
            </Text>
            <TextInput
              style={[styles.handoffField, { backgroundColor: "#E3F2FD", color: colors.foreground, borderColor: colors.primary + "44" }]}
              placeholder='e.g. "Key underneath driver side mat"'
              placeholderTextColor={colors.muted}
              value={handoffNote}
              onChangeText={setHandoffNote}
              multiline
              numberOfLines={3}
            />
          </View>
        )}

        {/* Previous Leg Notes — pickup only, from previous leg's delivery driver */}
        {!isDelivery && vehicle?.previousLegNotes && (
          <View style={styles.section}>
            <View style={[styles.prevLegBanner, { backgroundColor: "#FFF8E1", borderColor: "#FFD54F" }]}>
              <IconSymbol name="info.circle.fill" size={18} color="#F9A825" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.prevLegTitle, { color: "#E65100" }]}>Note from previous driver</Text>
                <Text style={[styles.prevLegText, { color: "#5D4037" }]}>{vehicle.previousLegNotes}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Odometer */}
        <View style={[styles.section, { paddingHorizontal: 16 }]}>
          <View style={[styles.inlineRow, { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 14 }]}>
            <IconSymbol name="gauge" size={18} color={colors.muted} />
            <TextInput
              style={[styles.inlineInput, { color: colors.foreground }]}
              placeholder="Odometer"
              placeholderTextColor={colors.muted}
              value={odometer}
              onChangeText={setOdometer}
              keyboardType="numeric"
              returnKeyType="done"
            />
          </View>
        </View>

        {/* Additional Inspection */}
        <View style={[styles.sectionHeader, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>ADDITIONAL INSPECTION</Text>
        </View>
        {([
          { label: "Drivable", value: drivable, setter: setDrivable },
          { label: "Windscreen", value: windscreen, setter: setWindscreen },
          { label: "Glasses (all intact)", value: glassesIntact, setter: setGlassesIntact },
          { label: "Title", value: titlePresent, setter: setTitlePresent },
          { label: "Bill of Sale", value: billOfSale, setter: setBillOfSale },
        ] as { label: string; value: boolean | null; setter: (v: boolean | null) => void }[]).map((item, idx, arr) => (
          <View key={item.label} style={[styles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: idx < arr.length - 1 ? 1 : 0 }]}>
            <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{item.label}</Text>
            <View style={[styles.toggleGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.toggleBtn, item.value === true && { backgroundColor: colors.primary }]}
                onPress={() => { item.setter(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleBtnText, { color: item.value === true ? "#fff" : colors.foreground }]}>YES</Text>
              </TouchableOpacity>
              <View style={[styles.toggleDivider, { backgroundColor: colors.border }]} />
              <TouchableOpacity
                style={[styles.toggleBtn, item.value === false && { backgroundColor: colors.error }]}
                onPress={() => { item.setter(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleBtnText, { color: item.value === false ? "#fff" : colors.foreground }]}>NO</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Loose Items Inspection */}
        <View style={[styles.sectionHeader, { backgroundColor: colors.surface, marginTop: 16 }]}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>LOOSE ITEMS INSPECTION</Text>
        </View>
        {/* Count pickers */}
        {([
          { label: "Keys", value: keys, setter: setKeys },
          { label: "Remotes", value: remotes, setter: setRemotes },
          { label: "Headrests", value: headrests, setter: setHeadrests },
        ] as { label: string; value: number | null; setter: (v: number | null) => void }[]).map((item, idx) => (
          <View key={item.label} style={[styles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
            <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{item.label}</Text>
            <View style={[styles.countPickerRow]}>
              {[0,1,2,3,4,5,6,7,8].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.countChip, { borderColor: colors.border, backgroundColor: item.value === n ? colors.primary : colors.surface }]}
                  onPress={() => { item.setter(n); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.countChipText, { color: item.value === n ? "#fff" : colors.foreground }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        {/* YES/NO toggles */}
        {([
          { label: "Cargo Cover", value: cargoCover, setter: setCargoCover },
          { label: "Spare Tire", value: spareTire, setter: setSpareTire },
          { label: "Radio", value: radio, setter: setRadio },
          { label: "Manuals", value: manuals, setter: setManuals },
          { label: "Navigation Disk", value: navigationDisk, setter: setNavigationDisk },
          { label: "Plugin Charger Cable", value: pluginChargerCable, setter: setPluginChargerCable },
          { label: "Headphones", value: headphones, setter: setHeadphones },
        ] as { label: string; value: boolean | null; setter: (v: boolean | null) => void }[]).map((item, idx, arr) => (
          <View key={item.label} style={[styles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: idx < arr.length - 1 ? 1 : 0 }]}>
            <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{item.label}</Text>
            <View style={[styles.toggleGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.toggleBtn, item.value === true && { backgroundColor: colors.primary }]}
                onPress={() => { item.setter(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleBtnText, { color: item.value === true ? "#fff" : colors.foreground }]}>YES</Text>
              </TouchableOpacity>
              <View style={[styles.toggleDivider, { backgroundColor: colors.border }]} />
              <TouchableOpacity
                style={[styles.toggleBtn, item.value === false && { backgroundColor: colors.error }]}
                onPress={() => { item.setter(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.toggleBtnText, { color: item.value === false ? "#fff" : colors.foreground }]}>NO</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Complete Pickup button — shown only when arriving via "Mark as Picked Up" */}
        {pickupConfirm && (
          <>
            {photos.length === 0 && (
              <View style={[styles.photoRequiredBanner, { backgroundColor: colors.warning + "18", borderColor: colors.warning }]}>
                <IconSymbol name="exclamationmark.triangle.fill" size={16} color={colors.warning} />
                <Text style={[styles.photoRequiredText, { color: colors.warning }]}>
                  At least 1 inspection photo is required to complete pickup
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.saveFullBtn,
                { backgroundColor: photos.length === 0 ? colors.muted : colors.success },
              ]}
              onPress={handleCompletePickup}
              activeOpacity={photos.length === 0 ? 1 : 0.85}
              disabled={photos.length === 0 || completing}
            >
              {completing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <IconSymbol name="checkmark.circle.fill" size={22} color="#FFFFFF" />
              )}
              <Text style={styles.saveFullBtnText}>
                {completing ? "Completing Pickup…" : "Complete Pickup"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* Save Inspection button — always available for saving without completing pickup */}
        <TouchableOpacity
          style={[
            styles.saveFullBtn,
            pickupConfirm && { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 0 },
          ]}
          onPress={handleSave}
          activeOpacity={0.85}
        >
          <Text style={[styles.saveFullBtnText, pickupConfirm && { color: colors.foreground }]}>
            {pickupConfirm ? "Save & Come Back Later" : "Save Inspection"}
          </Text>
          <IconSymbol name="chevron.right" size={22} color={pickupConfirm ? colors.foreground : "#FFFFFF"} />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Damage Modal */}
      <DamageModal
        visible={showDamageModal}
        zone={selectedZone}
        existingDamages={existingZoneDamages}
        onClose={() => {
          setShowDamageModal(false);
          setSelectedZone(null);
        }}
        onSave={handleAddDamage}
        pendingXPct={pendingXPct}
        pendingYPct={pendingYPct}
        pendingView={pendingDiagramView}
      />

      {/* Pin Photo Viewer Modal */}
      {pinPhotoViewer && (
        <Modal
          visible
          animationType="fade"
          transparent
          presentationStyle="overFullScreen"
          onRequestClose={() => setPinPhotoViewer(null)}
        >
          <View style={pinViewerStyles.overlay}>
            {/* Header */}
            <View style={pinViewerStyles.header}>
              <TouchableOpacity
                style={pinViewerStyles.closeBtn}
                onPress={() => setPinPhotoViewer(null)}
                activeOpacity={0.8}
              >
                <IconSymbol name="xmark" size={18} color="#fff" />
              </TouchableOpacity>
              <View style={pinViewerStyles.headerCenter}>
                <Text style={pinViewerStyles.headerTitle}>
                  {DAMAGE_TYPES.find((t) => t.key === pinPhotoViewer.damage.type)?.label ?? pinPhotoViewer.damage.type}
                  {" — "}
                  {DAMAGE_ZONES.find((z) => z.key === pinPhotoViewer.damage.zone)?.label ?? pinPhotoViewer.damage.zone}
                </Text>
                <Text style={pinViewerStyles.headerSub}>
                  {pinPhotoViewer.photoIdx + 1} / {pinPhotoViewer.damage.photos!.length}
                </Text>
              </View>
              <View style={{ width: 40 }} />
            </View>

            {/* Main photo */}
            <Image
              source={{ uri: pinPhotoViewer.damage.photos![pinPhotoViewer.photoIdx] }}
              style={pinViewerStyles.mainPhoto}
              contentFit="contain"
            />

            {/* Thumbnail strip (if multiple photos) */}
            {pinPhotoViewer.damage.photos!.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={pinViewerStyles.thumbStrip}
              >
                {pinPhotoViewer.damage.photos!.map((uri, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => setPinPhotoViewer({ ...pinPhotoViewer, photoIdx: idx })}
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri }}
                      style={[
                        pinViewerStyles.thumb,
                        idx === pinPhotoViewer.photoIdx && pinViewerStyles.thumbActive,
                      ]}
                      contentFit="cover"
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Damage info */}
            <View style={pinViewerStyles.infoBar}>
              <View style={[pinViewerStyles.sevBadge, { backgroundColor: (SEV_COLORS[pinPhotoViewer.damage.severity] ?? "#F59E0B") + "33" }]}>
                <Text style={[pinViewerStyles.sevText, { color: SEV_COLORS[pinPhotoViewer.damage.severity] ?? "#F59E0B" }]}>
                  {pinPhotoViewer.damage.severity.charAt(0).toUpperCase() + pinPhotoViewer.damage.severity.slice(1)}
                </Text>
              </View>
              {pinPhotoViewer.damage.description ? (
                <Text style={pinViewerStyles.descText} numberOfLines={2}>
                  {pinPhotoViewer.damage.description}
                </Text>
              ) : null}
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
  },
  backBtn: {
    padding: 4,
  },
  navHeaderCenter: {
    flex: 1,
    alignItems: "center",
  },
  navTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  navSubtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    marginTop: 2,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  scrollContent: {
    paddingBottom: 32,
  },
  vehicleInfoBar: {
    padding: 14,
    borderBottomWidth: 1,
  },
  vehicleInfoText: {
    fontSize: 15,
    fontWeight: "700",
  },
  vehicleVin: {
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  section: {
    padding: 16,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  // Photo section
  photoSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  photoCaption: {
    fontSize: 11,
    fontWeight: "500",
  },
  // Camera session CTA button
  cameraSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  cameraSessionBtnTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  cameraSessionBtnSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    lineHeight: 16,
  },
  // Photo grid
  photosGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  photoImage: {
    width: "100%",
    height: "100%",
  },
  photoRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  // Upload status banner
  uploadBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  uploadBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  uploadBannerText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 8,
    minWidth: 60,
    alignItems: "center",
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  // Wireframe
  wireframeContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
  },
  wireframeTitle: {
    fontSize: 12,
    marginBottom: 12,
  },
  carBody: {
    position: "absolute",
    top: 20,
    left: 40,
    right: 40,
    bottom: 20,
    borderRadius: 20,
    borderWidth: 2,
    backgroundColor: "transparent",
  },
  carRoof: {
    position: "absolute",
    top: "25%",
    left: "15%",
    right: "15%",
    height: "30%",
    borderRadius: 12,
    borderWidth: 1.5,
  },
  carWindshield: {
    position: "absolute",
    top: "18%",
    left: "18%",
    right: "18%",
    height: "12%",
    borderRadius: 6,
    borderWidth: 1,
  },
  carRearWindow: {
    position: "absolute",
    bottom: "18%",
    left: "18%",
    right: "18%",
    height: "12%",
    borderRadius: 6,
    borderWidth: 1,
  },
  zonePin: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  zonePinCount: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  wireframeLegend: {
    flexDirection: "row",
    gap: 20,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
  },
  // Damage list
  damageItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  damagePin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  damagePinText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  damageItemLeft: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    flex: 1,
  },
  damageTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  damageTypeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  damageZone: {
    fontSize: 13,
    fontWeight: "600",
  },
  damageDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  damageItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  severityText: {
    fontSize: 11,
    fontWeight: "600",
  },
  // Notes
  notesField: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
  },
  handoffHint: {
    fontSize: 12,
    marginBottom: 8,
    lineHeight: 16,
  },
  handoffField: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: "top",
  },
  prevLegBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  prevLegTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  prevLegText: {
    fontSize: 14,
    lineHeight: 20,
  },
  // Save button
  saveFullBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 56,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveFullBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  existingDamages: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 14,
  },
  existingTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  existingItem: {
    fontSize: 13,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  notesInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 10,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
  modalSaveBtn: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSaveText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  // Additional Inspection & Loose Items styles
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  toggleGroup: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    height: 38,
  },
  toggleBtn: {
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  toggleDivider: {
    width: 1,
  },
  countPickerRow: {
    flexDirection: "row",
    gap: 5,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    flex: 1,
  },
  countChip: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  countChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 6,
  },
  // VIN badge
  vinScannedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  vinScannedText: {
    fontSize: 11,
    fontWeight: "600",
  },
  // Complete Pickup banner
  photoRequiredBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 16,
  },
  photoRequiredText: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
    lineHeight: 18,
  },
  damagePhotoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  damagePhotoAddBtn: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  damagePhotoAddText: {
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
  },
  damagePhotoThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  damagePhotoThumbImg: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
  damagePhotoRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
});

// ─── Pin Photo Viewer Styles ──────────────────────────────────────────────────
const pinViewerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "space-between",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  headerSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 2,
  },
  mainPhoto: {
    flex: 1,
    width: "100%",
  },
  thumbStrip: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: "row",
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  thumbActive: {
    borderColor: "#FFFFFF",
  },
  infoBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 8,
  },
  sevBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  sevText: {
    fontSize: 12,
    fontWeight: "700",
  },
  descText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
});
