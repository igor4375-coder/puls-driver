import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
  Image,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { router } from "expo-router";
import { cameraSessionStore } from "@/lib/camera-session-store";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DamageItem {
  id: string;
  zone: string;
  type: string;
  severity: string;
}

export interface InspectionResult {
  photos: string[];
  damages: DamageItem[];
  notes: string;
}

interface Props {
  visible: boolean;
  vehicleLabel: string;
  vin: string;
  initialData?: InspectionResult;
  onSave: (result: InspectionResult) => void;
  onCancel: () => void;
  /** Called when driver taps "Take Photos" — parent should open camera-session route */
  onRequestPhotoSession?: (addPhotos: (uris: string[]) => void) => void;
}

// ─── Damage Zones ────────────────────────────────────────────────────────────

const DAMAGE_ZONES = [
  { id: "front", label: "Front" },
  { id: "front-left", label: "Front Left" },
  { id: "front-right", label: "Front Right" },
  { id: "rear", label: "Rear" },
  { id: "rear-left", label: "Rear Left" },
  { id: "rear-right", label: "Rear Right" },
  { id: "roof", label: "Roof" },
  { id: "hood", label: "Hood" },
  { id: "trunk", label: "Trunk/Tailgate" },
  { id: "underbody", label: "Underbody" },
  { id: "interior", label: "Interior" },
  { id: "glass", label: "Glass/Windshield" },
];

const DAMAGE_TYPES = ["Scratch", "Dent", "Chip", "Crack", "Missing Part", "Rust", "Stain", "Broken", "Other"];
const DAMAGE_SEVERITIES = [
  { label: "Minor", color: "#F59E0B" },
  { label: "Moderate", color: "#EF4444" },
  { label: "Major", color: "#991B1B" },
];

// ─── Vehicle Wireframe ────────────────────────────────────────────────────────

function VehicleWireframe({
  damages,
  onZoneTap,
}: {
  damages: DamageItem[];
  onZoneTap: (zone: string) => void;
}) {
  const colors = useColors();

  const zones: { id: string; label: string; x: number; y: number; w: number; h: number }[] = [
    { id: "front", label: "Front", x: 60, y: 8, w: 80, h: 30 },
    { id: "hood", label: "Hood", x: 60, y: 38, w: 80, h: 40 },
    { id: "front-left", label: "FL", x: 20, y: 38, w: 40, h: 40 },
    { id: "front-right", label: "FR", x: 140, y: 38, w: 40, h: 40 },
    { id: "roof", label: "Roof", x: 60, y: 78, w: 80, h: 60 },
    { id: "rear-left", label: "RL", x: 20, y: 138, w: 40, h: 40 },
    { id: "rear-right", label: "RR", x: 140, y: 138, w: 40, h: 40 },
    { id: "trunk", label: "Trunk", x: 60, y: 138, w: 80, h: 40 },
    { id: "rear", label: "Rear", x: 60, y: 178, w: 80, h: 30 },
  ];

  return (
    <View style={[wireStyles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[wireStyles.title, { color: colors.muted }]}>Tap a zone to mark damage</Text>
      <View style={wireStyles.grid}>
        {zones.map((zone) => {
          const hasDamage = damages.some((d) => d.zone === zone.id);
          return (
            <TouchableOpacity
              key={zone.id}
              style={[
                wireStyles.zone,
                {
                  left: zone.x,
                  top: zone.y,
                  width: zone.w,
                  height: zone.h,
                  backgroundColor: hasDamage ? "#EF444420" : colors.background,
                  borderColor: hasDamage ? "#EF4444" : colors.border,
                },
              ]}
              onPress={() => onZoneTap(zone.id)}
              activeOpacity={0.7}
            >
              <Text style={[wireStyles.zoneLabel, { color: hasDamage ? "#EF4444" : colors.muted }]}>
                {zone.label}
              </Text>
              {hasDamage && <View style={wireStyles.damageDot} />}
            </TouchableOpacity>
          );
        })}
        <View style={[wireStyles.carOutline, { borderColor: colors.border, pointerEvents: "none" }]} />
      </View>
    </View>
  );
}

const wireStyles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    alignItems: "center",
  },
  title: { fontSize: 12, marginBottom: 12 },
  grid: { width: 200, height: 210, position: "relative" },
  zone: {
    position: "absolute",
    borderWidth: 1.5,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  zoneLabel: { fontSize: 10, fontWeight: "600", textAlign: "center" },
  damageDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#EF4444", marginTop: 2 },
  carOutline: {
    position: "absolute",
    left: 55,
    top: 3,
    width: 90,
    height: 210,
    borderWidth: 2,
    borderRadius: 20,
    pointerEvents: "none",
  },
});

