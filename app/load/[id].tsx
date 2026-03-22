import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  Platform,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  FlatList,
  Dimensions,
  Switch,
  Animated,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router, useLocalSearchParams } from "expo-router";

import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions-context";
import { useSettings, type MapsApp } from "@/lib/settings-context";
import { cameraSessionStore } from "@/lib/camera-session-store";
import { useAction, useMutation, useQuery as useConvexQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  type Load,
  type LoadStatus,
  type Vehicle,
  getStatusLabel,
  formatCurrency,
  formatDate,
  getPaymentLabel,
} from "@/lib/data";
import { usePhotoQueue } from "@/hooks/use-photo-queue";
import { photoQueue } from "@/lib/photo-queue";
import * as WebBrowser from "expo-web-browser";
import * as Location from "expo-location";
import { haversineDistanceMiles, DELIVERY_PROXIMITY_THRESHOLD_MILES } from "@/lib/geo-utils";
import { pickupHighlightStore } from "@/lib/pickup-highlight-store";

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionHeader, { color: colors.muted }]}>{title}</Text>
  );
}

/** Open an address in the user's preferred maps app. */
function openInMaps(address: string, mapsApp: MapsApp | null) {
  if (!address || address === "—") return;
  const encoded = encodeURIComponent(address);
  if (mapsApp === "google") {
    // Deep-link into Google Maps app; fall back to web
    const gmUrl = `comgooglemaps://?q=${encoded}`;
    Linking.canOpenURL(gmUrl).then((can) => {
      Linking.openURL(can ? gmUrl : `https://maps.google.com/maps?q=${encoded}`);
    }).catch(() => Linking.openURL(`https://maps.google.com/maps?q=${encoded}`));
  } else {
    // Apple Maps (default for iOS) or geo: for Android
    const appleUrl = Platform.OS === "ios" ? `maps://?q=${encoded}` : `geo:0,0?q=${encoded}`;
    Linking.openURL(appleUrl).catch(() =>
      Linking.openURL(`https://maps.google.com/maps?q=${encoded}`)
    );
  }
}

