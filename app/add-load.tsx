import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { Load, ContactInfo } from "@/lib/data";
import {
  registerVINCallback,
  unregisterVINCallback,
  setPendingVehicleId,
  setVINLaunchContext,
  type VINDecodeResult,
} from "@/lib/vin-store";
import { VehicleInspectionModal, type InspectionResult } from "./vehicle-inspection-modal";
import { cameraSessionStore } from "@/lib/camera-session-store";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DamageItem {
  id: string;
  zone: string;
  type: string;
  severity: string;
}

interface FormVehicle {
  id: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  color: string;
  bodyType: string;
  vinVerified: boolean;
  vinLoading: boolean;
  // Inspection data
  inspectionComplete: boolean;
  inspectionPhotos: string[];
  inspectionDamages: DamageItem[];
  inspectionNotes: string;
}

interface FormContact {
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface FormExpense {
  id: string;
  description: string;
  amount: string;
}

const emptyContact = (): FormContact => ({
  name: "", company: "", phone: "", email: "",
  address: "", city: "", state: "", zip: "",
});

const emptyVehicle = (): FormVehicle => ({
  id: Math.random().toString(36).slice(2),
  vin: "", year: "", make: "", model: "",
  color: "", bodyType: "", vinVerified: false, vinLoading: false,
  inspectionComplete: false,
  inspectionPhotos: [],
  inspectionDamages: [],
  inspectionNotes: "",
});

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, icon, expanded, onToggle }: {
  title: string; icon: string; expanded: boolean; onToggle: () => void;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.sectionHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      <View style={[styles.sectionIconWrap, { backgroundColor: colors.primary + "18" }]}>
        <IconSymbol name={icon as any} size={16} color={colors.primary} />
      </View>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <IconSymbol
        name={expanded ? "xmark" : "chevron.right"}
        size={16}
        color={colors.muted}
      />
    </TouchableOpacity>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, required }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  autoCapitalize?: any;
  required?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>
        {label}{required && <Text style={{ color: colors.error }}> *</Text>}
      </Text>
      <TextInput
        style={[styles.fieldInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? ""}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        returnKeyType="next"
      />
    </View>
  );
}

// ─── Vehicle Card ─────────────────────────────────────────────────────────────

