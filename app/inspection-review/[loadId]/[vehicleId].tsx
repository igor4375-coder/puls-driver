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
  Image,
  Dimensions,
  FlatList,
  Alert,
  Modal,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { cameraSessionStore } from "@/lib/camera-session-store";
import type { Damage, DamageType, DamageSeverity, DamageZone } from "@/lib/data";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const MAIN_IMAGE_HEIGHT = SCREEN_WIDTH * 0.75;
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
  front: "Front",
  rear: "Rear",
  hood: "Hood",
  trunk: "Trunk",
  roof: "Roof",
  driver_side: "Driver Side",
  passenger_side: "Passenger Side",
  windshield: "Windshield",
  driver_front_wheel: "Driver Front Wheel",
  driver_rear_wheel: "Driver Rear Wheel",
  passenger_front_wheel: "Passenger Front Wheel",
  passenger_rear_wheel: "Passenger Rear Wheel",
};

// ─── Zone inference helpers ───────────────────────────────────────────────────

type DiagramView = "top" | "side";

/**
 * The vehicle diagram image has 3 sections (percentages of total image height):
 *   Top-down view:  y =  0% – 33%  (front at top, rear at bottom)
 *   Side view:      y = 33% – 68%  (front on left, rear on right)
 *   Bottom view:    y = 68% – 100% (mirror of top-down, front at bottom)
 */

function inferZoneTop(xPct: number, yPct: number): DamageZone {
  const relY = (yPct / 33) * 100;
  if (relY < 40 && xPct < 25) return "driver_front_wheel";
  if (relY < 40 && xPct > 75) return "passenger_front_wheel";
  if (relY > 60 && xPct < 25) return "driver_rear_wheel";
  if (relY > 60 && xPct > 75) return "passenger_rear_wheel";
  if (relY < 18) return "front";
  if (relY > 82) return "rear";
  if (xPct < 15) return "driver_side";
  if (xPct > 85) return "passenger_side";
  if (relY < 45) return "hood";
  if (relY < 60) return "windshield";
  if (relY < 75) return "roof";
  return "trunk";
}

function inferZoneSide(xPct: number, _yPct: number): DamageZone {
  const relY = ((_yPct - 33) / 35) * 100;
  if (xPct < 10) return "front";
  if (xPct > 90) return "rear";
  if (relY > 55 && xPct >= 10 && xPct < 40) return "driver_front_wheel";
  if (relY > 55 && xPct >= 60 && xPct <= 90) return "driver_rear_wheel";
  if (relY < 20) return "roof";
  if (relY < 40 && xPct < 38) return "windshield";
  if (relY < 40 && xPct > 62) return "trunk";
  if (xPct < 30) return "hood";
  if (xPct > 70) return "trunk";
  return "driver_side";
}