function InfoRow({
  label,
  value,
  onPress,
  copyable,
  navigable,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  copyable?: boolean;  // show copy-to-clipboard icon
  navigable?: boolean; // show navigate icon (for addresses)
}) {
  const colors = useColors();
  const { settings, setMapsApp } = useSettings();
  const [copied, setCopied] = useState(false);
  const [showMapsPicker, setShowMapsPicker] = useState(false);

  const handleCopy = async () => {
    if (!value || value === "—") return;
    await Clipboard.setStringAsync(value);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNavigate = () => {
    if (!value || value === "—") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (settings.mapsApp === null) {
      // First time — show picker sheet
      setShowMapsPicker(true);
    } else {
      openInMaps(value, settings.mapsApp);
    }
  };

  const handlePickMaps = (app: MapsApp) => {
    setMapsApp(app);
    setShowMapsPicker(false);
    openInMaps(value, app);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <>
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
      <View style={styles.infoRowRight}>
        {onPress ? (
          <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
            <Text style={[styles.infoValue, { color: colors.primary }]}>{value || "—"}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={navigable ? 2 : 1}>{value || "—"}</Text>
        )}
        {copyable && value && value !== "—" && (
          <TouchableOpacity onPress={handleCopy} activeOpacity={0.7} style={styles.actionIcon}>
            <IconSymbol
              name={copied ? "checkmark" : "doc.on.doc"}
              size={14}
              color={copied ? colors.success : colors.muted}
            />
          </TouchableOpacity>
        )}
        {navigable && value && value !== "—" && (
          <TouchableOpacity onPress={handleNavigate} activeOpacity={0.7} style={styles.actionIcon}>
            <IconSymbol name="location.fill" size={14} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
    </View>

    {/* Maps app picker — shown on first address tap */}
    {showMapsPicker && <Modal visible={showMapsPicker} transparent animationType="slide" onRequestClose={() => setShowMapsPicker(false)}>
      <TouchableOpacity style={mapsPickerStyles.overlay} activeOpacity={1} onPress={() => setShowMapsPicker(false)}>
        <View style={[mapsPickerStyles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[mapsPickerStyles.handle, { backgroundColor: colors.border }]} />
          <Text style={[mapsPickerStyles.title, { color: colors.foreground }]}>Open with…</Text>
          <Text style={[mapsPickerStyles.subtitle, { color: colors.muted }]}>Choose your preferred navigation app. You can change this later in Profile → Display.</Text>
          <TouchableOpacity
            style={[mapsPickerStyles.option, { borderColor: colors.border }]}
            onPress={() => handlePickMaps("apple")}
            activeOpacity={0.7}
          >
            <View style={[mapsPickerStyles.optionIcon, { backgroundColor: colors.primary + "18" }]}>
              <IconSymbol name="map.fill" size={22} color={colors.primary} />
            </View>
            <View style={mapsPickerStyles.optionText}>
              <Text style={[mapsPickerStyles.optionTitle, { color: colors.foreground }]}>Apple Maps</Text>
              <Text style={[mapsPickerStyles.optionSub, { color: colors.muted }]}>Built-in iOS navigation</Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[mapsPickerStyles.option, { borderColor: colors.border }]}
            onPress={() => handlePickMaps("google")}
            activeOpacity={0.7}
          >
            <View style={[mapsPickerStyles.optionIcon, { backgroundColor: "#4285F418" }]}>
              <IconSymbol name="location.fill" size={22} color="#4285F4" />
            </View>
            <View style={mapsPickerStyles.optionText}>
              <Text style={[mapsPickerStyles.optionTitle, { color: colors.foreground }]}>Google Maps</Text>
              <Text style={[mapsPickerStyles.optionSub, { color: colors.muted }]}>Google navigation</Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>}
    </>
  );
}
function VehicleCard({
  vehicle,
  loadId,
  loadStatus,
  loadNumber,
  platformTripId,
  driverCode,
}: {
  vehicle: Vehicle;
  loadId: string;
  loadStatus: LoadStatus;
  loadNumber: string;
  platformTripId: number | null;
  driverCode: string;
}) {
  const colors = useColors();
  const { entries: queueEntries } = usePhotoQueue();

  // Count pending/uploading/failed photos for this specific vehicle
  const vehiclePendingCount = queueEntries.filter(
    (e) => e.loadId === loadId && e.vehicleId === vehicle.id && (e.status === "pending" || e.status === "uploading")
  ).length;
  const vehicleFailedCount = queueEntries.filter(
    (e) => e.loadId === loadId && e.vehicleId === vehicle.id && e.status === "failed"
  ).length;

  // hasPickupInspection: true when inspection data exists AND not explicitly reverted to pending
  const hasPickupInspection = !!vehicle.pickupInspection && vehicle.pickupStatus !== "pending";
  const hasDeliveryInspection = !!vehicle.deliveryInspection;
  const damageCount = vehicle.pickupInspection?.damages.length ?? 0;
  const pickupPhotoCount = vehicle.pickupInspection?.photos.length ?? 0;
  const deliveryPhotoCount = vehicle.deliveryInspection?.photos.length ?? 0;
  const isDelivery = loadStatus === "picked_up";
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxVisible, setLightboxVisible] = useState(false);

  const openLightbox = (photos: string[], index: number) => {
    setLightboxPhotos(photos);
    setLightboxIndex(index);
    setLightboxVisible(true);
  };

  const isReviewable = loadStatus === "delivered" || loadStatus === "archived";
  const pickupPhotos = vehicle.pickupInspection?.photos ?? [];
  const deliveryPhotos = vehicle.deliveryInspection?.photos ?? [];

  const inspectionTypeForVehicle = loadStatus === "new" ? "pickup" : "delivery";
  const currentInspection = inspectionTypeForVehicle === "delivery" ? vehicle.deliveryInspection : vehicle.pickupInspection;

  const handleInspect = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentInspection) {
      router.push(`/inspection-review/${loadId}/${vehicle.id}?type=${inspectionTypeForVehicle}` as any);
    } else {
      cameraSessionStore.open(null, {
        loadId,
        vehicleId: vehicle.id,
        nextRoute: `/inspection-review/${loadId}/${vehicle.id}?type=${inspectionTypeForVehicle}`,
      });
      router.push("/camera-session" as any);
    }
  };

  return (
    <View style={[styles.vehicleCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.vehicleHeader}>
        <View style={[styles.vehicleIcon, { backgroundColor: colors.primary + "18" }]}>
          <IconSymbol name="car.fill" size={20} color={colors.primary} />
        </View>
        <View style={styles.vehicleInfo}>
          <Text style={[styles.vehicleName, { color: colors.foreground }]}>
            {[(vehicle as any).displayName ?? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")].filter(Boolean).join("") || "Unknown Vehicle"}
          </Text>
          <Text style={[styles.vehicleVin, { color: colors.muted }]}>VIN: {vehicle.vin || "—"}</Text>
          {/* Condition chips — shown inline when platform provides these values */}
          {((vehicle.hasKeys !== null && vehicle.hasKeys !== undefined) ||
            (vehicle.starts !== null && vehicle.starts !== undefined) ||
            (vehicle.drives !== null && vehicle.drives !== undefined)) && (
            <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
              {vehicle.hasKeys !== null && vehicle.hasKeys !== undefined && (
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 4,
                  backgroundColor: vehicle.hasKeys ? colors.success + "18" : colors.error + "18",
                  borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7,
                  borderWidth: 1, borderColor: vehicle.hasKeys ? colors.success + "44" : colors.error + "44",
                }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: vehicle.hasKeys ? colors.success : colors.error }} />
                  <Text style={{ fontSize: 11, color: vehicle.hasKeys ? colors.success : colors.error, fontWeight: "600" }}>Keys: {vehicle.hasKeys ? "Yes" : "No"}</Text>
                </View>
              )}
              {vehicle.starts !== null && vehicle.starts !== undefined && (
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 4,
                  backgroundColor: vehicle.starts ? colors.success + "18" : colors.error + "18",
                  borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7,
                  borderWidth: 1, borderColor: vehicle.starts ? colors.success + "44" : colors.error + "44",
                }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: vehicle.starts ? colors.success : colors.error }} />
                  <Text style={{ fontSize: 11, color: vehicle.starts ? colors.success : colors.error, fontWeight: "600" }}>Starts: {vehicle.starts ? "Yes" : "No"}</Text>
                </View>
              )}
              {vehicle.drives !== null && vehicle.drives !== undefined && (
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 4,
                  backgroundColor: vehicle.drives ? colors.success + "18" : colors.error + "18",
                  borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7,
                  borderWidth: 1, borderColor: vehicle.drives ? colors.success + "44" : colors.error + "44",
                }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: vehicle.drives ? colors.success : colors.error }} />
                  <Text style={{ fontSize: 11, color: vehicle.drives ? colors.success : colors.error, fontWeight: "600" }}>Drives: {vehicle.drives ? "Yes" : "No"}</Text>
                </View>
              )}
            </View>
          )}
          {/* Previous leg driver note */}
          {vehicle.previousLegNotes && (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8, backgroundColor: "#FFF8E1", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#FFD54F" }}>
              <IconSymbol name="info.circle.fill" size={15} color="#F9A825" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: "#E65100", marginBottom: 2 }}>Note from previous driver</Text>
                <Text style={{ fontSize: 12, color: "#5D4037", lineHeight: 17 }}>{vehicle.previousLegNotes}</Text>
              </View>
            </View>
          )}
        </View>
        <View style={[styles.vehicleColorDot, { backgroundColor: getColorHex(vehicle.color) }]} />
      </View>
      <View style={styles.vehicleStats}>
        {damageCount > 0 && (
          <View style={[styles.vehicleStat, { backgroundColor: colors.error + "15" }]}>
            <Text style={[styles.vehicleStatText, { color: colors.error }]}>
              {damageCount} {damageCount === 1 ? "Damage" : "Damages"}
            </Text>
          </View>
        )}
        {pickupPhotoCount > 0 && (
          <View style={[styles.vehicleStat, { backgroundColor: colors.primary + "15", flexDirection: "row", alignItems: "center" }]}>
            <IconSymbol name="camera.fill" size={11} color={colors.primary} />
            <Text style={[styles.vehicleStatText, { color: colors.primary, marginLeft: 3 }]}>
              {pickupPhotoCount} Pickup {pickupPhotoCount === 1 ? "Photo" : "Photos"}
            </Text>
          </View>
        )}
        {deliveryPhotoCount > 0 && (
          <View style={[styles.vehicleStat, { backgroundColor: colors.warning + "15", flexDirection: "row", alignItems: "center" }]}>
            <IconSymbol name="camera.fill" size={11} color={colors.warning} />
            <Text style={[styles.vehicleStatText, { color: colors.warning, marginLeft: 3 }]}>
              {deliveryPhotoCount} Delivery {deliveryPhotoCount === 1 ? "Photo" : "Photos"}
            </Text>
          </View>
        )}
      </View>

      {/* Pending upload indicator — visible even after picked up */}
      {(vehiclePendingCount > 0 || vehicleFailedCount > 0) && (
        <View style={[styles.vehicleUploadBanner, {
          backgroundColor: vehicleFailedCount > 0 ? colors.error + "18" : colors.warning + "18",
          borderColor: vehicleFailedCount > 0 ? colors.error + "44" : colors.warning + "44",
        }]}>
          <Text style={[styles.vehicleUploadBannerText, { color: vehicleFailedCount > 0 ? colors.error : colors.warning }]}>
            {vehicleFailedCount > 0
              ? `⚠ ${vehicleFailedCount} photo${vehicleFailedCount !== 1 ? "s" : ""} failed to upload`
              : `⬆ ${vehiclePendingCount} photo${vehiclePendingCount !== 1 ? "s" : ""} uploading in background...`}
          </Text>
        </View>
      )}
      {/* Single inspection button per stage */}
      {(loadStatus === "new" || loadStatus === "picked_up") && (
        <TouchableOpacity
          style={[styles.inspectBtn, { borderColor: colors.primary }]}
          onPress={handleInspect}
          activeOpacity={0.8}
        >
          <IconSymbol name={currentInspection ? "pencil.circle.fill" : "camera.fill"} size={14} color={colors.primary} />
          <Text style={[styles.inspectBtnText, { color: colors.primary }]}>
            {loadStatus === "new"
              ? currentInspection
                ? `Pickup Inspection (${pickupPhotoCount} photo${pickupPhotoCount !== 1 ? "s" : ""})`
                : "Start Pickup Inspection"
              : currentInspection
                ? `Delivery Inspection (${deliveryPhotoCount} photo${deliveryPhotoCount !== 1 ? "s" : ""})`
                : "Start Delivery Inspection"}
          </Text>
        </TouchableOpacity>
      )}

      {/* View-only inspection buttons for completed stages */}
      {hasPickupInspection && loadStatus !== "new" && (
        <TouchableOpacity
          style={[styles.inspectBtn, { borderColor: colors.primary, marginTop: 8 }]}
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/inspection-review/${loadId}/${vehicle.id}?type=pickup` as any);
          }}
          activeOpacity={0.8}
        >
          <IconSymbol name="photo.on.rectangle" size={14} color={colors.primary} />
          <Text style={[styles.inspectBtnText, { color: colors.primary }]}>
            Pickup Inspection{pickupPhotos.length > 0 ? ` (${pickupPhotos.length} photos)` : ""}
          </Text>
        </TouchableOpacity>
      )}
      {hasDeliveryInspection && loadStatus === "delivered" && (
        <TouchableOpacity
          style={[styles.inspectBtn, { borderColor: colors.warning, marginTop: 8 }]}
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/inspection-review/${loadId}/${vehicle.id}?type=delivery` as any);
          }}
          activeOpacity={0.8}
        >
          <IconSymbol name="photo.on.rectangle" size={14} color={colors.warning} />
          <Text style={[styles.inspectBtnText, { color: colors.warning }]}>
            Delivery Inspection{deliveryPhotos.length > 0 ? ` (${deliveryPhotos.length} photos)` : ""}
          </Text>
        </TouchableOpacity>
      )}

      {/* Full-screen photo lightbox */}
      <Modal
        visible={lightboxVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setLightboxVisible(false)}
            activeOpacity={0.8}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <View style={styles.lightboxCloseCircle}>
              <IconSymbol name="xmark" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
          <FlatList
            data={lightboxPhotos}
            keyExtractor={(_, i) => String(i)}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={lightboxIndex}
            getItemLayout={(_, index) => ({
              length: Dimensions.get("window").width,
              offset: Dimensions.get("window").width * index,
              index,
            })}
            renderItem={({ item }) => (
              <View style={[styles.lightboxPage, { width: Dimensions.get("window").width }]}>
                <Image
                  source={{ uri: item }}
                  style={styles.lightboxImage}
                  contentFit="contain"
                />
              </View>
            )}
          />
          <Text style={styles.lightboxCounter}>
            {lightboxIndex + 1} / {lightboxPhotos.length}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

