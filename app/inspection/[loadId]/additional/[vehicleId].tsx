import React, { useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Modal,
  FlatList,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { AdditionalInspection } from "@/lib/data";

// ─── YES/NO Toggle ────────────────────────────────────────────────────────────

function YesNoToggle({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={[toggleStyles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        style={[
          toggleStyles.btn,
          toggleStyles.btnLeft,
          { borderColor: colors.border },
          value === true && { backgroundColor: colors.success + "25", borderColor: colors.success },
        ]}
        onPress={() => { onChange(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        activeOpacity={0.7}
      >
        <Text style={[toggleStyles.btnText, { color: value === true ? colors.success : colors.muted }]}>
          YES
        </Text>
      </TouchableOpacity>
      <View style={[toggleStyles.divider, { backgroundColor: colors.border }]} />
      <TouchableOpacity
        style={[
          toggleStyles.btn,
          toggleStyles.btnRight,
          { borderColor: colors.border },
          value === false && { backgroundColor: colors.error + "20", borderColor: colors.error },
        ]}
        onPress={() => { onChange(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        activeOpacity={0.7}
      >
        <Text style={[toggleStyles.btnText, { color: value === false ? colors.error : colors.muted }]}>
          NO
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const toggleStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    height: 40,
  },
  btn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
  },
  btnLeft: { borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  btnRight: { borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  divider: { width: 1 },
  btnText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
});

// ─── Number Picker ────────────────────────────────────────────────────────────

const COUNT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function NumberPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const colors = useColors();
  const [modalVisible, setModalVisible] = useState(false);

  const displayLabel = value === null ? "Choose" : String(value);

  return (
    <>
      <TouchableOpacity
        style={[pickerStyles.trigger, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => { setModalVisible(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        activeOpacity={0.7}
      >
        <Text style={[pickerStyles.triggerText, { color: value === null ? colors.muted : colors.foreground }]}>
          {displayLabel}
        </Text>
        <IconSymbol name="chevron.up.chevron.down" size={14} color={colors.muted} />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <TouchableOpacity style={pickerStyles.overlay} activeOpacity={1} onPress={() => setModalVisible(false)} />
        <View style={[pickerStyles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[pickerStyles.sheetTitle, { color: colors.muted }]}>Select Count</Text>
          <FlatList
            data={COUNT_OPTIONS}
            keyExtractor={(item) => String(item)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  pickerStyles.option,
                  { borderColor: colors.border },
                  item === value && { backgroundColor: colors.primary + "15" },
                ]}
                onPress={() => {
                  onChange(item);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setModalVisible(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={[pickerStyles.optionText, { color: item === value ? colors.primary : colors.foreground }]}>
                  {item}
                </Text>
                {item === value && <IconSymbol name="checkmark" size={16} color={colors.primary} />}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </>
  );
}

const pickerStyles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    height: 40,
    minWidth: 110,
  },
  triggerText: { fontSize: 14, fontWeight: "500" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingTop: 16,
    paddingBottom: 40,
    maxHeight: 360,
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
    marginBottom: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  optionText: { fontSize: 17, fontWeight: "500" },
});

// ─── Row component ────────────────────────────────────────────────────────────

function InspectionRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={[rowStyles.row, { borderColor: colors.border }]}>
      <Text style={[rowStyles.label, { color: colors.foreground }]}>{label}</Text>
      {children}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
  },
  label: { fontSize: 16, fontWeight: "400", flex: 1 },
});

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <View style={[sectionStyles.header, { backgroundColor: colors.surface }]}>
      <Text style={[sectionStyles.title, { color: colors.muted }]}>{title}</Text>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdditionalInspectionScreen() {
  const colors = useColors();
  const { loadId, vehicleId } = useLocalSearchParams<{ loadId: string; vehicleId: string }>();
  const { loads, savePickupInspection, saveDeliveryInspection } = useLoads();

  const load = loads.find((l) => l.id === loadId);
  const vehicle = load?.vehicles.find((v) => v.id === vehicleId);
  const isDelivery = (useLocalSearchParams<{ type?: string }>().type ?? "pickup") === "delivery";

  const existingAdditional = isDelivery
    ? vehicle?.deliveryInspection?.additionalInspection
    : vehicle?.pickupInspection?.additionalInspection;

  // ── Form state ──────────────────────────────────────────────────────────────
  const [odometer, setOdometer] = useState(existingAdditional?.odometer ?? "");
  const [notes, setNotes] = useState(existingAdditional?.notes ?? "");

  // Additional Inspection YES/NO
  const [drivable, setDrivable] = useState<boolean | null>(existingAdditional?.drivable ?? null);
  const [windscreen, setWindscreen] = useState<boolean | null>(existingAdditional?.windscreen ?? null);
  const [glassesIntact, setGlassesIntact] = useState<boolean | null>(existingAdditional?.glassesIntact ?? null);
  const [titlePresent, setTitlePresent] = useState<boolean | null>(existingAdditional?.titlePresent ?? null);
  const [billOfSale, setBillOfSale] = useState<boolean | null>(existingAdditional?.billOfSale ?? null);

  // Loose Items
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

  const handleSave = () => {
    const additionalInspection: AdditionalInspection = {
      odometer,
      notes,
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
    };

    // Merge into the existing inspection
    const existingInspection = isDelivery
      ? vehicle?.deliveryInspection
      : vehicle?.pickupInspection;

    if (existingInspection) {
      const updatedInspection = { ...existingInspection, additionalInspection };
      if (isDelivery) {
        saveDeliveryInspection(loadId, vehicleId, updatedInspection);
      } else {
        savePickupInspection(loadId, vehicleId, updatedInspection);
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Navigate back to load detail (pop all inspection screens)
    router.dismiss(2);
  };

  const handleCancel = () => {
    router.back();
  };

  if (!load || !vehicle) {
    return (
      <ScreenContainer>
        <Text style={{ color: colors.foreground, padding: 20 }}>Vehicle not found.</Text>
      </ScreenContainer>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Navigation Header */}
      <View style={[styles.navHeader, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
          <Text style={[styles.cancelBtnText, { color: colors.primary }]}>Cancel</Text>
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <Text style={[styles.navTitle, { color: colors.foreground }]}>Additional Inspection</Text>
          <Text style={[styles.navSubtitle, { color: colors.muted }]}>
            {isDelivery ? "Delivery" : "Pickup"} Inspection
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Odometer */}
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <IconSymbol name="gauge" size={20} color={colors.muted} style={{ marginRight: 10 }} />
            <TextInput
              style={[styles.textInput, { color: colors.foreground }]}
              value={odometer}
              onChangeText={setOdometer}
              placeholder="Odometer"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              returnKeyType="done"
            />
          </View>

          {/* Notes */}
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <IconSymbol name="doc.text" size={20} color={colors.muted} style={{ marginRight: 10 }} />
            <TextInput
              style={[styles.textInput, { color: colors.foreground }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes (Optional)"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
            />
          </View>

          {/* Additional Inspection Section */}
          <SectionHeader title="Additional Inspection" />

          <InspectionRow label="Drivable">
            <YesNoToggle value={drivable} onChange={setDrivable} />
          </InspectionRow>

          <InspectionRow label="Windscreen">
            <YesNoToggle value={windscreen} onChange={setWindscreen} />
          </InspectionRow>

          <InspectionRow label="Glasses (all intact)">
            <YesNoToggle value={glassesIntact} onChange={setGlassesIntact} />
          </InspectionRow>

          <InspectionRow label="Title">
            <YesNoToggle value={titlePresent} onChange={setTitlePresent} />
          </InspectionRow>

          <InspectionRow label="Bill of Sale">
            <YesNoToggle value={billOfSale} onChange={setBillOfSale} />
          </InspectionRow>

          {/* Loose Items Section */}
          <SectionHeader title="Loose Items Inspection" />

          <InspectionRow label="Keys">
            <NumberPicker value={keys} onChange={setKeys} />
          </InspectionRow>

          <InspectionRow label="Remotes">
            <NumberPicker value={remotes} onChange={setRemotes} />
          </InspectionRow>

          <InspectionRow label="Headrests">
            <NumberPicker value={headrests} onChange={setHeadrests} />
          </InspectionRow>

          <InspectionRow label="Cargo Cover">
            <YesNoToggle value={cargoCover} onChange={setCargoCover} />
          </InspectionRow>

          <InspectionRow label="Spare Tire">
            <YesNoToggle value={spareTire} onChange={setSpareTire} />
          </InspectionRow>

          <InspectionRow label="Radio">
            <YesNoToggle value={radio} onChange={setRadio} />
          </InspectionRow>

          <InspectionRow label="Manuals">
            <YesNoToggle value={manuals} onChange={setManuals} />
          </InspectionRow>

          <InspectionRow label="Navigation Disk">
            <YesNoToggle value={navigationDisk} onChange={setNavigationDisk} />
          </InspectionRow>

          <InspectionRow label="Plugin Charger Cable">
            <YesNoToggle value={pluginChargerCable} onChange={setPluginChargerCable} />
          </InspectionRow>

          <InspectionRow label="Headphones">
            <YesNoToggle value={headphones} onChange={setHeadphones} />
          </InspectionRow>

          {/* Bottom Save Button */}
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={[styles.bottomSaveBtn, { backgroundColor: colors.primary }]}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <IconSymbol name="checkmark.circle.fill" size={20} color="#fff" />
              <Text style={styles.bottomSaveBtnText}>Save & Complete Inspection</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  cancelBtn: { minWidth: 60 },
  cancelBtnText: { fontSize: 17 },
  navCenter: { flex: 1, alignItems: "center" },
  navTitle: { fontSize: 17, fontWeight: "700" },
  navSubtitle: { fontSize: 12, marginTop: 1 },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },

  bottomActions: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  bottomSaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  bottomSaveBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