function inferZoneBottom(xPct: number, yPct: number): DamageZone {
  const relY = 100 - ((yPct - 68) / 32) * 100;
  if (relY < 40 && xPct < 25) return "passenger_front_wheel";
  if (relY < 40 && xPct > 75) return "driver_front_wheel";
  if (relY > 60 && xPct < 25) return "passenger_rear_wheel";
  if (relY > 60 && xPct > 75) return "driver_rear_wheel";
  if (relY < 18) return "front";
  if (relY > 82) return "rear";
  if (xPct < 15) return "passenger_side";
  if (xPct > 85) return "driver_side";
  if (relY < 45) return "hood";
  if (relY < 60) return "windshield";
  if (relY < 75) return "roof";
  return "trunk";
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
    if (yPct < 33) {
      zone = inferZoneTop(xPct, yPct);
      view = "top";
    } else if (yPct < 68) {
      zone = inferZoneSide(xPct, yPct);
      view = "side";
    } else {
      zone = inferZoneBottom(xPct, yPct);
      view = "top";
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

  const handlePickPhoto = async () => {
    setPickingPhoto(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 1,  // No compression — preserve original quality
      });
      if (!result.canceled) {
        setDamagePhotos((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
      }
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleTakePhoto = async () => {
    setPickingPhoto(true);
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });  // No compression
      if (!result.canceled) {
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
              onPress={() => Alert.alert("Add Photo", "Choose source", [
                { text: "Take Photo", onPress: handleTakePhoto },
                { text: "Choose from Library", onPress: handlePickPhoto },
                { text: "Cancel", style: "cancel" },
              ])}
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

  const photos = inspection?.photos ?? [];
  const savedDamages = inspection?.damages ?? [];
  const savedNoDamage = inspection?.noDamage ?? false;

  // Local editable damage state (synced back on every change)
  const [damages, setDamages] = useState<Damage[]>(savedDamages);
  const [noDamage, setNoDamage] = useState(savedNoDamage);

  // Diagram modal state
  const [selectedZone, setSelectedZone] = useState<DamageZone | null>(null);
  const [showDamageModal, setShowDamageModal] = useState(false);
  const [pendingXPct, setPendingXPct] = useState<number | undefined>();
  const [pendingYPct, setPendingYPct] = useState<number | undefined>();
  const [pendingDiagramView, setPendingDiagramView] = useState<"top" | "side_driver">("top");

  // Photo gallery state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const mainListRef = useRef<FlatList>(null);
  const thumbListRef = useRef<FlatList>(null);

  // Helper to persist damage changes immediately
  const persistDamages = useCallback((newDamages: Damage[], newNoDamage: boolean) => {
    if (!inspection || !vehicle || !load) return;
    const updated = { ...inspection, damages: newDamages, noDamage: newNoDamage };
    if (inspectionType === "delivery") {
      saveDeliveryInspection(loadId, vehicleId, updated);
    } else {
      savePickupInspection(loadId, vehicleId, updated);
    }
  }, [inspection, vehicle, load, inspectionType, loadId, vehicleId, savePickupInspection, saveDeliveryInspection]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const handleBack = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        if (!inspection || !vehicle || !load) return;
        const updatedPhotos = [...photos, ...uris].slice(0, 200);
        const updatedInspection = { ...inspection, photos: updatedPhotos };
        if (inspectionType === "delivery") {
          saveDeliveryInspection(loadId, vehicleId, updatedInspection);
        } else {
          savePickupInspection(loadId, vehicleId, updatedInspection);
        }
        setTimeout(() => {
          const newIndex = photos.length;
          if (newIndex < updatedPhotos.length) {
            setSelectedIndex(newIndex);
            mainListRef.current?.scrollToIndex({ index: newIndex, animated: true });
          }
        }, 300);
      },
      { loadId, vehicleId, inspectionType }
    );
    router.push("/camera-session" as any);
  };

  // ── Navigate to full inspection edit ────────────────────────────────────────
  const handleEditInspection = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/inspection/${loadId}/${vehicleId}` as any);
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
    // Merge damage photos into the inspection gallery
    if (damagePhotos.length > 0 && inspection) {
      const updatedPhotos = [...photos, ...damagePhotos].slice(0, 200);
      const updated = { ...inspection, damages: newDamages, photos: updatedPhotos };
      if (inspectionType === "delivery") {
        saveDeliveryInspection(loadId, vehicleId, updated);
      } else {
        savePickupInspection(loadId, vehicleId, updated);
      }
    } else {
      persistDamages(newDamages, noDamage);
    }
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
  const completedDate = inspection?.completedAt
    ? new Date(inspection.completedAt).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })
    : null;

  const locationInfo = inspection?.locationLabel
    ? inspection.locationLabel
    : inspectionType === "pickup"
      ? [load.pickup.contact.city, load.pickup.contact.state, load.pickup.contact.zip].filter(Boolean).join(", ")
      : [load.delivery.contact.city, load.delivery.contact.state, load.delivery.contact.zip].filter(Boolean).join(", ");

  const captionText = `${inspectionType === "pickup" ? "Pickup" : "Delivery"} Condition${completedDate ? `: ${completedDate}` : ""}${locationInfo ? `, ${locationInfo}` : ""}`;

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
          <TouchableOpacity onPress={handleEditInspection} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <IconSymbol name="pencil" size={20} color={colors.muted} />
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
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={handleMainScroll}
                  getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
                  renderItem={({ item }) => (
                    <View style={{ width: SCREEN_WIDTH, height: MAIN_IMAGE_HEIGHT }}>
                      <Image source={{ uri: item }} style={s.mainImage} resizeMode="cover" />
                    </View>
                  )}
                />
                <View style={[s.photoCountBadge, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
                  <IconSymbol name="camera.fill" size={13} color="#FFFFFF" />
                  <Text style={s.photoCountText}>{selectedIndex + 1}/{photos.length}</Text>
                </View>
                <View style={s.captionOverlay}>
                  <Text style={s.captionText} numberOfLines={1}>{captionText}</Text>
                </View>
              </View>
              <FlatList
                ref={thumbListRef}
                data={photos}
                keyExtractor={(_, i) => `thumb-${i}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.thumbStrip}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectPhoto(index)}
                    activeOpacity={0.85}
                    style={[s.thumbWrap, index === selectedIndex && { borderColor: colors.primary, borderWidth: 2.5 }]}
                  >
                    <Image source={{ uri: item }} style={s.thumbImage} resizeMode="cover" />
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

        {/* ── Additional Inspection Info ──────────────────────────────────────── */}
        {inspection?.additionalInspection && (
          <View style={[s.additionalSection, { borderTopColor: colors.border }]}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Additional Inspection</Text>
            <View style={s.additionalGrid}>
              {inspection.additionalInspection.odometer ? <AdditionalItem label="Odometer" value={inspection.additionalInspection.odometer} /> : null}
              {inspection.additionalInspection.drivable !== null && <AdditionalItem label="Drivable" value={inspection.additionalInspection.drivable ? "Yes" : "No"} />}
              {inspection.additionalInspection.windscreen !== null && <AdditionalItem label="Windscreen" value={inspection.additionalInspection.windscreen ? "OK" : "Damaged"} />}
              {inspection.additionalInspection.glassesIntact !== null && <AdditionalItem label="Glasses Intact" value={inspection.additionalInspection.glassesIntact ? "Yes" : "No"} />}
              {inspection.additionalInspection.titlePresent !== null && <AdditionalItem label="Title Present" value={inspection.additionalInspection.titlePresent ? "Yes" : "No"} />}
              {inspection.additionalInspection.keys !== null && <AdditionalItem label="Keys" value={String(inspection.additionalInspection.keys)} />}
              {inspection.additionalInspection.remotes !== null && <AdditionalItem label="Remotes" value={String(inspection.additionalInspection.remotes)} />}
              {inspection.additionalInspection.spareTire !== null && <AdditionalItem label="Spare Tire" value={inspection.additionalInspection.spareTire ? "Yes" : "No"} />}
            </View>
          </View>
        )}

        {/* ── Notes ──────────────────────────────────────────────────────────── */}
        {inspection?.notes ? (
          <View style={[s.notesSection, { borderTopColor: colors.border }]}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Notes</Text>
            <Text style={[s.notesText, { color: colors.muted }]}>{inspection.notes}</Text>
          </View>
        ) : null}

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
  captionOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 14, paddingVertical: 8 },
  captionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "500" },
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
  additionalSection: { paddingTop: 20, paddingHorizontal: 20, borderTopWidth: 0.5, marginTop: 8 },
  additionalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  additionalItem: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, minWidth: 100 },
  additionalLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },
  additionalValue: { fontSize: 15, fontWeight: "600", marginTop: 2 },
  notesSection: { paddingTop: 20, paddingHorizontal: 20, borderTopWidth: 0.5, marginTop: 8 },
  notesText: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, fontWeight: "500" },
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