function getColorHex(color: string): string {
  const map: Record<string, string> = {
    White: "#F5F5F5",
    Silver: "#C0C0C0",
    Black: "#1A1A1A",
    Blue: "#3B82F6",
    Red: "#EF4444",
    Green: "#22C55E",
    Gray: "#9CA3AF",
    Brown: "#92400E",
    Gold: "#F59E0B",
    Orange: "#F97316",
  };
  return map[color] ?? "#9CA3AF";
}

function getCtaConfig(load: Load): { label: string; action: () => void; color: string } | null {
  return null; // Will be set inside component with access to colors
}

export default function LoadDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getLoad, updateLoadStatus } = useLoads();
  const { driver } = useAuth();
  const { canViewRates } = usePermissions();
  const markAsDeliveredAction = useAction(api.platform.markAsDelivered);
  const markAsPickedUpAction = useAction(api.platform.markAsPickedUp);
  const syncInspectionAction = useAction(api.platform.syncInspection);
  const saveSignatureMutation = useMutation(api.signatures.save);

  // Inline handoff note for delivery (visible above "Mark Delivered" when no inspection photos)
  const [pendingHandoffNote, setPendingHandoffNote] = useState("");

  // ─── Require customer signature toggle (per session, resets after pickup/delivery) ─────
  const [requireCustomerSignature, setRequireCustomerSignature] = useState(false);
  const [requireDeliverySignature, setRequireDeliverySignature] = useState(false);
  const { settings } = useSettings();

  const scrollViewRef = useRef<ScrollView>(null);

  // ─── Toast notification ────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState("");
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [toastOpacity]);

  // IMPORTANT: Use the platform-assigned driverCode for all platform API calls.
  // The platform assigns its own D-XXXXX ID at registration (platformDriverCode).
  // The local driverCode (D-XXXXX) is only used for the driver app's own database.
  // Using the wrong code causes "Driver not found" errors on the platform.
  const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";

  // ─── Expenses state ────────────────────────────────────────────────────────
  const [showExpenseSheet, setShowExpenseSheet] = useState(false);
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const expenseDateStr = expenseDate.toISOString().slice(0, 10);
  const [expenseReceiptUri, setExpenseReceiptUri] = useState<string | null>(null);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const labelInputRef = useRef<import('react-native').TextInput>(null);
   const [expenseNotes, setExpenseNotes] = useState("");
  // Gate pass is now opened via WebBrowser.openBrowserAsync — no modal needed
  const loadId = id ?? "";
  const expensesList = useConvexQuery(
    api.expenses.getByLoad,
    loadId ? { loadId } : "skip",
  );
  const addExpenseConvex = useMutation(api.expenses.add);
  const deleteExpenseConvex = useMutation(api.expenses.remove);
  const generateUploadUrl = useMutation(api.expenses.generateUploadUrl);

  const launchReceiptCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Camera access is needed to photograph receipts.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7, base64: false });
    if (!result.canceled && result.assets[0]) setExpenseReceiptUri(result.assets[0].uri);
  }, []);

  const launchReceiptLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.7, base64: false });
    if (!result.canceled && result.assets[0]) setExpenseReceiptUri(result.assets[0].uri);
  }, []);

  // Never await an Alert on iOS — it blocks the Alert queue and prevents subsequent alerts from firing
  const handlePickReceipt = useCallback(() => {
    Alert.alert("Add Receipt Photo", "Choose source", [
      { text: "Camera", onPress: launchReceiptCamera },
      { text: "Photo Library", onPress: launchReceiptLibrary },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [launchReceiptCamera, launchReceiptLibrary]);

  const handleSaveExpense = useCallback(async () => {
    const label = expenseLabel.trim();
    const amountStr = expenseAmount.replace(/[^0-9.]/g, "");
    const amountCents = Math.round(parseFloat(amountStr) * 100);
    if (!label) { Alert.alert("Missing Label", "Please enter an expense label."); return; }
    if (!amountStr || isNaN(amountCents) || amountCents <= 0) { Alert.alert("Invalid Amount", "Please enter a valid amount."); return; }

    setExpenseSaving(true);
    try {
      let receiptStorageId: any;
      if (expenseReceiptUri) {
        const uploadUrl = await generateUploadUrl();
        const fileContent = await FileSystem.readAsStringAsync(expenseReceiptUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: Uint8Array.from(atob(fileContent), (c) => c.charCodeAt(0)),
        });
        const { storageId } = await response.json();
        receiptStorageId = storageId;
      }
      await addExpenseConvex({
        loadId,
        driverCode: driverCode || "unknown",
        label,
        amountCents,
        expenseDate: expenseDateStr,
        notes: expenseNotes.trim() || undefined,
        receiptStorageId,
      });
      setExpenseLabel("");
      setExpenseAmount("");
      setExpenseDate(new Date());
      setExpenseNotes("");
      setExpenseReceiptUri(null);
      setShowExpenseSheet(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert("Error", "Failed to save expense. Please try again.");
    } finally {
      setExpenseSaving(false);
    }
  }, [expenseLabel, expenseAmount, expenseDate, expenseReceiptUri, loadId, driverCode, expenseNotes, generateUploadUrl, addExpenseConvex, expenseDateStr]);

  const handleDeleteExpense = useCallback((expenseId: any) => {
    Alert.alert("Delete Expense", "Remove this expense?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => deleteExpenseConvex({ id: expenseId, driverCode: driverCode || "unknown" }),
      },
    ]);
  }, [driverCode, deleteExpenseConvex]);

  const load = getLoad(id);

  if (!load) {
    return (
      <ScreenContainer>
        <View style={styles.notFound}>
          <Text style={[styles.notFoundText, { color: colors.foreground }]}>Load not found.</Text>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={[styles.backLink, { color: colors.primary }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

   const allPickupDone = load.vehicles.every((v) => !!v.pickupInspection);
  const allDeliveryDone = load.vehicles.every((v) => !!v.deliveryInspection);

  const handleCallPickup = () => {
    Linking.openURL(`tel:${load.pickup.contact.phone.replace(/\D/g, "")}`);
  };
  const handleCallDelivery = () => {
    Linking.openURL(`tel:${load.delivery.contact.phone.replace(/\D/g, "")}`);
  };

  const isPlatformLoad = load.id.startsWith("platform-");
  // IMPORTANT: Read platformTripId from the load object (set fresh on every platform fetch),
  // NOT from parsing load.id — the id string may contain a stale legId if the platform
  // recreated the load with a new legId after the app cached it.
  const platformTripId = isPlatformLoad
    ? (load.platformTripId ?? load.id.replace("platform-", ""))
    : null;

  const handleMarkPickedUp = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (load.vehicles.length === 0) {
      Alert.alert("No Vehicles", "This load has no vehicles to inspect.");
      return;
    }

    // Check if any vehicle already has at least 1 pickup photo
    const hasPickupPhotos = load.vehicles.some(
      (v) => v.pickupInspection && v.pickupInspection.photos.length > 0
    );

    if (!hasPickupPhotos) {
      // No photos yet — ask the driver if they want to take them now
      Alert.alert(
        "Missing Pickup Pictures",
        "You haven't taken any pickup inspection photos yet. Would you like to take them now?",
        [
          {
            text: "Skip Photos",
            style: "destructive",
            onPress: () => {
              // Proceed directly without a second confirmation
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (requireCustomerSignature) {
                router.push(`/pickup-signature/${load.id}` as any);
                return;
              }
              updateLoadStatus(load.id, "picked_up");
              setRequireCustomerSignature(false);
              pickupHighlightStore.signal("picked_up", "Vehicle picked up — moved to Picked Up tab");
              showToast("Vehicle picked up — moved to Picked Up tab");
              router.back();
              const savedSigPaths = settings.driverSignaturePaths;
              const driverSigStr = savedSigPaths.length > 0
                ? savedSigPaths.map((p) => p.d).join(" ")
                : undefined;
              if (driverCode) {
                saveSignatureMutation({
                  loadId: load.loadNumber ?? load.id,
                  driverCode,
                  signatureType: "pickup",
                  customerNotAvailable: true,
                  driverSig: driverSigStr,
                  capturedAt: new Date().toISOString(),
                }).catch((err) => console.warn("[LoadDetail] Signature save failed:", err));
              }
              if (isPlatformLoad && platformTripId && driverCode) {
                markAsPickedUpAction({
                  loadNumber: load.loadNumber,
                  legId: platformTripId,
                  driverCode,
                  pickupTime: new Date().toISOString(),
                  pickupGPS: { lat: 0, lng: 0 },
                  pickupPhotos: [],
                }).catch((err) => console.warn("[LoadDetail] Platform sync failed:", err));
              }
            },
          },
          {
            text: "Take Photos",
            onPress: () => {
              const vehicle = load.vehicles[0];
              if (!vehicle) return;
              cameraSessionStore.open(null, {
                loadId: load.id,
                vehicleId: vehicle.id,
                nextRoute: `/inspection/${load.id}/${vehicle.id}`,
                pickupConfirm: true,
              });
              router.push("/camera-session" as any);
            },
          },
        ]
      );
      return;
    }

    // Photos exist — check if customer signature is required
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (requireCustomerSignature) {
      // Driver opted in — show the full signature screen
      router.push(`/pickup-signature/${load.id}` as any);
      return;
    }

    // Default: auto-confirm with "Customer Not Available" using saved driver signature
    updateLoadStatus(load.id, "picked_up");
    setRequireCustomerSignature(false);
    pickupHighlightStore.signal("picked_up", "Vehicle picked up — moved to Picked Up tab");
    showToast("Vehicle picked up — moved to Picked Up tab");
    router.back();

    // Fire-and-forget: save signature record with customerNotAvailable=true
    const savedSigPaths = settings.driverSignaturePaths;
    const driverSigStr = savedSigPaths.length > 0
      ? savedSigPaths.map((p) => p.d).join(" ")
      : undefined;

    if (driverCode) {
      saveSignatureMutation({
        loadId: load.loadNumber ?? load.id,
        driverCode,
        signatureType: "pickup",
        customerNotAvailable: true,
        driverSig: driverSigStr,
        capturedAt: new Date().toISOString(),
      }).catch((err) => console.warn("[LoadDetail] Signature save failed:", err));
    }

    // Fire-and-forget: resolve uploaded URLs from photo queue before syncing
    if (isPlatformLoad && platformTripId && driverCode) {
      (async () => {
        try {
          const urls: string[] = [];
          for (const v of load.vehicles) {
            const vUrls = await photoQueue.flushAndGetUrls(load.id, v.id);
            urls.push(...vUrls);
          }
          const existingHttp = load.vehicles.flatMap(
            (v) => (v.pickupInspection?.photos ?? []).filter((p) => p.startsWith("http"))
          );
          const pickupPhotos = [...new Set([...existingHttp, ...urls])];
          await markAsPickedUpAction({
            loadNumber: load.loadNumber,
            legId: platformTripId,
            driverCode,
            pickupTime: new Date().toISOString(),
            pickupGPS: { lat: 0, lng: 0 },
            pickupPhotos,
          });
        } catch (err) {
          console.warn("[LoadDetail] Platform sync failed:", err);
        }
      })();
    }
  };

  const handleMarkDelivered = async () => {
    proceedWithDelivery();
  };

  const deliveryToastMsg = load.isFinalLeg === false
    ? "Vehicle dropped at terminal — dispatch will assign the next leg"
    : "Vehicle delivered to final destination";

  const hasDeliveryPhotos = load.vehicles.some(
    (v) => (v.deliveryInspection?.photos?.length ?? 0) > 0
  );

  const finalizeDelivery = (handoffNote?: string) => {
    if (requireDeliverySignature) {
      router.push(`/delivery-signature/${load.id}` as any);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateLoadStatus(load.id, "delivered");
    setRequireDeliverySignature(false);
    pickupHighlightStore.signal("delivered", deliveryToastMsg);
    showToast(deliveryToastMsg);
    router.back();

    const savedSigPaths = settings.driverSignaturePaths;
    const driverSigStr = savedSigPaths.length > 0
      ? savedSigPaths.map((p) => p.d).join(" ")
      : undefined;

    if (driverCode) {
      saveSignatureMutation({
        loadId: load.loadNumber ?? load.id,
        driverCode,
        signatureType: "delivery",
        customerNotAvailable: true,
        driverSig: driverSigStr,
        capturedAt: new Date().toISOString(),
      }).catch((err) => console.warn("[LoadDetail] Delivery signature save failed:", err));
    }

    if (isPlatformLoad && platformTripId && driverCode) {
      (async () => {
        try {
          const urls: string[] = [];
          for (const v of load.vehicles) {
            const vUrls = await photoQueue.flushAndGetUrls(load.id, v.id);
            urls.push(...vUrls);
          }
          const existingHttp = load.vehicles.flatMap(
            (v) => (v.deliveryInspection?.photos ?? []).filter((p) => p.startsWith("http"))
          );
          const dlvPhotos = [...new Set([...existingHttp, ...urls])];

          await markAsDeliveredAction({
            loadNumber: load.loadNumber,
            legId: platformTripId,
            driverCode,
            deliveryTime: new Date().toISOString(),
            deliveryGPS: { lat: 0, lng: 0 },
            deliveryPhotos: dlvPhotos,
          });

          if (handoffNote && load.vehicles[0]) {
            await syncInspectionAction({
              loadNumber: load.loadNumber,
              legId: platformTripId,
              driverCode,
              inspectionType: "delivery",
              vehicleVin: load.vehicles[0].vin || "",
              photos: dlvPhotos,
              damages: [],
              noDamage: true,
              gps: { lat: 0, lng: 0 },
              timestamp: new Date().toISOString(),
              handoffNote,
            });
          }
        } catch (err) {
          console.warn("[LoadDetail] Platform delivery sync failed:", err);
        }
      })();
    }
  };

  const proceedWithDelivery = async () => {
    const noteToSend = pendingHandoffNote.trim() || undefined;
    const destLat = load.delivery.lat;
    const destLng = load.delivery.lng;

    if (destLat && destLng && !isNaN(destLat) && !isNaN(destLng)) {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const dist = haversineDistanceMiles(
            pos.coords.latitude,
            pos.coords.longitude,
            destLat,
            destLng
          );

          if (dist > DELIVERY_PROXIMITY_THRESHOLD_MILES) {
            Alert.alert(
              "You're Far From Destination",
              `You are approximately ${Math.round(dist)} miles from the assigned delivery location. Are you sure you want to mark this as delivered here?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Mark Delivered Anyway",
                  style: "destructive",
                  onPress: () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    finalizeDelivery(noteToSend);
                  },
                },
              ]
            );
            return;
          }
        }
      } catch {
        // GPS unavailable — proceed normally
      }
    }

    finalizeDelivery(noteToSend);
  };

  const statusColors: Record<LoadStatus, string> = {
    new: colors.warning,
    picked_up: colors.primary,
    delivered: colors.success,
    archived: colors.muted,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Custom Header — centered load number with action buttons */}
      <View style={[styles.navHeader, { backgroundColor: colors.primary }]}>
        <View style={styles.navHeaderTopRow}>
          {/* Left: back button */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <IconSymbol name="arrow.left" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Center: load number */}
          <View style={styles.navHeaderCenter}>
            <Text style={styles.navTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Load #{load.loadNumber}
            </Text>
          </View>

          {/* Right: action buttons */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {load.gatePassUrl && (() => {
              const now = new Date();
              const expires = load.gatePassExpiresAt ? new Date(load.gatePassExpiresAt) : null;
              const isExpired = expires ? now > expires : false;
              const isExpiringSoon = expires && !isExpired ? (expires.getTime() - now.getTime()) < 24 * 60 * 60 * 1000 : false;
              const badgeColor = isExpired ? colors.error : isExpiringSoon ? colors.warning : null;
              return (
                <TouchableOpacity
                  style={styles.bolBtn}
                  onPress={() => load.gatePassUrl && WebBrowser.openBrowserAsync(load.gatePassUrl)}
                  activeOpacity={0.7}
                >
                  <IconSymbol name="key.fill" size={16} color="#FFFFFF" />
                  <Text style={styles.bolBtnText}>Gate Pass</Text>
                  {badgeColor && (
                    <View style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: badgeColor,
                      borderWidth: 1.5,
                      borderColor: colors.primary,
                    }} />
                  )}
                </TouchableOpacity>
              );
            })()}
            <TouchableOpacity
              style={styles.bolBtn}
              onPress={() => router.push(`/bol/${load.id}` as any)}
              activeOpacity={0.7}
            >
              <IconSymbol name="doc.text.fill" size={16} color="#FFFFFF" />
              <Text style={styles.bolBtnText}>BOL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }} keyboardVerticalOffset={0}>
      <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          {/* Company + status row */}
          <View style={styles.companyStatusRow}>
            {load.orgName ? (
              <View style={[styles.orgBadgeRow, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                <IconSymbol name="building.2.fill" size={13} color={colors.primary} />
                <Text style={[styles.orgBadgeLabel, { color: colors.primary }]} numberOfLines={1}>{load.orgName}</Text>
              </View>
            ) : null}
            <View style={[styles.statusPillInline, {
              backgroundColor:
                load.status === "delivered" ? colors.success + "18" :
                load.status === "picked_up" ? colors.primary + "18" :
                load.status === "new" ? colors.warning + "18" :
                colors.muted + "18",
            }]}>
              <View style={[styles.statusDotInline, {
                backgroundColor:
                  load.status === "delivered" ? colors.success :
                  load.status === "picked_up" ? colors.primary :
                  load.status === "new" ? colors.warning :
                  colors.muted,
              }]} />
              <Text style={[styles.statusPillInlineText, {
                color:
                  load.status === "delivered" ? colors.success :
                  load.status === "picked_up" ? colors.primary :
                  load.status === "new" ? colors.warning :
                  colors.muted,
              }]}>{getStatusLabel(load.status)}</Text>
            </View>
          </View>
          {/* Field Pickup banner */}
          {load.isFieldPickup && (
            <View style={[styles.fieldPickupBanner, { backgroundColor: colors.warning + "14", borderColor: colors.warning + "40" }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={16} color={colors.warning} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.fieldPickupTitle, { color: colors.warning }]}>Field Pickup</Text>
                <Text style={[styles.fieldPickupSubtitle, { color: colors.muted }]}>
                  Route and payment details will be updated by dispatch once this vehicle is assigned to a load.
                </Text>
              </View>
            </View>
          )}

          {/* Vehicle — always one per load */}
          {load.vehicles.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              loadId={load.id}
              loadStatus={load.status}
              loadNumber={load.loadNumber}
              platformTripId={platformTripId}
              driverCode={driverCode}
            />
          ))}

          {/* Pickup Info */}
          {load.isFieldPickup ? (
            <>
              <SectionHeader title="PICKUP INFORMATION" />
              <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 16, paddingHorizontal: 16 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <IconSymbol name="clock.fill" size={16} color={colors.muted} />
                  <Text style={{ color: colors.muted, fontSize: 14 }}>Awaiting dispatch details</Text>
                </View>
                {load.pickup.contact.address ? (
                  <InfoRow label="Scanned at" value={load.pickup.contact.address} navigable />
                ) : null}
                <InfoRow label="Pickup Date" value={formatDate(load.pickup.date)} />
              </View>
              <SectionHeader title="DELIVERY INFORMATION" />
              <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 16, paddingHorizontal: 16 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <IconSymbol name="clock.fill" size={16} color={colors.muted} />
                  <Text style={{ color: colors.muted, fontSize: 14 }}>Awaiting dispatch details</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <SectionHeader title="PICKUP INFORMATION" />
              <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.contactHeader, { borderBottomColor: colors.border }]}>
                  <View style={[styles.contactDot, { backgroundColor: colors.success }]} />
                  <Text style={[styles.contactName, { color: colors.foreground }]}>
                    {load.pickup.contact.company || load.pickup.contact.name}
                  </Text>
                  <TouchableOpacity onPress={handleCallPickup} activeOpacity={0.7}>
                    <View style={[styles.callBtn, { backgroundColor: colors.success + "18" }]}>
                      <IconSymbol name="phone.fill" size={14} color={colors.success} />
                    </View>
                  </TouchableOpacity>
                </View>
                {load.pickup.contact.name && load.pickup.contact.name !== load.pickup.contact.company && (
                  <InfoRow label="Contact" value={load.pickup.contact.name} copyable />
                )}
                <InfoRow label="Phone" value={load.pickup.contact.phone} onPress={handleCallPickup} copyable />
                <InfoRow
                  label="Address"
                  value={`${load.pickup.contact.address}, ${load.pickup.contact.city}, ${load.pickup.contact.state} ${load.pickup.contact.zip}`.replace(/,\s*,/g, ",").trim()}
                  navigable
                />
                <InfoRow label="Pickup Date" value={formatDate(load.pickup.date)} />
              </View>

              {/* Delivery Info */}
              <SectionHeader title="DELIVERY INFORMATION" />
              <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.contactHeader, { borderBottomColor: colors.border }]}>
                  <View style={[styles.contactDot, { backgroundColor: colors.error }]} />
                  <Text style={[styles.contactName, { color: colors.foreground }]}>
                    {load.delivery.contact.company || load.delivery.contact.name}
                  </Text>
                  <TouchableOpacity onPress={handleCallDelivery} activeOpacity={0.7}>
                    <View style={[styles.callBtn, { backgroundColor: colors.error + "18" }]}>
                      <IconSymbol name="phone.fill" size={14} color={colors.error} />
                    </View>
                  </TouchableOpacity>
                </View>
                {load.delivery.contact.name && load.delivery.contact.name !== load.delivery.contact.company && (
                  <InfoRow label="Contact" value={load.delivery.contact.name} copyable />
                )}
                <InfoRow label="Phone" value={load.delivery.contact.phone} onPress={handleCallDelivery} copyable />
                <InfoRow
                  label="Address"
                  value={`${load.delivery.contact.address}, ${load.delivery.contact.city}, ${load.delivery.contact.state} ${load.delivery.contact.zip}`.replace(/,\s*,/g, ",").trim()}
                  navigable
                />
                <InfoRow label="Delivery Date" value={formatDate(load.delivery.date)} />
              </View>
            </>
          )}

          {/* Alternate delivery notice */}
          {load.wasAlternateDelivery && load.actualDeliveryLocation && (
            <View style={[styles.altDeliveryCard, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "40" }]}>
              <View style={styles.altDeliveryHeader}>
                <IconSymbol name="arrow.triangle.branch" size={15} color={colors.warning} />
                <Text style={[styles.altDeliveryTitle, { color: colors.warning }]}>
                  Delivered to Alternate Location
                </Text>
              </View>
              <Text style={[styles.altDeliveryName, { color: colors.foreground }]}>
                {load.actualDeliveryLocation.name}
              </Text>
              {(load.actualDeliveryLocation.address || load.actualDeliveryLocation.city) && (
                <Text style={[styles.altDeliveryAddr, { color: colors.muted }]}>
                  {[
                    load.actualDeliveryLocation.address,
                    load.actualDeliveryLocation.city,
                    load.actualDeliveryLocation.province,
                  ].filter(Boolean).join(", ")}
                </Text>
              )}
            </View>
          )}

          {/* Payment Info — hidden when rates not visible or field pickup with no pay set */}
          {canViewRates && !(load.isFieldPickup && load.driverPay === 0) && (
            <>
              <SectionHeader title="PAYMENT" />
              <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <InfoRow label="Driver Pay" value={formatCurrency(load.driverPay)} />
                <InfoRow label="Payment Type" value={getPaymentLabel(load.paymentType)} />
              </View>
            </>
          )}

           {/* Notes */}
          {load.notes ? (
            <>
              <SectionHeader title="NOTES" />
              <View style={[styles.notesCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.notesText, { color: colors.foreground }]}>{load.notes}</Text>
              </View>
            </>
          ) : null}
          {/* Gate Pass Section — hidden for field pickups */}
          {!load.isFieldPickup && <SectionHeader title="GATE PASS" />}
          {!load.isFieldPickup && (load.gatePassUrl ? (() => {
            const now = new Date();
            const expires = load.gatePassExpiresAt ? new Date(load.gatePassExpiresAt) : null;
            const isExpired = expires ? now > expires : false;
            const isExpiringSoon = expires && !isExpired ? (expires.getTime() - now.getTime()) < 24 * 60 * 60 * 1000 : false;
            const expiryColor = isExpired ? colors.error : isExpiringSoon ? colors.warning : colors.success;
            const expiryLabel = expires
              ? isExpired
                ? `Expired ${expires.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                : isExpiringSoon
                  ? `Expires today at ${expires.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
                  : `Valid until ${expires.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
              : null;
            return (
              <TouchableOpacity
                style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, paddingHorizontal: 16 }]}
                onPress={() => load.gatePassUrl && WebBrowser.openBrowserAsync(load.gatePassUrl)}
                activeOpacity={0.75}
              >
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="key.fill" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Gate Pass Attached</Text>
                  {expiryLabel ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: expiryColor }} />
                      <Text style={{ color: expiryColor, fontSize: 12, fontWeight: "500" }}>{expiryLabel}</Text>
                    </View>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Tap to view</Text>
                  )}
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </TouchableOpacity>
            );
          })() : (
            <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, paddingHorizontal: 16 }]}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted + "18", alignItems: "center", justifyContent: "center" }}>
                <IconSymbol name="key.fill" size={18} color={colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 15, fontWeight: "500" }}>No gate pass attached</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, opacity: 0.7 }}>The dispatcher has not attached a gate pass to this order</Text>
              </View>
            </View>
          ))}
          {/* Storage Expiry row — only shown when a gate pass is attached */}
          {!load.isFieldPickup && load.storageExpiryDate && load.gatePassUrl ? (() => {
            const now = new Date();
            const expiry = new Date(load.storageExpiryDate!);
            const isExpired = now > expiry;
            const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const isUrgent = !isExpired && daysLeft <= 3;
            const storageColor = isExpired ? colors.error : isUrgent ? colors.warning : colors.foreground;
            const storageLabel = expiry.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
            const daysAgo = Math.abs(daysLeft);
            const storageSubtitle = isExpired
              ? (daysAgo === 0 ? `Expired today — ${storageLabel}` : daysAgo === 1 ? `Expired 1 day ago — ${storageLabel}` : `Expired ${daysAgo} days ago — ${storageLabel}`)
              : isUrgent
                ? `${daysLeft === 0 ? "Expires today" : daysLeft === 1 ? "Expires tomorrow" : `Expires in ${daysLeft} days`} — ${storageLabel}`
                : `Storage expires ${storageLabel}`;
            return (
              <View style={[styles.infoCard, { backgroundColor: isExpired ? colors.error + "12" : isUrgent ? colors.warning + "12" : colors.surface, borderColor: isExpired ? colors.error + "40" : isUrgent ? colors.warning + "40" : colors.border, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, paddingHorizontal: 16, marginTop: 8 }]}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: storageColor + "18", alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="calendar" size={18} color={storageColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: storageColor, fontSize: 14, fontWeight: "600" }}>{storageSubtitle}</Text>
                  {(isExpired || isUrgent) && (
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Vehicle must leave storage</Text>
                  )}
                </View>
              </View>
            );
          })() : null}
          {/* Expenses Section */}
          <SectionHeader title="EXPENSES" />
          {/* Expense list */}
          {expensesList === undefined ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 8 }} />
          ) : expensesList.length > 0 ? (
            <View style={[expenseListStyles.expenseList, { borderColor: colors.border }]}>
              {expensesList.map((exp, idx) => (
                <View
                  key={exp._id}
                  style={[
                    expenseListStyles.expenseRow,
                    { borderBottomColor: colors.border },
                    idx === expensesList.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <View style={expenseListStyles.expenseRowLeft}>
                    {exp.receiptUrl ? (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(exp.receiptUrl!)}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={{ uri: exp.receiptUrl }}
                          style={expenseListStyles.expenseThumb}
                        />
                      </TouchableOpacity>
                    ) : (
                      <View style={[expenseListStyles.expenseThumbPlaceholder, { backgroundColor: colors.surface }]}>
                        <IconSymbol name="doc.text" size={16} color={colors.muted} />
                      </View>
                    )}
                    <View style={expenseListStyles.expenseInfo}>
                      <Text style={[expenseListStyles.expenseLabel, { color: colors.foreground }]} numberOfLines={1}>
                        {exp.label}
                      </Text>
                      <Text style={[expenseListStyles.expenseDate, { color: colors.muted }]}>{exp.expenseDate}</Text>
                    </View>
                  </View>
                  <View style={expenseListStyles.expenseRowRight}>
                    <Text style={[expenseListStyles.expenseAmount, { color: colors.foreground }]}>
                      ${(exp.amountCents / 100).toFixed(2)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDeleteExpense(exp._id)}
                      activeOpacity={0.7}
                      style={expenseListStyles.expenseDeleteBtn}
                    >
                      <IconSymbol name="trash" size={14} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[expenseListStyles.expenseEmpty, { color: colors.muted }]}>No expenses yet</Text>
          )}
          {/* Add Expense button */}
          <TouchableOpacity
            style={[expenseListStyles.addExpenseBtn, { borderColor: colors.primary }]}
            onPress={() => setShowExpenseSheet(true)}
            activeOpacity={0.8}
          >
            <IconSymbol name="plus.circle" size={16} color={colors.primary} />
            <Text style={[expenseListStyles.addExpenseBtnText, { color: colors.primary }]}>Add Expense</Text>
          </TouchableOpacity>

          {/* CTA Button */}
          {load.status === "new" && (
            <>
              {/* Require customer signature toggle */}
              <TouchableOpacity
                style={[styles.sigToggleRow, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setRequireCustomerSignature((v) => !v)}
                activeOpacity={0.7}
              >
                <View style={styles.sigToggleLeft}>
                  <IconSymbol name="pencil.and.outline" size={18} color={requireCustomerSignature ? colors.primary : colors.muted} />
                  <View style={styles.sigToggleTextWrap}>
                    <Text style={[styles.sigToggleLabel, { color: colors.foreground }]}>Require customer signature</Text>
                    <Text style={[styles.sigToggleHint, { color: colors.muted }]}>
                      {requireCustomerSignature ? "Signature screen will appear" : "Will auto-confirm as customer not available"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={requireCustomerSignature}
                  onValueChange={setRequireCustomerSignature}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
                onPress={handleMarkPickedUp}
                activeOpacity={0.85}
              >
                <IconSymbol name="checkmark.circle.fill" size={22} color="#FFFFFF" />
                <Text style={styles.ctaBtnText}>Mark as Picked Up</Text>
              </TouchableOpacity>
            </>
          )}

          {load.status === "picked_up" && (
            <>
              {/* Require customer signature toggle for delivery */}
              <TouchableOpacity
                style={[styles.sigToggleRow, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setRequireDeliverySignature((v) => !v)}
                activeOpacity={0.7}
              >
                <View style={styles.sigToggleLeft}>
                  <IconSymbol name="pencil.and.outline" size={18} color={requireDeliverySignature ? colors.success : colors.muted} />
                  <View style={styles.sigToggleTextWrap}>
                    <Text style={[styles.sigToggleLabel, { color: colors.foreground }]}>Require customer signature</Text>
                    <Text style={[styles.sigToggleHint, { color: colors.muted }]}>
                      {requireDeliverySignature ? "Signature screen will appear" : "Will auto-confirm as customer not available"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={requireDeliverySignature}
                  onValueChange={setRequireDeliverySignature}
                  trackColor={{ false: colors.border, true: colors.success }}
                  thumbColor="#FFFFFF"
                />
              </TouchableOpacity>

              {/* Inline handoff note — visible when no delivery inspection photos */}
              {!hasDeliveryPhotos && (
                <>
                  <SectionHeader title="NOTE FOR NEXT DRIVER" />
                  <View style={[styles.notesCard, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 12 }]}>
                    <TextInput
                      style={[styles.handoffInlineInput, { color: colors.foreground }]}
                      placeholder='e.g. "Key underneath driver side mat" (optional)'
                      placeholderTextColor={colors.muted}
                      value={pendingHandoffNote}
                      onChangeText={setPendingHandoffNote}
                      multiline
                      numberOfLines={2}
                      onFocus={() => setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 300)}
                    />
                  </View>
                </>
              )}

              <TouchableOpacity
                style={[styles.ctaBtn, { backgroundColor: colors.success }]}
                onPress={handleMarkDelivered}
                activeOpacity={0.85}
              >
                <IconSymbol name="checkmark.circle.fill" size={22} color="#FFFFFF" />
                <Text style={styles.ctaBtnText}>Mark as Delivered</Text>
              </TouchableOpacity>

              {isPlatformLoad && (
                <TouchableOpacity
                  style={styles.altDeliveryLink}
                  onPress={() => router.push(`/alternate-delivery/${load.id}` as any)}
                  activeOpacity={0.7}
                >
                  <IconSymbol name="arrow.triangle.branch" size={14} color={colors.muted} />
                  <Text style={[styles.altDeliveryText, { color: colors.muted }]}>
                    Deliver to Alternate Location
                  </Text>
                </TouchableOpacity>
              )}

            </>
          )}



          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Add Expense Sheet */}
      <Modal
        visible={showExpenseSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowExpenseSheet(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableOpacity
            style={expenseSheetStyles.overlay}
            activeOpacity={1}
            onPress={() => setShowExpenseSheet(false)}
          />
          <ScrollView
            style={[expenseSheetStyles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
          <Text style={[expenseSheetStyles.title, { color: colors.foreground }]}>Add Expense</Text>

          {/* Receipt photo */}
          <TouchableOpacity
            style={[expenseSheetStyles.receiptBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={handlePickReceipt}
            activeOpacity={0.8}
          >
            {expenseReceiptUri ? (
              <Image source={{ uri: expenseReceiptUri }} style={expenseSheetStyles.receiptPreview} />
            ) : (
              <>
                <IconSymbol name="camera.fill" size={22} color={colors.muted} />
                <Text style={[expenseSheetStyles.receiptBtnText, { color: colors.muted }]}>Tap to add receipt photo</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Label with quick-select chips */}
          <Text style={[expenseSheetStyles.fieldLabel, { color: colors.muted }]}>CATEGORY</Text>
          <View style={expenseSheetStyles.chipRow}>
            {["Loading Fee", "Fuel", "Toll", "Other"].map((chip) => (
              <TouchableOpacity
                key={chip}
                style={[
                  expenseSheetStyles.chip,
                  { borderColor: expenseLabel === chip ? colors.primary : colors.border,
                    backgroundColor: expenseLabel === chip ? colors.primary + "18" : colors.surface }
                ]}
                onPress={() => {
                  if (chip === "Other") {
                    setExpenseLabel("");
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTimeout(() => labelInputRef.current?.focus(), 50);
                  } else {
                    setExpenseLabel(chip);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={[expenseSheetStyles.chipText, { color: expenseLabel === chip ? colors.primary : colors.muted }]}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            ref={labelInputRef}
            style={[expenseSheetStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Or type a custom label…"
            placeholderTextColor={colors.muted}
            value={expenseLabel}
            onChangeText={setExpenseLabel}
            returnKeyType="next"
          />

          {/* Amount */}
          <Text style={[expenseSheetStyles.fieldLabel, { color: colors.muted }]}>AMOUNT ($)</Text>
          <TextInput
            style={[expenseSheetStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            placeholder="0.00"
            placeholderTextColor={colors.muted}
            value={expenseAmount}
            onChangeText={setExpenseAmount}
            keyboardType="decimal-pad"
            returnKeyType="next"
          />

          {/* Date — native picker */}
          <Text style={[expenseSheetStyles.fieldLabel, { color: colors.muted }]}>DATE</Text>
          <TouchableOpacity
            style={[expenseSheetStyles.input, expenseSheetStyles.datePickerBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <IconSymbol name="calendar" size={16} color={colors.muted} />
            <Text style={[expenseSheetStyles.datePickerText, { color: colors.foreground }]}>{expenseDateStr}</Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={expenseDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(_event, date) => {
                setShowDatePicker(Platform.OS === "android" ? false : true);
                if (date) setExpenseDate(date);
              }}
              maximumDate={new Date()}
            />
          )}
          {showDatePicker && Platform.OS === "ios" && (
            <TouchableOpacity
              style={[expenseSheetStyles.datePickerDone, { backgroundColor: colors.primary }]}
              onPress={() => setShowDatePicker(false)}
              activeOpacity={0.8}
            >
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          )}

          {/* Notes (optional) */}
          <Text style={[expenseSheetStyles.fieldLabel, { color: colors.muted }]}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[expenseSheetStyles.input, expenseSheetStyles.notesInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            placeholder="e.g. paid cash at gate, receipt from driver"
            placeholderTextColor={colors.muted}
            value={expenseNotes}
            onChangeText={setExpenseNotes}
            multiline
            numberOfLines={3}
            returnKeyType="done"
            blurOnSubmit
          />
          {/* Save button */}
          <TouchableOpacity
            style={[expenseSheetStyles.saveBtn, { backgroundColor: colors.primary }, expenseSaving && { opacity: 0.6 }]}
            onPress={handleSaveExpense}
            activeOpacity={0.85}
            disabled={expenseSaving}
          >
            {expenseSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={expenseSheetStyles.saveBtnText}>Save Expense</Text>
            )}
          </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Gate pass is opened via WebBrowser.openBrowserAsync — no modal needed */}

      {/* Toast notification overlay */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toastContainer,
          { opacity: toastOpacity },
        ]}
      >
        <View style={[styles.toastBubble, { backgroundColor: colors.foreground }]}>
          <IconSymbol name="checkmark.circle.fill" size={16} color={colors.background} />
          <Text style={[styles.toastText, { color: colors.background }]}>{toastMessage}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: "column",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 10,
  },
  navHeaderTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    padding: 4,
    marginRight: 4,
  },
  navHeaderCenter: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  navTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
  },
  bolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  bolBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  routeCard: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 0,
  },
  routeStop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
    flexShrink: 0,
  },
  routeStopText: {
    flex: 1,
    gap: 1,
  },
  routeStopLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  routeStopCity: {
    fontSize: 16,
    fontWeight: "700",
  },
  routeStopFacility: {
    fontSize: 12,
    fontWeight: "400",
  },
  routeConnector: {
    flexDirection: "row",
    paddingLeft: 5,
    paddingVertical: 4,
  },
  routeConnectorLine: {
    width: 2,
    height: 20,
    borderRadius: 1,
  },
  content: {
    padding: 16,
  },
  companyStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  orgBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  orgBadgeLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  statusPillInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusDotInline: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusPillInlineText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
  },
  vehicleCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 4,
  },
  vehicleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  vehicleIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleName: {
    fontSize: 17,
    fontWeight: "800",
  },
  vehicleVin: {
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  vehicleColorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  vehicleStats: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  vehicleStat: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  vehicleStatText: {
    fontSize: 11,
    fontWeight: "600",
  },
  inspectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 9,
  },
  inspectBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  infoCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 4,
  },
  contactHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 2,
  },
  contactDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  contactName: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
  },
  callBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: "500",
    width: 90,
  },
  infoRowRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
  },
  actionIcon: {
    padding: 4,
    borderRadius: 6,
  },
  notesCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  notesText: {
    fontSize: 14,
    lineHeight: 20,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 56,
    borderRadius: 16,
    marginTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  altDeliveryLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
  },
  altDeliveryText: {
    fontSize: 13,
    fontWeight: "500",
  },
  fieldPickupBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  fieldPickupTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  fieldPickupSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  altDeliveryCard: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  altDeliveryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  altDeliveryTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  altDeliveryName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  altDeliveryAddr: {
    fontSize: 13,
  },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  notFoundText: {
    fontSize: 18,
    fontWeight: "600",
  },
  backLink: {
    fontSize: 16,
  },
  vehicleUploadBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    marginTop: 2,
  },
  vehicleUploadBannerText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  // Photo review gallery
  photoReviewSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  photoGroup: {},
  photoGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
  },
  photoGroupLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  photoStrip: {
    flexDirection: "row",
  },
  photoThumbWrap: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: "hidden",
    marginRight: 8,
  },
  photoThumb: {
    width: 80,
    height: 80,
  },
  photoThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  // Lightbox
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxClose: {
    position: "absolute",
    top: 56,
    right: 20,
    zIndex: 10,
  },
  lightboxCloseCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxPage: {
    justifyContent: "center",
    alignItems: "center",
    height: Dimensions.get("window").height,
  },
  lightboxImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.75,
  },
  lightboxCounter: {
    position: "absolute",
    bottom: 60,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  sigToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  sigToggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  sigToggleTextWrap: {
    flex: 1,
  },
  sigToggleLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  sigToggleHint: {
    fontSize: 12,
    marginTop: 1,
  },
  toastContainer: {
    position: "absolute",
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
    pointerEvents: "none",
  },
  toastBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

const mapsPickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  optionSub: {
    fontSize: 12,
  },
});

// ─── Expense section styles ───────────────────────────────────────────────────
const expenseStyles = StyleSheet.create({
  expenseList: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 8,
  },
  expenseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  expenseRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  expenseThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: "#eee",
  },
  expenseThumbPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  expenseInfo: {
    flex: 1,
    gap: 2,
  },
  expenseLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  expenseDate: {
    fontSize: 11,
  },
  expenseRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  expenseAmount: {
    fontSize: 15,
    fontWeight: "700",
  },
  expenseDeleteBtn: {
    padding: 4,
  },
  expenseEmpty: {
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
    paddingVertical: 8,
  },
  addExpenseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 16,
  },
  addExpenseBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

// Merge expense styles into the main styles object reference
// (done via a proxy-like approach: reference expenseStyles in JSX)
const expenseListStyles = expenseStyles;

// ─── Expense sheet modal styles ───────────────────────────────────────────────
const expenseSheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: 20,
    paddingBottom: 40,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  receiptBtn: {
    height: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 4,
    overflow: "hidden",
  },
  receiptPreview: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  receiptBtnText: {
    fontSize: 13,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  datePickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  datePickerText: {
    fontSize: 15,
    fontWeight: "500",
  },
  datePickerDone: {
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  notesInput: {
    height: 80,
    textAlignVertical: "top",
    paddingTop: 10,
  },
  handoffInlineInput: {
    fontSize: 14,
    lineHeight: 20,
    minHeight: 50,
    textAlignVertical: "top",
    padding: 0,
  },
});
