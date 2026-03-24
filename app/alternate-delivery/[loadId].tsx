import { useState, useCallback, useEffect } from "react";
import { photoQueue } from "@/lib/photo-queue";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { pickupHighlightStore } from "@/lib/pickup-highlight-store";

interface CompanyLocation {
  id: string;
  name: string;
  address?: string;
  city?: string;
  province?: string;
  lat?: number;
  lng?: number;
}

type Tab = "search" | "new";

export default function AlternateDeliveryScreen() {
  const colors = useColors();
  const { loadId } = useLocalSearchParams<{ loadId: string }>();
  const { getLoad, updateLoadStatus, patchLoad } = useLoads();
  const { driver } = useAuth();
  const { settings } = useSettings();
  const markAsDeliveredAction = useAction(api.platform.markAsDelivered);
  const getLocationsAction = useAction(api.platform.getLocations);
  const saveSignatureMutation = useMutation(api.signatures.save);

  const load = getLoad(loadId ?? "");
  const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";
  const isPlatformLoad = load?.id.startsWith("platform-") ?? false;
  const platformTripId = isPlatformLoad
    ? (load?.platformTripId ?? load?.id.replace("platform-", ""))
    : null;

  const [activeTab, setActiveTab] = useState<Tab>("search");
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDelivering, setIsDelivering] = useState(false);

  // New location form state
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newProvince, setNewProvince] = useState("");

  // Fetch locations on mount
  useEffect(() => {
    if (!load?.orgId) return;
    setLoadingLocations(true);
    getLocationsAction({ orgId: load.orgId })
      .then((result) => {
        setLocations((result as CompanyLocation[]) ?? []);
      })
      .catch(() => setLocations([]))
      .finally(() => setLoadingLocations(false));
  }, [load?.orgId, getLocationsAction]);

  const filteredLocations = locations.filter((loc) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      loc.name.toLowerCase().includes(q) ||
      (loc.city ?? "").toLowerCase().includes(q) ||
      (loc.address ?? "").toLowerCase().includes(q)
    );
  });

  const doDeliver = useCallback(
    async (opts?: {
      alternateDropLocationId?: string;
      newLocation?: { name: string; address?: string; city: string; province: string; lat?: number; lng?: number };
    }) => {
      if (!load || !platformTripId || !driverCode || isDelivering) return;
      setIsDelivering(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Build the alternate location info for local persistence
      let altLocation: { name: string; address?: string; city?: string; province?: string } | undefined;
      if (opts?.alternateDropLocationId) {
        const loc = locations.find((l) => l.id === opts.alternateDropLocationId);
        if (loc) altLocation = { name: loc.name, address: loc.address, city: loc.city, province: loc.province };
      } else if (opts?.newLocation) {
        altLocation = { name: opts.newLocation.name, address: opts.newLocation.address, city: opts.newLocation.city, province: opts.newLocation.province };
      }

      updateLoadStatus(load.id, "delivered");

      if (altLocation) {
        patchLoad(load.id, { wasAlternateDelivery: true, actualDeliveryLocation: altLocation });
      }

      const isFinal = load.isFinalLeg !== false;
      const toastMsg = isFinal
        ? "Vehicle delivered to final destination"
        : "Vehicle dropped at terminal — dispatch will assign the next leg";
      pickupHighlightStore.signal("delivered", toastMsg);

      router.dismissAll();
      router.replace("/(tabs)/" as any);

      // Fire-and-forget: save signature
      const savedSigPaths = settings.driverSignaturePaths;
      const driverSigStr = savedSigPaths.length > 0
        ? savedSigPaths.map((p) => p.d).join(" ")
        : undefined;
      if (driverCode) {
        saveSignatureMutation({
          loadId: load.loadNumber ?? load.id,
          driverCode,
          signatureType: "delivery" as const,
          customerNotAvailable: true,
          driverSig: driverSigStr,
          capturedAt: new Date().toISOString(),
        }).catch(() => {});
      }

      // Fire-and-forget: sync to platform
      let gpsLat = 0;
      let gpsLng = 0;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          gpsLat = pos.coords.latitude;
          gpsLng = pos.coords.longitude;
        }
      } catch { /* GPS unavailable */ }

      const queueUrls: string[] = [];
      for (const v of load.vehicles) {
        const vUrls = await photoQueue.flushAndGetUrls(load.id, v.id).catch(() => [] as string[]);
        queueUrls.push(...vUrls);
      }
      const existingHttp = load.vehicles.flatMap(
        (v) => ((v as any).deliveryInspection?.photos ?? []).filter((p: string) => p.startsWith("http"))
      );
      const deliveryPhotos = [...new Set([...existingHttp, ...queueUrls])];

      const allDamages = load.vehicles.flatMap(
        (v) => ((v as any).deliveryInspection?.damages ?? []).map((d: any) => ({
          id: d.id,
          zone: d.zone,
          type: d.type,
          severity: d.severity,
          x: d.xPct != null ? d.xPct / 100 : 0.5,
          y: d.yPct != null ? d.yPct / 100 : 0.5,
          diagramView: d.diagramView,
          note: d.description || undefined,
        }))
      );
      const firstVehicle = load.vehicles[0];

      markAsDeliveredAction({
        loadNumber: load.loadNumber,
        legId: platformTripId,
        driverCode,
        deliveryTime: new Date().toISOString(),
        deliveryGPS: { lat: gpsLat, lng: gpsLng },
        deliveryPhotos,
        ...(opts?.alternateDropLocationId
          ? { alternateDropLocationId: opts.alternateDropLocationId }
          : {}),
        ...(opts?.newLocation ? { newLocation: opts.newLocation } : {}),
        ...(driverSigStr ? { driverSig: driverSigStr } : {}),
        customerNotAvailable: true,
        damages: allDamages,
        noDamage: allDamages.length === 0,
        vehicleVin: firstVehicle?.vin || "",
      }).catch((err) => console.warn("[AlternateDelivery] Platform sync failed:", err));

      setIsDelivering(false);
    },
    [load, platformTripId, driverCode, isDelivering, updateLoadStatus, patchLoad, locations, settings, saveSignatureMutation, markAsDeliveredAction],
  );

  const handleSelectLocation = (loc: CompanyLocation) => {
    Alert.alert(
      "Confirm Delivery",
      `Deliver to ${loc.name}${loc.city ? `, ${loc.city}` : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => doDeliver({ alternateDropLocationId: loc.id }),
        },
      ],
    );
  };

  const handleNewLocationSubmit = () => {
    if (!newName.trim()) {
      Alert.alert("Required", "Location name is required.");
      return;
    }
    if (!newCity.trim()) {
      Alert.alert("Required", "City is required.");
      return;
    }
    if (!newProvince.trim()) {
      Alert.alert("Required", "Province is required.");
      return;
    }
    Alert.alert(
      "Confirm Delivery",
      `Deliver to ${newName.trim()}, ${newCity.trim()}, ${newProvince.trim()}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () =>
            doDeliver({
              newLocation: {
                name: newName.trim(),
                address: newAddress.trim() || undefined,
                city: newCity.trim(),
                province: newProvince.trim(),
              },
            }),
        },
      ],
    );
  };

  if (!load) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text, textAlign: "center", marginTop: 40 }}>Load not found</Text>
      </View>
    );
  }

  const renderLocationItem = ({ item }: { item: CompanyLocation }) => (
    <TouchableOpacity
      style={[styles.locationItem, { borderBottomColor: colors.border }]}
      onPress={() => handleSelectLocation(item)}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.locationName, { color: colors.text }]}>{item.name}</Text>
        {(item.address || item.city) && (
          <Text style={[styles.locationAddress, { color: colors.muted }]}>
            {[item.address, item.city, item.province].filter(Boolean).join(", ")}
          </Text>
        )}
      </View>
      <IconSymbol name="chevron.right" size={16} color={colors.muted} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Alternate Delivery</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Final destination banner */}
      {load.finalDestination && (
        <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="mappin.and.ellipse" size={18} color={colors.primary} />
          <Text style={[styles.bannerText, { color: colors.text }]}>
            Final destination: <Text style={{ fontWeight: "700" }}>{load.finalDestination.name}</Text>
          </Text>
        </View>
      )}

      {/* Tabs */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "search" && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("search")}
        >
          <Text style={[styles.tabText, { color: activeTab === "search" ? colors.primary : colors.muted }]}>
            Search Locations
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "new" && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("new")}
        >
          <Text style={[styles.tabText, { color: activeTab === "new" ? colors.primary : colors.muted }]}>
            New Location
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "search" ? (
        <View style={{ flex: 1 }}>
          {/* Search input */}
          <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
            <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search by name or city..."
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <IconSymbol name="xmark.circle.fill" size={18} color={colors.muted} />
              </TouchableOpacity>
            )}
          </View>

          {loadingLocations ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : filteredLocations.length === 0 ? (
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40, paddingHorizontal: 20 }}>
              {searchQuery ? "No locations match your search" : "No company locations found"}
            </Text>
          ) : (
            <FlatList
              data={filteredLocations}
              keyExtractor={(item) => item.id}
              renderItem={renderLocationItem}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={100}
        >
          <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
            <Text style={[styles.formLabel, { color: colors.muted }]}>LOCATION NAME *</Text>
            <TextInput
              style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="e.g. Calgary Overflow Yard"
              placeholderTextColor={colors.muted}
              value={newName}
              onChangeText={setNewName}
            />

            <Text style={[styles.formLabel, { color: colors.muted }]}>ADDRESS</Text>
            <TextInput
              style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="e.g. 456 Industrial Blvd"
              placeholderTextColor={colors.muted}
              value={newAddress}
              onChangeText={setNewAddress}
            />

            <Text style={[styles.formLabel, { color: colors.muted }]}>CITY *</Text>
            <TextInput
              style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="e.g. Calgary"
              placeholderTextColor={colors.muted}
              value={newCity}
              onChangeText={setNewCity}
            />

            <Text style={[styles.formLabel, { color: colors.muted }]}>PROVINCE *</Text>
            <TextInput
              style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="e.g. AB"
              placeholderTextColor={colors.muted}
              value={newProvince}
              onChangeText={setNewProvince}
              autoCapitalize="characters"
              maxLength={2}
            />

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: isDelivering ? 0.6 : 1 }]}
              onPress={handleNewLocationSubmit}
              disabled={isDelivering}
            >
              {isDelivering ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Deliver to This Location</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {isDelivering && (
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
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { fontSize: 14, flex: 1 },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  tabText: { fontSize: 14, fontWeight: "600" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  locationItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  locationName: { fontSize: 15, fontWeight: "600" },
  locationAddress: { fontSize: 13, marginTop: 2 },
  formContainer: { padding: 16, gap: 4 },
  formLabel: { fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 4, letterSpacing: 0.5 },
  formInput: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  submitBtn: {
    marginTop: 24,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
});