// ─── Damage Selector Modal ────────────────────────────────────────────────────

function DamageSelectorModal({
  visible,
  zone,
  onAdd,
  onClose,
}: {
  visible: boolean;
  zone: string;
  onAdd: (type: string, severity: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);

  const zoneName = DAMAGE_ZONES.find((z) => z.id === zone)?.label ?? zone;

  const handleAdd = () => {
    if (!selectedType || !selectedSeverity) {
      Alert.alert("Select Both", "Please select a damage type and severity.");
      return;
    }
    onAdd(selectedType, selectedSeverity);
    setSelectedType(null);
    setSelectedSeverity(null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={dmgStyles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[dmgStyles.sheet, { backgroundColor: colors.background }]}>
        <View style={[dmgStyles.handle, { backgroundColor: colors.border }]} />
        <Text style={[dmgStyles.sheetTitle, { color: colors.foreground }]}>
          Mark Damage — {zoneName}
        </Text>

        <Text style={[dmgStyles.subLabel, { color: colors.muted }]}>Damage Type</Text>
        <View style={dmgStyles.chipRow}>
          {DAMAGE_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[
                dmgStyles.chip,
                { borderColor: selectedType === t ? colors.primary : colors.border },
                selectedType === t && { backgroundColor: colors.primary + "18" },
              ]}
              onPress={() => { setSelectedType(t); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              activeOpacity={0.8}
            >
              <Text style={[dmgStyles.chipText, { color: selectedType === t ? colors.primary : colors.muted }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[dmgStyles.subLabel, { color: colors.muted }]}>Severity</Text>
        <View style={dmgStyles.severityRow}>
          {DAMAGE_SEVERITIES.map((s) => (
            <TouchableOpacity
              key={s.label}
              style={[
                dmgStyles.severityBtn,
                { borderColor: selectedSeverity === s.label ? s.color : colors.border },
                selectedSeverity === s.label && { backgroundColor: s.color + "20" },
              ]}
              onPress={() => { setSelectedSeverity(s.label); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              activeOpacity={0.8}
            >
              <View style={[dmgStyles.severityDot, { backgroundColor: s.color }]} />
              <Text style={[dmgStyles.severityText, { color: selectedSeverity === s.label ? s.color : colors.foreground }]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[dmgStyles.addBtn, { backgroundColor: colors.primary }]}
          onPress={handleAdd}
          activeOpacity={0.85}
        >
          <Text style={dmgStyles.addBtnText}>Add Damage</Text>
        </TouchableOpacity>

        <TouchableOpacity style={dmgStyles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={[dmgStyles.cancelBtnText, { color: colors.muted }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const dmgStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "700", marginBottom: 20 },
  subLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 13, fontWeight: "600" },
  severityRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  severityBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5 },
  severityDot: { width: 10, height: 10, borderRadius: 5 },
  severityText: { fontSize: 14, fontWeight: "600" },
  addBtn: { paddingVertical: 15, borderRadius: 12, alignItems: "center", marginBottom: 10 },
  addBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelBtn: { paddingVertical: 10, alignItems: "center" },
  cancelBtnText: { fontSize: 15 },
});

// ─── Main Inspection Modal ────────────────────────────────────────────────────

export function VehicleInspectionModal({ visible, vehicleLabel, vin, initialData, onSave, onCancel, onRequestPhotoSession: _onRequestPhotoSession }: Props) {
  const colors = useColors();
  const [photos, setPhotos] = useState<string[]>(initialData?.photos ?? []);
  const [damages, setDamages] = useState<DamageItem[]>(initialData?.damages ?? []);
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [damageSelectorVisible, setDamageSelectorVisible] = useState(false);
  // Reset when opened with new data
  useEffect(() => {
    if (visible) {
      setPhotos(initialData?.photos ?? []);
      setDamages(initialData?.damages ?? []);
      setNotes(initialData?.notes ?? "");
    }
  }, [visible]);

  const handleZoneTap = (zone: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedZone(zone);
    setDamageSelectorVisible(true);
  };

  const handleAddDamage = (type: string, severity: string) => {
    const newDamage: DamageItem = {
      id: Math.random().toString(36).slice(2),
      zone: selectedZone!,
      type,
      severity,
    };
    setDamages((prev) => [...prev, newDamage]);
    setDamageSelectorVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleRemoveDamage = (id: string) => {
    Alert.alert("Remove Damage", "Remove this damage entry?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => setDamages((prev) => prev.filter((d) => d.id !== id)) },
    ]);
  };

  // ── Photo session handlers ────────────────────────────────────────────────

  const handleOpenPhotoSession = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Register callback in the global store then navigate to the dedicated camera route.
    // This avoids iOS nested-modal blocking (inspection uses pageSheet, camera needs fullScreenModal).
    cameraSessionStore.open(
      (newPhotos) => {
        setPhotos((prev) => [...prev, ...newPhotos]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
      { vehicleId: vin }
    );
    router.push("/camera-session");
  };

  const handlePickFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 1,  // No compression — preserve original quality
      });
      if (!result.canceled) {
        setPhotos((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert("Library Error", "Could not open photo library.");
    }
  };

  const handleRemovePhoto = (uri: string) => {
    Alert.alert("Remove Photo?", "Remove this photo from the inspection?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => setPhotos((prev) => prev.filter((p) => p !== uri)) },
    ]);
  };

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({ photos, damages, notes });
  };

  const handleCancel = () => {
    Alert.alert("Discard Changes?", "Any unsaved inspection changes will be lost.", [
      { text: "Keep Editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onCancel },
    ]);
  };

  const zoneName = (id: string) => DAMAGE_ZONES.find((z) => z.id === id)?.label ?? id;
  const severityColor = (s: string) => DAMAGE_SEVERITIES.find((x) => x.label === s)?.color ?? "#999";

  // Progress summary for header
  const progressItems = [
    { done: damages.length > 0, label: `${damages.length} damage${damages.length !== 1 ? "s" : ""}` },
    { done: photos.length > 0, label: `${photos.length} photo${photos.length !== 1 ? "s" : ""}` },
    { done: notes.trim().length > 0, label: "Notes" },
  ];

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>

          {/* ── Header ── */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={handleCancel} style={styles.headerBtn} activeOpacity={0.7}>
              <Text style={[styles.headerBtnText, { color: colors.error }]}>Cancel</Text>
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>Pickup Inspection</Text>
              <Text style={[styles.headerSub, { color: colors.muted }]} numberOfLines={1}>{vehicleLabel}</Text>
            </View>
            <TouchableOpacity onPress={handleSave} style={[styles.saveBtn, { backgroundColor: colors.primary }]} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>

          {/* ── Progress bar ── */}
          <View style={[styles.progressBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            {progressItems.map((item, i) => (
              <View key={i} style={styles.progressItem}>
                <View style={[styles.progressDot, { backgroundColor: item.done ? colors.success : colors.border }]} />
                <Text style={[styles.progressLabel, { color: item.done ? colors.success : colors.muted }]}>
                  {item.label}
                </Text>
              </View>
            ))}
            {vin ? (
              <View style={styles.progressItem}>
                <IconSymbol name="barcode.viewfinder" size={12} color={colors.muted} />
                <Text style={[styles.progressLabel, { color: colors.muted }]} numberOfLines={1}>
                  {vin.slice(-6)}
                </Text>
              </View>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

            {/* ── Damage Wireframe ── */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Vehicle Condition</Text>
            <VehicleWireframe damages={damages} onZoneTap={handleZoneTap} />

            {/* ── Damage List ── */}
            {damages.length > 0 && (
              <View style={[styles.damageList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.damageListTitle, { color: colors.foreground }]}>
                  Marked Damages ({damages.length})
                </Text>
                {damages.map((d) => (
                  <View key={d.id} style={[styles.damageRow, { borderTopColor: colors.border }]}>
                    <View style={[styles.severityStripe, { backgroundColor: severityColor(d.severity) }]} />
                    <View style={styles.damageInfo}>
                      <Text style={[styles.damageZone, { color: colors.foreground }]}>{zoneName(d.zone)}</Text>
                      <Text style={[styles.damageDetail, { color: colors.muted }]}>{d.type} · {d.severity}</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleRemoveDamage(d.id)} activeOpacity={0.7} style={styles.removeBtn}>
                      <IconSymbol name="xmark.circle.fill" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* ── Inspection Photos ── */}
            <View style={styles.photoSectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 2 }]}>
                  Inspection Photos
                </Text>
                <Text style={[styles.sectionHint, { color: colors.muted }]}>
                  Front, rear, both sides, odometer, VIN plate, and any damage.
                </Text>
              </View>
              {photos.length > 0 && (
                <View style={[styles.photoCountBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.photoCountText}>{photos.length}</Text>
                </View>
              )}
            </View>

            {/* ── Photo action buttons ── */}
            <View style={styles.photoActions}>
              {/* Primary: open multi-shot camera session */}
              <TouchableOpacity
                style={[styles.photoSessionBtn, { backgroundColor: colors.primary }]}
                onPress={handleOpenPhotoSession}
                activeOpacity={0.85}
              >
                <IconSymbol name="camera.fill" size={20} color="#fff" />
                <View style={styles.photoSessionBtnText}>
                  <Text style={styles.photoSessionBtnTitle}>Take Photos</Text>
                  <Text style={styles.photoSessionBtnSub}>Keep shooting until done</Text>
                </View>
                <IconSymbol name="chevron.right" size={16} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>

              {/* Secondary: pick from library */}
              <TouchableOpacity
                style={[styles.libraryBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={handlePickFromLibrary}
                activeOpacity={0.8}
              >
                <IconSymbol name="photo.on.rectangle" size={18} color={colors.muted} />
                <Text style={[styles.libraryBtnText, { color: colors.muted }]}>Library</Text>
              </TouchableOpacity>
            </View>

            {/* ── Photo grid ── */}
            {photos.length > 0 && (
              <View style={styles.photoGrid}>
                {photos.map((uri, idx) => (
                  <TouchableOpacity
                    key={uri + idx}
                    style={styles.photoThumb}
                    onPress={() => handleRemovePhoto(uri)}
                    activeOpacity={0.85}
                  >
                    <Image source={{ uri }} style={styles.photoThumbImg} />
                    <View style={styles.photoRemoveBtn}>
                      <IconSymbol name="xmark.circle.fill" size={20} color="#fff" />
                    </View>
                    <View style={[styles.photoIndexBadge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.photoIndexText}>{idx + 1}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {/* Add more button */}
                <TouchableOpacity
                  style={[styles.addMoreBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary }]}
                  onPress={handleOpenPhotoSession}
                  activeOpacity={0.8}
                >
                  <IconSymbol name="plus" size={20} color={colors.primary} />
                  <Text style={[styles.addMoreBtnText, { color: colors.primary }]}>More</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Notes ── */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notes</Text>
            <TextInput
              style={[styles.notesInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add any additional notes about the vehicle condition..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {/* ── Save Button ── */}
            <TouchableOpacity
              style={[styles.saveLoadBtn, { backgroundColor: colors.primary }]}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <IconSymbol name="checkmark.circle.fill" size={20} color="#fff" />
              <Text style={styles.saveLoadBtnText}>Save Inspection</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>

        {/* Damage Selector */}
        <DamageSelectorModal
          visible={damageSelectorVisible}
          zone={selectedZone ?? ""}
          onAdd={handleAddDamage}
          onClose={() => setDamageSelectorVisible(false)}
        />
      </Modal>

    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 16 : 12,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  headerBtn: { padding: 4, minWidth: 60 },
  headerBtnText: { fontSize: 16 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerSub: { fontSize: 12, marginTop: 1 },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minWidth: 60, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Progress bar
  progressBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 16,
    borderBottomWidth: 0.5,
  },
  progressItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressLabel: { fontSize: 12, fontWeight: "600" },

  scroll: { padding: 20 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6, marginTop: 4 },
  sectionHint: { fontSize: 13, marginBottom: 14 },

  damageList: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
    overflow: "hidden",
  },
  damageListTitle: { fontSize: 14, fontWeight: "700", padding: 12 },
  damageRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 0.5,
    paddingVertical: 10,
    paddingRight: 12,
  },
  severityStripe: { width: 4, height: "100%", marginRight: 10 },
  damageInfo: { flex: 1 },
  damageZone: { fontSize: 14, fontWeight: "600" },
  damageDetail: { fontSize: 12, marginTop: 2 },
  removeBtn: { padding: 4 },

  // Photo section
  photoSectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 4,
  },
  photoCountBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    marginTop: 2,
  },
  photoCountText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  // Photo action buttons
  photoActions: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  photoSessionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  photoSessionBtnText: { flex: 1 },
  photoSessionBtnTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },
  photoSessionBtnSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 1 },
  libraryBtn: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    minWidth: 72,
  },
  libraryBtnText: { fontSize: 11, fontWeight: "600" },

  // Photo grid
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  photoThumb: { width: 90, height: 90, borderRadius: 12, overflow: "hidden" },
  photoThumbImg: { width: "100%", height: "100%" },
  photoRemoveBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
  },
  photoIndexBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  photoIndexText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  addMoreBtn: {
    width: 90,
    height: 90,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addMoreBtnText: { fontSize: 11, fontWeight: "700" },

  notesInput: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    fontSize: 15,
    minHeight: 100,
    marginBottom: 24,
  },
  saveLoadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  saveLoadBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
