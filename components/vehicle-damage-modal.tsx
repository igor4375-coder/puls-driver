/**
 * VehicleDamageModal
 *
 * A full-screen modal that lets the driver mark damage on a vehicle diagram.
 * Opened from the load detail screen via the "Mark Vehicle Damage" button.
 * Saves damage data back to the inspection via savePickupInspection /
 * saveDeliveryInspection in loads-context.
 */
import React, { useState } from "react";
import Svg, {
  Circle,
  G,
  Text as SvgText,
} from "react-native-svg";
import { VehicleDiagramImage } from "@/components/vehicle-diagram-svg";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  TextInput,
  ScrollView,
  SafeAreaView,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type {
  Damage,
  DamageType,
  DamageSeverity,
  DamageZone,
  VehicleInspection,
  Vehicle,
} from "@/lib/data";

// ─── Zone / Type / Severity Definitions ──────────────────────────────────────
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
const SEV_COLORS: Record<string, string> = {
  severe: "#EF4444",
  moderate: "#F59E0B",
  minor: "#22C55E",
};

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

// ─── Damage Detail Bottom Sheet ───────────────────────────────────────────────
function DamageSheet({
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
  onSave: (damage: Damage) => void;
  pendingXPct?: number;
  pendingYPct?: number;
  pendingView?: "top" | "side_driver";
}) {
  const colors = useColors();
  const [type, setType] = useState<DamageType>("scratch");
  const [severity, setSeverity] = useState<DamageSeverity>("minor");
  const [description, setDescription] = useState("");
  const zoneLabel = DAMAGE_ZONES.find((z) => z.key === zone)?.label ?? zone ?? "Vehicle";

  const handleSave = () => {
    if (!zone) return;
    const damage: Damage = {
      id: Date.now().toString(),
      zone,
      type,
      severity,
      description,
      photos: [],
      xPct: pendingXPct,
      yPct: pendingYPct,
      diagramView: pendingView,
    };
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave(damage);
    setType("scratch");
    setSeverity("minor");
    setDescription("");
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={sheet.overlay}>
        <View style={[sheet.panel, { backgroundColor: colors.surface }]}>
          <View style={[sheet.handle, { backgroundColor: colors.border }]} />
          <Text style={[sheet.title, { color: colors.foreground }]}>
            Mark Damage — {zoneLabel}
          </Text>
          {existingDamages.length > 0 && (
            <View style={[sheet.existing, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[sheet.existingTitle, { color: colors.muted }]}>EXISTING IN THIS ZONE</Text>
              {existingDamages.map((d) => (
                <Text key={d.id} style={[sheet.existingItem, { color: colors.foreground }]}>
                  • {d.type} ({d.severity}){d.description ? `: ${d.description}` : ""}
                </Text>
              ))}
            </View>
          )}
          <Text style={[sheet.label, { color: colors.muted }]}>DAMAGE TYPE</Text>
          <View style={sheet.chipRow}>
            {DAMAGE_TYPES.map((dt) => (
              <TouchableOpacity
                key={dt.key}
                style={[
                  sheet.chip,
                  { borderColor: colors.border, backgroundColor: colors.background },
                  type === dt.key && { borderColor: colors.primary, backgroundColor: colors.primary + "18" },
                ]}
                onPress={() => setType(dt.key)}
                activeOpacity={0.7}
              >
                <Text style={[sheet.chipText, { color: type === dt.key ? colors.primary : colors.muted }]}>
                  {dt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[sheet.label, { color: colors.muted }]}>SEVERITY</Text>
          <View style={sheet.chipRow}>
            {DAMAGE_SEVERITIES.map((s) => {
              const sColor = SEV_COLORS[s] ?? colors.warning;
              return (
                <TouchableOpacity
                  key={s}
                  style={[
                    sheet.chip,
                    { borderColor: colors.border, backgroundColor: colors.background },
                    severity === s && { borderColor: sColor, backgroundColor: sColor + "18" },
                  ]}
                  onPress={() => setSeverity(s)}
                  activeOpacity={0.7}
                >
                  <Text style={[sheet.chipText, { color: severity === s ? sColor : colors.muted }]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[sheet.label, { color: colors.muted }]}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[sheet.notes, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Describe the damage..."
            placeholderTextColor={colors.muted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={2}
            returnKeyType="done"
          />
          <View style={sheet.actions}>
            <TouchableOpacity
              style={[sheet.cancelBtn, { borderColor: colors.border }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={[sheet.cancelText, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[sheet.saveBtn, { backgroundColor: colors.error }]}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <Text style={sheet.saveText}>Add Damage</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Vehicle Diagram (SVG) ────────────────────────────────────────────────────
function VehicleDiagram({
  damages,
  noDamage,
  onDiagramTap,
  onNoDamageToggle,
}: {
  damages: Damage[];
  noDamage: boolean;
  onDiagramTap?: (xPct: number, yPct: number, view: DiagramView, zone: DamageZone) => void;
  onNoDamageToggle?: () => void;
}) {
  const colors = useColors();
  // Image-based diagram: both views in one image
  const W = 320;
  const H = Math.round(W / (990 / 751)); // ~243 (cropped image aspect ratio)

  const handleTap = (evt: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (noDamage || !onDiagramTap) return;
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
    <View style={[diag.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header row */}
      <View style={diag.headerRow}>
        <View>
          <Text style={[diag.cardTitle, { color: colors.foreground }]}>Damage Diagram</Text>
          <Text style={[diag.cardSub, { color: colors.muted }]}>
            {noDamage ? "No damage confirmed" : "Tap the vehicle to mark damage"}
          </Text>
        </View>
        {damages.length > 0 && (
          <View style={[diag.segBadge, { backgroundColor: colors.error + "22" }]}>
            <Text style={[diag.segBadgeText, { color: colors.error }]}>{damages.length}</Text>
          </View>
        )}
      </View>

      {/* Vehicle diagram image */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={handleTap}
        style={[diag.svgWrap, { backgroundColor: "#fff", borderColor: colors.border, opacity: noDamage ? 0.45 : 1 }]}
      >
        <VehicleDiagramImage width={W} />
        {/* Damage pins overlay */}
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", top: 0, left: 0 }}>
          {damages.map((d, idx) => {
            if (d.xPct == null || d.yPct == null) return null;
            const cx = (d.xPct / 100) * W;
            const cy = (d.yPct / 100) * H;
            const pinColor = SEV_COLORS[d.severity] ?? "#F59E0B";
            return (
              <G key={d.id}>
                <Circle cx={cx} cy={cy} r={18} fill={pinColor} opacity={0.15} />
                <Circle cx={cx} cy={cy} r={12} fill={pinColor} opacity={0.95} />
                <Circle cx={cx - 3} cy={cy - 3} r={4} fill="white" opacity={0.25} />
                <SvgText x={cx} y={cy + 4.5} textAnchor="middle" fill="white" fontSize={10} fontWeight="bold">
                  {idx + 1}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </TouchableOpacity>

      {/* No Damage button */}
      <TouchableOpacity
        onPress={onNoDamageToggle}
        activeOpacity={0.8}
        style={[
          diag.noDamageBtn,
          noDamage
            ? { backgroundColor: "#22C55E", borderColor: "#16A34A" }
            : { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Text style={[diag.noDamageBtnText, { color: noDamage ? "#fff" : colors.muted }]}>
          {noDamage ? "✓  No Damage Confirmed" : "Vehicle Has No Damage"}
        </Text>
      </TouchableOpacity>

      {/* Legend */}
      {!noDamage && (
        <View style={diag.legend}>
          {Object.entries(SEV_COLORS).map(([sev, col]) => (
            <View key={sev} style={diag.legendItem}>
              <View style={[diag.legendDot, { backgroundColor: col }]} />
              <Text style={[diag.legendLabel, { color: colors.muted }]}>
                {sev.charAt(0).toUpperCase() + sev.slice(1)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export function VehicleDamageModal({
  visible,
  vehicle,
  loadId,
  isDelivery,
  onClose,
}: {
  visible: boolean;
  vehicle: Vehicle;
  loadId: string;
  isDelivery: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const { savePickupInspection, saveDeliveryInspection } = useLoads();

  const inspection = isDelivery ? vehicle.deliveryInspection : vehicle.pickupInspection;

  const [damages, setDamages] = useState<Damage[]>(inspection?.damages ?? []);
  const [noDamage, setNoDamage] = useState(inspection?.noDamage ?? false);

  // Damage sheet state
  const [showSheet, setShowSheet] = useState(false);
  const [selectedZone, setSelectedZone] = useState<DamageZone | null>(null);
  const [pendingXPct, setPendingXPct] = useState<number | undefined>(undefined);
  const [pendingYPct, setPendingYPct] = useState<number | undefined>(undefined);
  const [pendingView, setPendingView] = useState<"top" | "side_driver">("top");

  // Reset local state when modal opens with fresh vehicle data
  React.useEffect(() => {
    if (visible) {
      const insp = isDelivery ? vehicle.deliveryInspection : vehicle.pickupInspection;
      setDamages(insp?.damages ?? []);
      setNoDamage(insp?.noDamage ?? false);
    }
  }, [visible, vehicle, isDelivery]);

  const handleDiagramTap = (xPct: number, yPct: number, view: DiagramView, zone: DamageZone) => {
    setPendingXPct(xPct);
    setPendingYPct(yPct);
    setPendingView(view === "top" ? "top" : "side_driver");
    setSelectedZone(zone);
    setShowSheet(true);
  };

  const handleAddDamage = (damage: Damage) => {
    setDamages((prev) => [...prev, damage]);
    setShowSheet(false);
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

  const handleDone = () => {
    // Merge damage data into the existing inspection (preserving photos, notes, etc.)
    const base = inspection ?? {
      vehicleId: vehicle.id,
      photos: [],
      notes: "",
      completedAt: new Date().toISOString(),
    };
    const updated: VehicleInspection = { ...base, damages, noDamage };
    if (isDelivery) {
      saveDeliveryInspection(loadId, vehicle.id, updated);
    } else {
      savePickupInspection(loadId, vehicle.id, updated);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  const existingZoneDamages = selectedZone
    ? damages.filter((d) => d.zone === selectedZone)
    : [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[modal.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[modal.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={modal.headerBtn}>
            <Text style={[modal.headerBtnText, { color: colors.muted }]}>Cancel</Text>
          </TouchableOpacity>
          <View style={modal.headerCenter}>
            <Text style={[modal.headerTitle, { color: colors.foreground }]}>Vehicle Damage</Text>
            <Text style={[modal.headerSub, { color: colors.muted }]} numberOfLines={1}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Text>
          </View>
          <TouchableOpacity onPress={handleDone} activeOpacity={0.8} style={[modal.doneBtn, { backgroundColor: colors.primary }]}>
            <Text style={modal.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={modal.scroll} showsVerticalScrollIndicator={false}>
          {/* Diagram */}
          <VehicleDiagram
            damages={damages}
            noDamage={noDamage}
            onDiagramTap={handleDiagramTap}
            onNoDamageToggle={() => {
              const next = !noDamage;
              setNoDamage(next);
              if (next) setDamages([]);
              Haptics.notificationAsync(
                next
                  ? Haptics.NotificationFeedbackType.Success
                  : Haptics.NotificationFeedbackType.Warning
              );
            }}
          />

          {/* Damage list */}
          {damages.length > 0 && (
            <View style={modal.listSection}>
              <Text style={[modal.listTitle, { color: colors.muted }]}>
                DAMAGE REPORT ({damages.length})
              </Text>
              {damages.map((d, idx) => {
                const sColor = SEV_COLORS[d.severity] ?? colors.warning;
                const zoneLabel = DAMAGE_ZONES.find((z) => z.key === d.zone)?.label ?? d.zone;
                const typeLabel = DAMAGE_TYPES.find((t) => t.key === d.type)?.label ?? d.type;
                return (
                  <View key={d.id} style={[modal.listItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={[modal.pin, { backgroundColor: sColor }]}>
                      <Text style={modal.pinText}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[modal.itemZone, { color: colors.foreground }]}>{zoneLabel}</Text>
                      <Text style={[modal.itemDesc, { color: colors.muted }]}>
                        {typeLabel}{d.description ? ` · ${d.description}` : ""}
                      </Text>
                    </View>
                    <View style={modal.itemRight}>
                      <View style={[modal.sevBadge, { backgroundColor: sColor + "22" }]}>
                        <Text style={[modal.sevText, { color: sColor }]}>
                          {d.severity.charAt(0).toUpperCase() + d.severity.slice(1)}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => handleRemoveDamage(d.id)} activeOpacity={0.7}>
                        <IconSymbol name="trash.fill" size={16} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Damage detail sheet */}
        <DamageSheet
          visible={showSheet}
          zone={selectedZone}
          existingDamages={existingZoneDamages}
          onClose={() => { setShowSheet(false); setSelectedZone(null); }}
          onSave={handleAddDamage}
          pendingXPct={pendingXPct}
          pendingYPct={pendingYPct}
          pendingView={pendingView}
        />
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const diag = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.3 },
  cardSub: { fontSize: 11, marginTop: 2 },
  segControl: { flexDirection: "row", borderRadius: 10, borderWidth: 1, overflow: "hidden", padding: 2, gap: 2 },
  segBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, gap: 4 },
  segBtnText: { fontSize: 12, fontWeight: "600" },
  segBadge: { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  segBadgeText: { fontSize: 10, fontWeight: "700" },
  svgWrap: { alignSelf: "center", borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  legend: { flexDirection: "row", justifyContent: "center", gap: 18, paddingTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontWeight: "500" },
  noDamageBtn: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 12, alignItems: "center", marginTop: 4, marginBottom: 8 },
  noDamageBtnText: { fontSize: 13, fontWeight: "600", letterSpacing: 0.1 },
});

const sheet = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  panel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: "700", marginBottom: 14 },
  existing: { borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 12 },
  existingTitle: { fontSize: 10, fontWeight: "600", marginBottom: 4 },
  existingItem: { fontSize: 12, marginBottom: 2 },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 13, fontWeight: "500" },
  notes: { borderRadius: 10, borderWidth: 1, padding: 10, fontSize: 14, minHeight: 60, marginBottom: 16 },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 13, alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  saveBtn: { flex: 2, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  saveText: { fontSize: 15, fontWeight: "700", color: "#fff" },
});

const modal = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  headerBtn: { minWidth: 60 },
  headerBtnText: { fontSize: 16 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  headerSub: { fontSize: 12, marginTop: 1 },
  doneBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 7, minWidth: 60, alignItems: "center" },
  doneBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  scroll: { padding: 16, paddingBottom: 40 },
  listSection: { marginTop: 8 },
  listTitle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, marginBottom: 8 },
  listItem: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10 },
  pin: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  pinText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  itemZone: { fontSize: 14, fontWeight: "600" },
  itemDesc: { fontSize: 12, marginTop: 1 },
  itemRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  sevBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  sevText: { fontSize: 11, fontWeight: "600" },
});
