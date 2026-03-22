import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/lib/auth-context";
import { useLoads } from "@/lib/loads-context";
import { cameraSessionStore } from "@/lib/camera-session-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { Load } from "@/lib/data";

export default function FieldPickupReportScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{
    vin: string;
    year: string;
    make: string;
    model: string;
    bodyType: string;
    engineSize: string;
    trim: string;
  }>();
  const { driver } = useAuth();
  const { addLoad } = useLoads();
  const reportToCompany = useAction(api.platform.reportFieldPickup);
  const saveLocally = useMutation(api.fieldPickups.save);
  const markSynced = useMutation(api.fieldPickups.markSynced);
  const markFailed = useMutation(api.fieldPickups.markFailed);

  const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";

  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number; address?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(true);

  const vehicleLabel = [params.year, params.make, params.model].filter(Boolean).join(" ") || params.vin;

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setGpsLoading(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        let address: string | undefined;
        try {
          const [geo] = await Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          if (geo) {
            address = [geo.street, geo.city, geo.region].filter(Boolean).join(", ");
          }
        } catch { /* reverse geocode optional */ }
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, address });
      } catch { /* GPS unavailable */ }
      setGpsLoading(false);
    })();
  }, []);

  const handleAddPhoto = useCallback(async () => {
    if (photos.length >= 8) {
      Alert.alert("Limit Reached", "Maximum 8 photos per report.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri]);
    }
  }, [photos.length]);

  const handleRemovePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const createFieldPickupLoad = useCallback((fieldPickupId?: string): Load => {
    const vin = params.vin ?? "";
    const vehicleId = `v-fp-${vin.slice(-6) || Date.now()}`;
    const loadId = `fp-${Date.now()}`;
    const now = new Date().toISOString();
    const emptyContact = { name: "", company: "", phone: "", email: "", address: "", city: "", state: "", zip: "" };
    const load: Load = {
      id: loadId,
      loadNumber: `FP-${vin.slice(-6).toUpperCase()}`,
      status: "new",
      vehicles: [{
        id: vehicleId,
        vin,
        year: params.year || "",
        make: params.make || "",
        model: params.model || "",
        color: color.trim() || "",
        bodyType: params.bodyType || undefined,
      }],
      pickup: {
        contact: gps?.address
          ? { ...emptyContact, address: gps.address }
          : emptyContact,
        date: now,
        lat: gps?.lat ?? 0,
        lng: gps?.lng ?? 0,
      },
      delivery: { contact: emptyContact, date: "", lat: 0, lng: 0 },
      driverPay: 0,
      paymentType: "cod",
      notes: notes.trim(),
      assignedAt: now,
      isFieldPickup: true,
      fieldPickupId: fieldPickupId ?? undefined,
    };
    return load;
  }, [params, color, notes, gps]);

  const startInspection = useCallback((load: Load) => {
    const vehicle = load.vehicles[0];
    if (!vehicle) return;
    cameraSessionStore.open(null, {
      loadId: load.id,
      vehicleId: vehicle.id,
      nextRoute: `/inspection/${load.id}/${vehicle.id}`,
      pickupConfirm: true,
    });
    router.dismissAll();
    router.replace("/camera-session" as any);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!driverCode) {
      Alert.alert("Error", "Driver profile not loaded. Please try again.");
      return;
    }
    if (!params.vin) {
      Alert.alert("Error", "VIN is missing.");
      return;
    }

    setSubmitting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const reportData = {
      driverCode,
      vin: params.vin,
      year: params.year || undefined,
      make: params.make || undefined,
      model: params.model || undefined,
      bodyType: params.bodyType || undefined,
      color: color.trim() || undefined,
      notes: notes.trim() || undefined,
      photoUrls: photos.length > 0 ? photos : undefined,
      gpsLat: gps?.lat,
      gpsLng: gps?.lng,
      gpsAddress: gps?.address,
      reportedAt: new Date().toISOString(),
    };

    const localId = await saveLocally({
      ...reportData,
      clerkUserId: driver?.id ?? "",
    });

    const showInspectionChoice = (fieldPickupId?: string) => {
      Alert.alert(
        "Reported",
        `${vehicleLabel} has been reported to your company.\n\nWould you like to start the pickup inspection now?`,
        [
          {
            text: "Start Inspection",
            onPress: () => {
              const load = createFieldPickupLoad(fieldPickupId);
              addLoad(load);
              startInspection(load);
            },
          },
          {
            text: "Later",
            style: "cancel",
            onPress: () => {
              const load = createFieldPickupLoad(fieldPickupId);
              addLoad(load);
              router.dismissAll();
              router.replace("/(tabs)/" as any);
            },
          },
        ],
      );
    };

    try {
      await reportToCompany(reportData);
      await markSynced({ id: localId });
      showInspectionChoice(localId as unknown as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.warn("[FieldPickup] Platform sync failed:", msg);
      await markFailed({ id: localId, platformResponse: msg });
      showInspectionChoice(localId as unknown as string);
    } finally {
      setSubmitting(false);
    }
  }, [driverCode, params, color, notes, photos, gps, driver?.id, vehicleLabel, saveLocally, reportToCompany, markSynced, markFailed, createFieldPickupLoad, addLoad, startInspection]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Field Pickup Report</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Vehicle info banner */}
          <View style={[styles.vehicleBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <IconSymbol name="car.fill" size={20} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.vehicleTitle, { color: colors.text }]}>{vehicleLabel}</Text>
              <Text style={[styles.vehicleVin, { color: colors.muted }]}>VIN: {params.vin}</Text>
              {params.bodyType ? (
                <Text style={[styles.vehicleVin, { color: colors.muted }]}>
                  {[params.bodyType, params.trim].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </View>
          </View>

          {/* GPS location */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>LOCATION</Text>
            {gpsLoading ? (
              <View style={styles.gpsRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.gpsText, { color: colors.muted }]}>Getting your location...</Text>
              </View>
            ) : gps ? (
              <View style={styles.gpsRow}>
                <IconSymbol name="location.fill" size={16} color="#4CAF50" />
                <Text style={[styles.gpsText, { color: colors.text }]}>
                  {gps.address ?? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`}
                </Text>
              </View>
            ) : (
              <View style={styles.gpsRow}>
                <IconSymbol name="location.slash" size={16} color={colors.muted} />
                <Text style={[styles.gpsText, { color: colors.muted }]}>Location unavailable</Text>
              </View>
            )}
          </View>

          {/* Color */}
          <Text style={[styles.formLabel, { color: colors.muted }]}>VEHICLE COLOR</Text>
          <TextInput
            style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            placeholder="e.g. White, Black, Silver"
            placeholderTextColor={colors.muted}
            value={color}
            onChangeText={setColor}
            autoCapitalize="words"
          />

          {/* Notes */}
          <Text style={[styles.formLabel, { color: colors.muted }]}>NOTES</Text>
          <TextInput
            style={[styles.formInput, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            placeholder="Any details about this pickup (keys location, damage, contact info, etc.)"
            placeholderTextColor={colors.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {/* Photos */}
          <Text style={[styles.formLabel, { color: colors.muted }]}>PHOTOS ({photos.length}/8)</Text>
          <View style={styles.photosRow}>
            {photos.map((uri, i) => (
              <View key={i} style={styles.photoThumb}>
                <Image source={{ uri }} style={styles.photoImage} />
                <TouchableOpacity style={styles.photoRemove} onPress={() => handleRemovePhoto(i)}>
                  <IconSymbol name="xmark.circle.fill" size={22} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < 8 && (
              <TouchableOpacity
                style={[styles.addPhotoBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={handleAddPhoto}
              >
                <IconSymbol name="camera.fill" size={24} color={colors.primary} />
                <Text style={[styles.addPhotoText, { color: colors.muted }]}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <IconSymbol name="paperplane.fill" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>Report to Company</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.disclaimer, { color: colors.muted }]}>
            Your company will receive this report and can create a formal load assignment from it.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {submitting && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  scrollContent: { padding: 16, paddingBottom: 60 },
  vehicleBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  vehicleTitle: { fontSize: 16, fontWeight: "700" },
  vehicleVin: { fontSize: 13, marginTop: 2 },
  section: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginBottom: 8 },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  gpsText: { fontSize: 14, flex: 1 },
  formLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  formInput: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  textArea: {
    minHeight: 90,
    paddingTop: 10,
  },
  photosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: "hidden",
  },
  photoImage: {
    width: 80,
    height: 80,
  },
  photoRemove: {
    position: "absolute",
    top: 2,
    right: 2,
  },
  addPhotoBtn: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  addPhotoText: { fontSize: 11, fontWeight: "600" },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 15,
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  disclaimer: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 18,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
});