function VehicleCard({
  vehicle,
  index,
  onUpdate,
  onRemove,
  onScanVIN,
  onStartInspection,
}: {
  vehicle: FormVehicle;
  index: number;
  onUpdate: (id: string, field: keyof FormVehicle, value: string) => void;
  onRemove: (id: string) => void;
  onScanVIN: (vehicleId: string) => void;
  onStartInspection: (vehicleId: string) => void;
}) {
  const colors = useColors();
  const [lookingUp, setLookingUp] = useState(false);

  const handleVINLookup = async (vin: string) => {
    if (vin.length !== 17) return;
    setLookingUp(true);
    try {
      const res = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`
      );
      const data = await res.json();
      const result = data?.Results?.[0];
      if (result && result.ErrorCode === "0") {
        onUpdate(vehicle.id, "year", result.ModelYear ?? "");
        onUpdate(vehicle.id, "make", result.Make ?? "");
        onUpdate(vehicle.id, "model", result.Model ?? "");
        onUpdate(vehicle.id, "bodyType", result.BodyClass ?? "");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // silent fail — user can fill manually
    } finally {
      setLookingUp(false);
    }
  };

  return (
    <View style={[styles.vehicleCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      {/* Vehicle header */}
      <View style={[styles.vehicleCardHeader, { borderBottomColor: colors.border }]}>
        <View style={[styles.vehicleNumBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.vehicleNumText}>{index + 1}</Text>
        </View>
        <Text style={[styles.vehicleCardTitle, { color: colors.foreground }]}>
          {vehicle.make && vehicle.model
            ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
            : `Vehicle ${index + 1}`}
        </Text>
        <TouchableOpacity onPress={() => onRemove(vehicle.id)} activeOpacity={0.7} style={styles.removeVehicleBtn}>
          <IconSymbol name="trash.fill" size={15} color={colors.error} />
        </TouchableOpacity>
      </View>

      <View style={styles.vehicleCardBody}>
        {/* VIN Row */}
        <View style={styles.vinRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>VIN</Text>
            <TextInput
              style={[styles.fieldInput, { backgroundColor: colors.surface, borderColor: vehicle.vinVerified ? colors.success : colors.border, color: colors.foreground }]}
              value={vehicle.vin}
              onChangeText={(v) => {
                const upper = v.toUpperCase();
                onUpdate(vehicle.id, "vin", upper);
                if (upper.length === 17) handleVINLookup(upper);
              }}
              placeholder="Enter 17-digit VIN"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              maxLength={17}
              returnKeyType="done"
            />
          </View>
          <TouchableOpacity
            style={[styles.scanVINBtn, { backgroundColor: colors.primary }]}
            onPress={() => onScanVIN(vehicle.id)}
            activeOpacity={0.85}
          >
            {lookingUp ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <IconSymbol name="barcode.viewfinder" size={18} color="#FFFFFF" />
                <Text style={styles.scanVINBtnText}>Scan</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {vehicle.vinVerified && (
          <View style={[styles.vinVerifiedBadge, { backgroundColor: colors.success + "18" }]}>
            <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
            <Text style={[styles.vinVerifiedText, { color: colors.success }]}>VIN Verified</Text>
          </View>
        )}

        {/* Year / Make / Model / Color */}
        <View style={styles.fieldRow}>
          <View style={{ flex: 1 }}>
            <Field label="Year" value={vehicle.year} onChangeText={(v) => onUpdate(vehicle.id, "year", v)} placeholder="2022" keyboardType="numeric" />
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Make" value={vehicle.make} onChangeText={(v) => onUpdate(vehicle.id, "make", v)} placeholder="Ford" autoCapitalize="words" />
          </View>
        </View>
        <View style={styles.fieldRow}>
          <View style={{ flex: 2 }}>
            <Field label="Model" value={vehicle.model} onChangeText={(v) => onUpdate(vehicle.id, "model", v)} placeholder="F-150" autoCapitalize="words" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Color" value={vehicle.color} onChangeText={(v) => onUpdate(vehicle.id, "color", v)} placeholder="White" autoCapitalize="words" />
          </View>
        </View>
        {vehicle.bodyType ? (
          <View style={[styles.bodyTypeBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="car.fill" size={12} color={colors.muted} />
            <Text style={[styles.bodyTypeText, { color: colors.muted }]}>{vehicle.bodyType}</Text>
          </View>
        ) : null}

        {/* ── Inspection Button / Badge ── */}
        {vehicle.inspectionComplete ? (
          <View style={[styles.inspectionCompleteBadge, { backgroundColor: colors.success + "15", borderColor: colors.success + "50" }]}>
            <IconSymbol name="checkmark.seal.fill" size={16} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.inspectionCompleteTitle, { color: colors.success }]}>Inspection Complete</Text>
              <Text style={[styles.inspectionCompleteDetail, { color: colors.muted }]}>
                {vehicle.inspectionDamages.length} damage{vehicle.inspectionDamages.length !== 1 ? "s" : ""} · {vehicle.inspectionPhotos.length} photo{vehicle.inspectionPhotos.length !== 1 ? "s" : ""}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.editInspectionBtn, { borderColor: colors.success }]}
              onPress={() => onStartInspection(vehicle.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.editInspectionBtnText, { color: colors.success }]}>Edit</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.startInspectionBtn, { backgroundColor: colors.primary + "12", borderColor: colors.primary }]}
            onPress={() => onStartInspection(vehicle.id)}
            activeOpacity={0.85}
          >
            <IconSymbol name="magnifyingglass" size={16} color={colors.primary} />
            <Text style={[styles.startInspectionBtnText, { color: colors.primary }]}>Start Pickup Inspection</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Contact Section ──────────────────────────────────────────────────────────

function ContactSection({ contact, onChange }: {
  contact: FormContact;
  onChange: (field: keyof FormContact, value: string) => void;
}) {
  return (
    <View style={styles.sectionBody}>
      <Field label="Name" value={contact.name} onChangeText={(v) => onChange("name", v)} placeholder="John Smith" autoCapitalize="words" />
      <Field label="Company" value={contact.company} onChangeText={(v) => onChange("company", v)} placeholder="ABC Auto" autoCapitalize="words" />
      <View style={styles.fieldRow}>
        <View style={{ flex: 1 }}>
          <Field label="Phone" value={contact.phone} onChangeText={(v) => onChange("phone", v)} placeholder="(555) 000-0000" keyboardType="phone-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Email" value={contact.email} onChangeText={(v) => onChange("email", v)} placeholder="email@co.com" keyboardType="email-address" autoCapitalize="none" />
        </View>
      </View>
      <Field label="Address" value={contact.address} onChangeText={(v) => onChange("address", v)} placeholder="123 Main St" />
      <View style={styles.fieldRow}>
        <View style={{ flex: 2 }}>
          <Field label="City" value={contact.city} onChangeText={(v) => onChange("city", v)} placeholder="Chicago" autoCapitalize="words" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="State" value={contact.state} onChangeText={(v) => onChange("state", v)} placeholder="IL" autoCapitalize="characters" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="ZIP" value={contact.zip} onChangeText={(v) => onChange("zip", v)} placeholder="60601" keyboardType="numeric" />
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AddLoadScreen() {
  const colors = useColors();
  const { addLoad } = useLoads();

  // Prefill params from VIN scanner
  const params = useLocalSearchParams<{
    prefillVin?: string;
    prefillYear?: string;
    prefillMake?: string;
    prefillModel?: string;
    prefillBodyType?: string;
    prefillEngineSize?: string;
    prefillTrim?: string;
    prefillIsPartial?: string;
  }>();

  const isFromVINScan = !!params.prefillVin;

  // Sections expanded state
  const [vehiclesExpanded, setVehiclesExpanded] = useState(true);
  const [pickupExpanded, setPickupExpanded] = useState(false);
  const [deliveryExpanded, setDeliveryExpanded] = useState(false);
  const [shipperExpanded, setShipperExpanded] = useState(false);
  const [paymentExpanded, setPaymentExpanded] = useState(false);
  const [expensesExpanded, setExpensesExpanded] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);

  // Form state — pre-fill first vehicle if coming from VIN scan
  const [vehicles, setVehicles] = useState<FormVehicle[]>(() => {
    if (params.prefillVin) {
      return [{
        id: Math.random().toString(36).slice(2),
        vin: params.prefillVin,
        year: params.prefillYear || "",
        make: params.prefillMake || "",
        model: params.prefillModel || "",
        color: "",
        bodyType: params.prefillBodyType || "",
        vinVerified: params.prefillIsPartial !== "1",
        vinLoading: false,
        inspectionComplete: false,
        inspectionPhotos: [],
        inspectionDamages: [],
        inspectionNotes: "",
      }];
    }
    return [emptyVehicle()];
  });
  const [pickup, setPickup] = useState<FormContact>(emptyContact());
  const [pickupDate, setPickupDate] = useState("");
  const [delivery, setDelivery] = useState<FormContact>(emptyContact());
  const [deliveryDate, setDeliveryDate] = useState("");
  const [shipper, setShipper] = useState<FormContact>(emptyContact());
  const [driverPay, setDriverPay] = useState("");
  const [paymentType, setPaymentType] = useState<"cod" | "ach" | "check" | "factoring">("cod");
  const [notes, setNotes] = useState("");
  const [expenses, setExpenses] = useState<FormExpense[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [pickupLocating, setPickupLocating] = useState(false);
  const [deliveryLocating, setDeliveryLocating] = useState(false);

  // Inspection modal state
  const [inspectionVehicleId, setInspectionVehicleId] = useState<string | null>(null);
  const inspectionVehicle = vehicles.find((v) => v.id === inspectionVehicleId) ?? null;

  // Photo session — navigates to dedicated /camera-session route to avoid iOS nested-modal blocking
  const handleRequestPhotoSession = React.useCallback((addPhotos: (uris: string[]) => void) => {
    cameraSessionStore.open(addPhotos, { vehicleId: inspectionVehicle?.vin });
    router.push("/camera-session");
  }, [inspectionVehicle?.vin])

  const handleStartInspection = (vehicleId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setInspectionVehicleId(vehicleId);
  };

  const handleSaveInspection = (result: InspectionResult) => {
    if (!inspectionVehicleId) return;
    setVehicles((prev) =>
      prev.map((v) =>
        v.id === inspectionVehicleId
          ? {
              ...v,
              inspectionComplete: true,
              inspectionPhotos: result.photos,
              inspectionDamages: result.damages,
              inspectionNotes: result.notes,
            }
          : v
      )
    );
    setInspectionVehicleId(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleCancelInspection = () => {
    setInspectionVehicleId(null);
  };

  // Register VIN callback so scanner can deliver results back to this screen
  React.useEffect(() => {
    registerVINCallback((vehicleId: string, result: VINDecodeResult) => {
      setVehicles((prev) =>
        prev.map((v) => {
          if (v.id !== vehicleId) return v;
          return {
            ...v,
            vin: result.vin,
            year: result.year || v.year,
            make: result.make || v.make,
            model: result.model || v.model,
            bodyType: result.bodyType || v.bodyType,
            vinVerified: !result.isPartial,
          };
        })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    return () => unregisterVINCallback();
  }, []);

  const handleUpdateVehicle = (id: string, field: keyof FormVehicle, value: string) => {
    setVehicles((prev) => prev.map((v) => v.id === id ? { ...v, [field]: value } : v));
  };

  const handleAddVehicle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVehicles((prev) => [...prev, emptyVehicle()]);
  };

  const handleRemoveVehicle = (id: string) => {
    if (vehicles.length === 1) {
      Alert.alert("Cannot Remove", "A load must have at least one vehicle.");
      return;
    }
    setVehicles((prev) => prev.filter((v) => v.id !== id));
  };

  const handleScanVIN = (vehicleId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPendingVehicleId(vehicleId);
    setVINLaunchContext("existing-vehicle"); // going back to this form, not a fresh scan
    router.push("/vin-scanner" as any);
  };

  const handleAddAttachment = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setAttachments((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
    }
  };

  const handleTakeAttachmentPhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setAttachments((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const handleUpdateContact = (
    setter: React.Dispatch<React.SetStateAction<FormContact>>,
    field: keyof FormContact,
    value: string
  ) => {
    setter((prev) => ({ ...prev, [field]: value }));
  };

  const handleAutoLocate = async (
    setter: React.Dispatch<React.SetStateAction<FormContact>>,
    setLocating: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    setLocating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location Permission Needed",
          "Please allow Puls Dispatch to access your location in Settings to use this feature.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Location.requestForegroundPermissionsAsync() },
          ]
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geo) {
        setter((prev) => ({
          ...prev,
          address: geo.name || geo.street || "",
          city: geo.city || geo.subregion || "",
          state: geo.region || "",
          zip: geo.postalCode || "",
        }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Location Error", "Could not determine address from your current location.");
      }
    } catch {
      Alert.alert("Location Error", "Unable to get your location. Please try again or enter the address manually.");
    } finally {
      setLocating(false);
    }
  };

  const handleAddExpense = () => {
    setExpenses((prev) => [...prev, { id: Math.random().toString(36).slice(2), description: "", amount: "" }]);
  };

  const handleRemoveExpense = (id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  };

  const handleSave = async () => {
    // Validation
    const hasVehicle = vehicles.some((v) => v.make || v.model || v.vin);
    if (!hasVehicle) {
      Alert.alert("Add a Vehicle", "Please add at least one vehicle with a make, model, or VIN.");
      return;
    }

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const newLoad: Load = {
        id: `load-${Date.now()}`,
        loadNumber: `LD-${Math.floor(Math.random() * 90000) + 10000}`,
        status: "new",
        vehicles: vehicles.map((v) => ({
          id: v.id,
          year: v.year || "—",
          make: v.make || "Unknown",
          model: v.model || "Unknown",
          color: v.color || "—",
          vin: v.vin || "—",
        })),
        pickup: {
          contact: pickup as ContactInfo,
          date: pickupDate || new Date().toISOString(),
          lat: 41.8781,
          lng: -87.6298,
        },
        delivery: {
          contact: delivery as ContactInfo,
          date: deliveryDate || new Date().toISOString(),
          lat: 33.749,
          lng: -84.388,
        },
        driverPay: parseFloat(driverPay) || 0,
        paymentType,
        notes,
        assignedAt: new Date().toISOString(),
      };

      addLoad(newLoad);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert("Error", "Could not save the load. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const PAYMENT_TYPES: { key: "cod" | "ach" | "check" | "factoring"; label: string }[] = [
    { key: "cod", label: "COD" },
    { key: "ach", label: "ACH" },
    { key: "check", label: "Check" },
    { key: "factoring", label: "Factoring" },
  ];

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} style={styles.headerBack}>
          <IconSymbol name="xmark" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Load</Text>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: "#FFFFFF20" }, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── VIN Summary Banner (shown when launched from VIN scan) ── */}
          {isFromVINScan && params.prefillVin && (
            <View style={[styles.vinBanner, { backgroundColor: colors.success + "12", borderColor: colors.success + "40" }]}>
              <View style={styles.vinBannerLeft}>
                <View style={[styles.vinBannerIcon, { backgroundColor: colors.success + "20" }]}>
                  <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
                </View>
                <View style={styles.vinBannerText}>
                  <Text style={[styles.vinBannerTitle, { color: colors.foreground }]}>
                    {[params.prefillYear, params.prefillMake, params.prefillModel].filter(Boolean).join(" ") || "Vehicle Scanned"}
                  </Text>
                  <Text style={[styles.vinBannerSub, { color: colors.muted }]}>
                    VIN: {params.prefillVin}
                    {params.prefillBodyType ? `  •  ${params.prefillBodyType}` : ""}
                    {params.prefillEngineSize ? `  •  ${params.prefillEngineSize}` : ""}
                  </Text>
                </View>
              </View>
              <View style={[styles.vinVerifiedBadge, { backgroundColor: colors.success }]}>
                <Text style={styles.vinVerifiedText}>Verified</Text>
              </View>
            </View>
          )}

          {/* ── Vehicles Section ── */}
          <SectionHeader
            title={`Vehicles (${vehicles.length})`}
            icon="car.fill"
            expanded={vehiclesExpanded}
            onToggle={() => setVehiclesExpanded((v) => !v)}
          />
          {vehiclesExpanded && (
            <View style={styles.sectionBody}>
              {vehicles.map((v, i) => (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  index={i}
                  onUpdate={handleUpdateVehicle}
                  onRemove={handleRemoveVehicle}
                  onScanVIN={handleScanVIN}
                  onStartInspection={handleStartInspection}
                />
              ))}
              <TouchableOpacity
                style={[styles.addVehicleBtn, { borderColor: colors.primary }]}
                onPress={handleAddVehicle}
                activeOpacity={0.8}
              >
                <IconSymbol name="plus" size={16} color={colors.primary} />
                <Text style={[styles.addVehicleBtnText, { color: colors.primary }]}>Add Another Vehicle</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Pickup Section ── */}
          <SectionHeader
            title="Pickup Information"
            icon="location.fill"
            expanded={pickupExpanded}
            onToggle={() => setPickupExpanded((v) => !v)}
          />
          {pickupExpanded && (
            <View style={styles.sectionBody}>
              <TouchableOpacity
                style={[styles.gpsButton, { borderColor: colors.primary, backgroundColor: colors.primary + "12" }]}
                onPress={() => handleAutoLocate(setPickup, setPickupLocating)}
                activeOpacity={0.8}
                disabled={pickupLocating}
              >
                {pickupLocating ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <IconSymbol name="location.fill" size={16} color={colors.primary} />
                )}
                <Text style={[styles.gpsButtonText, { color: colors.primary }]}>
                  {pickupLocating ? "Locating..." : "Use My Current Location"}
                </Text>
              </TouchableOpacity>
              <ContactSection contact={pickup} onChange={(f, v) => handleUpdateContact(setPickup, f, v)} />
              <Field label="Pickup Date" value={pickupDate} onChangeText={setPickupDate} placeholder="MM/DD/YYYY" keyboardType="numeric" />
            </View>
          )}

          {/* ── Delivery Section ── */}
          <SectionHeader
            title="Delivery Information"
            icon="location.fill"
            expanded={deliveryExpanded}
            onToggle={() => setDeliveryExpanded((v) => !v)}
          />
          {deliveryExpanded && (
            <View style={styles.sectionBody}>
              <TouchableOpacity
                style={[styles.gpsButton, { borderColor: colors.primary, backgroundColor: colors.primary + "12" }]}
                onPress={() => handleAutoLocate(setDelivery, setDeliveryLocating)}
                activeOpacity={0.8}
                disabled={deliveryLocating}
              >
                {deliveryLocating ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <IconSymbol name="location.fill" size={16} color={colors.primary} />
                )}
                <Text style={[styles.gpsButtonText, { color: colors.primary }]}>
                  {deliveryLocating ? "Locating..." : "Use My Current Location"}
                </Text>
              </TouchableOpacity>
              <ContactSection contact={delivery} onChange={(f, v) => handleUpdateContact(setDelivery, f, v)} />
              <Field label="Delivery Date" value={deliveryDate} onChangeText={setDeliveryDate} placeholder="MM/DD/YYYY" keyboardType="numeric" />
            </View>
          )}

          {/* ── Shipper/Customer Section ── */}
          <SectionHeader
            title="Shipper / Customer"
            icon="person.fill"
            expanded={shipperExpanded}
            onToggle={() => setShipperExpanded((v) => !v)}
          />
          {shipperExpanded && (
            <View style={styles.sectionBody}>
              <ContactSection contact={shipper} onChange={(f, v) => handleUpdateContact(setShipper, f, v)} />
            </View>
          )}

          {/* ── Payment Section ── */}
          <SectionHeader
            title="Payment Information"
            icon="doc.text.fill"
            expanded={paymentExpanded}
            onToggle={() => setPaymentExpanded((v) => !v)}
          />
          {paymentExpanded && (
            <View style={styles.sectionBody}>
              <Field
                label="Driver Pay ($)"
                value={driverPay}
                onChangeText={setDriverPay}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
              <Text style={[styles.fieldLabel, { color: colors.muted, marginBottom: 8 }]}>PAYMENT TYPE</Text>
              <View style={styles.paymentTypeRow}>
                {PAYMENT_TYPES.map((pt) => (
                  <TouchableOpacity
                    key={pt.key}
                    style={[
                      styles.paymentTypeBtn,
                      { borderColor: paymentType === pt.key ? colors.primary : colors.border },
                      paymentType === pt.key && { backgroundColor: colors.primary + "14" },
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setPaymentType(pt.key);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.paymentTypeBtnText, { color: paymentType === pt.key ? colors.primary : colors.muted }]}>
                      {pt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Expenses Section ── */}
          <SectionHeader
            title={`Expenses${expenses.length > 0 ? ` (${expenses.length})` : ""}`}
            icon="doc.text.fill"
            expanded={expensesExpanded}
            onToggle={() => setExpensesExpanded((v) => !v)}
          />
          {expensesExpanded && (
            <View style={styles.sectionBody}>
              {expenses.map((exp, i) => (
                <View key={exp.id} style={[styles.expenseRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <TextInput
                    style={[styles.expenseDesc, { color: colors.foreground, borderColor: colors.border }]}
                    value={exp.description}
                    onChangeText={(v) => setExpenses((prev) => prev.map((e) => e.id === exp.id ? { ...e, description: v } : e))}
                    placeholder="Description"
                    placeholderTextColor={colors.muted}
                  />
                  <TextInput
                    style={[styles.expenseAmount, { color: colors.foreground, borderColor: colors.border }]}
                    value={exp.amount}
                    onChangeText={(v) => setExpenses((prev) => prev.map((e) => e.id === exp.id ? { ...e, amount: v } : e))}
                    placeholder="$0.00"
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity onPress={() => handleRemoveExpense(exp.id)} activeOpacity={0.7}>
                    <IconSymbol name="xmark" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={[styles.addVehicleBtn, { borderColor: colors.border }]}
                onPress={handleAddExpense}
                activeOpacity={0.8}
              >
                <IconSymbol name="plus" size={16} color={colors.muted} />
                <Text style={[styles.addVehicleBtnText, { color: colors.muted }]}>Add Expense</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Attachments Section ── */}
          <SectionHeader
            title={`Attachments${attachments.length > 0 ? ` (${attachments.length})` : ""}`}
            icon="paperclip"
            expanded={attachmentsExpanded}
            onToggle={() => setAttachmentsExpanded((v) => !v)}
          />
          {attachmentsExpanded && (
            <View style={styles.sectionBody}>
              <View style={styles.attachActionsRow}>
                <TouchableOpacity
                  style={[styles.attachActionBtn, { borderColor: colors.primary }]}
                  onPress={handleTakeAttachmentPhoto}
                  activeOpacity={0.8}
                >
                  <IconSymbol name="camera.fill" size={15} color={colors.primary} />
                  <Text style={[styles.attachActionBtnText, { color: colors.primary }]}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.attachActionBtn, { borderColor: colors.border }]}
                  onPress={handleAddAttachment}
                  activeOpacity={0.8}
                >
                  <IconSymbol name="photo.on.rectangle" size={15} color={colors.muted} />
                  <Text style={[styles.attachActionBtnText, { color: colors.muted }]}>Library</Text>
                </TouchableOpacity>
              </View>
              {attachments.length > 0 && (
                <View style={styles.attachmentsGrid}>
                  {attachments.map((uri, idx) => (
                    <View key={idx} style={styles.attachmentThumb}>
                      <Image source={{ uri }} style={styles.attachmentThumbImg} />
                      <TouchableOpacity
                        style={[styles.removeAttachBtn, { backgroundColor: "#00000080" }]}
                        onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        activeOpacity={0.8}
                      >
                        <IconSymbol name="xmark" size={11} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Notes */}
          <View style={[styles.notesSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>NOTES</Text>
            <TextInput
              style={[styles.notesInput, { color: colors.foreground, borderColor: colors.border }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add any notes about this load..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Save / Continue Button */}
          <TouchableOpacity
            style={[styles.mainSaveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : isFromVINScan ? (
              <>
                <IconSymbol name="pencil.and.outline" size={18} color="#FFFFFF" />
                <Text style={styles.mainSaveBtnText}>Continue to Pickup Signature</Text>
              </>
            ) : (
              <>
                <IconSymbol name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.mainSaveBtnText}>Save Load</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Per-vehicle Inspection Modal ── */}
      {inspectionVehicle && (
        <VehicleInspectionModal
          visible={!!inspectionVehicleId}
          vehicleLabel={
            [inspectionVehicle.year, inspectionVehicle.make, inspectionVehicle.model]
              .filter(Boolean)
              .join(" ") || `Vehicle`
          }
          vin={inspectionVehicle.vin}
          initialData={{
            photos: inspectionVehicle.inspectionPhotos,
            damages: inspectionVehicle.inspectionDamages,
            notes: inspectionVehicle.inspectionNotes,
          }}
          onSave={handleSaveInspection}
          onCancel={handleCancelInspection}
          onRequestPhotoSession={handleRequestPhotoSession}
        />
      )}

    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  headerBack: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 10,
    marginTop: 8,
  },
  sectionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  sectionBody: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 4,
  },
  vehicleCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  vehicleCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  vehicleNumBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleNumText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  vehicleCardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  removeVehicleBtn: {
    padding: 4,
  },
  vehicleCardBody: {
    padding: 14,
    gap: 4,
  },
  vinRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    marginBottom: 4,
  },
  scanVINBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  scanVINBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  vinVerifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 8,
  },
  vinVerifiedText: {
    fontSize: 12,
    fontWeight: "600",
  },
  bodyTypeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  bodyTypeText: {
    fontSize: 12,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 10,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addVehicleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    marginTop: 4,
    marginBottom: 8,
  },
  addVehicleBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  paymentTypeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 8,
  },
  paymentTypeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  paymentTypeBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  expenseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
  },
  expenseDesc: {
    flex: 2,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  expenseAmount: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  notesSection: {
    margin: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  notesInput: {
    height: 90,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    fontSize: 14,
    marginTop: 6,
  },
  mainSaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    height: 54,
    borderRadius: 16,
  },
  mainSaveBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  // VIN Banner styles
  vinBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    margin: 16,
    marginBottom: 4,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  vinBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  vinBannerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  vinBannerText: {
    flex: 1,
    gap: 2,
  },
  vinBannerTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  vinBannerSub: {
    fontSize: 11,
    lineHeight: 16,
  },
  // Attachments styles
  attachmentsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingTop: 4,
    paddingBottom: 8,
  },
  attachmentThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: "hidden",
  },
  attachmentThumbImg: {
    width: 80,
    height: 80,
  },
  removeAttachBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addAttachBtn: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addAttachBtnText: {
    fontSize: 10,
    fontWeight: "600",
  },
  attachActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  attachActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  attachActionBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  gpsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    marginBottom: 16,
  },
  gpsButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  // Inspection button / badge styles
  startInspectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    marginTop: 10,
  },
  startInspectionBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  inspectionCompleteBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  inspectionCompleteTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  inspectionCompleteDetail: {
    fontSize: 11,
    marginTop: 1,
  },
  editInspectionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  editInspectionBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
