import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import { LocationsMapModal, type MapPin } from "@/components/locations-map-modal";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Animated,
  Pressable,
  Modal,
  ScrollView,
  PanResponder,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { ActivityIndicator } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  type Load,
  type LoadStatus,
  formatCurrency,
  formatDate,
  getPaymentLabel,
} from "@/lib/data";
import { setVINLaunchContext, setPendingLoadVINs, setIsExclusiveDriver } from "@/lib/vin-store";
import { usePermissions } from "@/lib/permissions-context";
import { useQuery as useConvexQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpc } from "@/lib/trpc";
import { useSettings } from "@/lib/settings-context";
import { usePhotoQueue } from "@/hooks/use-photo-queue";
import { pickupHighlightStore } from "@/lib/pickup-highlight-store";

type TabFilter = LoadStatus | "all";

const TABS: { key: TabFilter; label: string }[] = [
  { key: "new", label: "Pending" },
  { key: "picked_up", label: "Picked Up" },
  { key: "delivered", label: "Delivered" },
  { key: "archived", label: "Archived" },
];

// Tab order for swipe navigation (must match TABS order)
const TAB_ORDER: TabFilter[] = ["new", "picked_up", "delivered", "archived"];

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LoadStatus }) {
  const colors = useColors();
  const config: Record<LoadStatus, { bg: string; text: string; label: string }> = {
    new: { bg: colors.warning + "22", text: colors.warning, label: "Pending Pickup" },
    picked_up: { bg: colors.primary + "22", text: colors.primary, label: "Picked Up" },
    delivered: { bg: colors.success + "22", text: colors.success, label: "Delivered" },
    archived: { bg: colors.muted + "22", text: colors.muted, label: "Archived" },
  };
  const c = config[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

// ─── Load Card ────────────────────────────────────────────────────────────────

const LoadCard = React.memo(function LoadCard({ load, onPress, onDelete, onArchive, pendingCount = 0, failedCount = 0 }: {
  load: Load; onPress: () => void; onDelete?: () => void; onArchive?: () => void; pendingCount?: number; failedCount?: number;
}) {
  const colors = useColors();
  const { canViewRates } = usePermissions();
  const { settings } = useSettings();
  const vehicleCount = load.vehicles.length;
  const isPlatformLoad = load.id.startsWith("platform-");

  // Build vehicle label: show year/make/model for single vehicle, or first + count for multiple
  const firstVehicle = load.vehicles[0];
  const vehicleLabel = (() => {
    if (vehicleCount === 0) return "No Vehicles";
    const v = firstVehicle;
    const parts = [v?.year, v?.make, v?.model].filter(Boolean);
    const vehicleInfo = parts.length > 0 ? parts.join(" ") : null;
    // Append last-6 of VIN if available
    const vin6 = v?.vin && v.vin.length >= 6 ? v.vin.slice(-6) : null;
    const baseLabel = vehicleInfo ?? (vin6 ? vin6 : `${vehicleCount} ${vehicleCount === 1 ? "Vehicle" : "Vehicles"}`);
    const labelWithVin = vehicleInfo && vin6 ? `${vehicleInfo}  ·  ${vin6}` : baseLabel;
    if (vehicleCount === 1) return labelWithVin;
    return `${labelWithVin} & ${vehicleCount - 1} more`;
  })();
  const stripeColor =
    load.status === "new" ? colors.warning :
    load.status === "picked_up" ? colors.primary :
    load.status === "delivered" ? colors.success :
    colors.muted;

  const isDeletable = onDelete && !load.id.startsWith("platform-");
  const isArchivable = onArchive && load.status === "delivered";

  const renderRightActions = () => (
    <TouchableOpacity
      style={[styles.deleteAction, { backgroundColor: colors.error }]}
      onPress={onDelete}
      activeOpacity={0.85}
    >
      <IconSymbol name="trash.fill" size={22} color="#FFFFFF" />
      <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700", marginTop: 4 }}>Delete</Text>
    </TouchableOpacity>
  );

  const renderArchiveAction = () => (
    <TouchableOpacity
      style={[styles.deleteAction, { backgroundColor: "#607D8B" }]}
      onPress={onArchive}
      activeOpacity={0.85}
    >
      <IconSymbol name="archivebox.fill" size={22} color="#FFFFFF" />
      <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700", marginTop: 4 }}>Archive</Text>
    </TouchableOpacity>
  );

  const card = (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.stripe, { backgroundColor: stripeColor }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={[styles.loadNumber, { color: colors.muted }]} numberOfLines={1}>
            {firstVehicle?.vin ? firstVehicle.vin.toUpperCase() : `#${load.loadNumber}`}
          </Text>
          <StatusBadge status={load.status} />
        </View>
        {load.isFieldPickup ? (
          <View style={[styles.orgBadge, { backgroundColor: colors.warning + "14" }]}>
            <IconSymbol name="exclamationmark.triangle.fill" size={11} color={colors.warning} />
            <Text style={[styles.orgBadgeText, { color: colors.warning }]} numberOfLines={1}>Field Pickup</Text>
          </View>
        ) : load.orgName ? (
          <View style={[styles.orgBadge, { backgroundColor: colors.primary + "14" }]}>
            <IconSymbol name="building.2.fill" size={11} color={colors.primary} />
            <Text style={[styles.orgBadgeText, { color: colors.primary }]} numberOfLines={1}>{load.orgName}</Text>
          </View>
        ) : null}
        <Text style={[styles.vehicleCount, { color: colors.foreground }]} numberOfLines={1}>
          {vehicleLabel}
        </Text>
        {load.isFieldPickup ? (
          <View style={styles.routeRow}>
            <View style={styles.routePoint}>
              <View style={[styles.routeDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.routeCity, { color: colors.muted }]} numberOfLines={1}>
                {load.pickup.contact.address || "Scanned location"}
              </Text>
            </View>
            <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
            <View style={styles.routePoint}>
              <View style={[styles.routeDot, { backgroundColor: colors.muted }]} />
              <Text style={[styles.routeCity, { color: colors.muted, fontStyle: "italic" }]} numberOfLines={1}>
                Awaiting dispatch
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.routeRow}>
            <View style={styles.routePoint}>
              <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.routeCity, { color: colors.foreground }]} numberOfLines={1}>
                {settings.routeDisplayMode === "facility"
                  ? (load.pickup.contact.company || load.pickup.contact.city || "—")
                  : `${load.pickup.contact.city || "—"}, ${load.pickup.contact.state || "—"}`}
              </Text>
            </View>
            <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
            <View style={styles.routePoint}>
              <View style={[styles.routeDot, { backgroundColor: colors.error }]} />
              <Text style={[styles.routeCity, { color: colors.foreground }]} numberOfLines={1}>
                {settings.routeDisplayMode === "facility"
                  ? (load.delivery.contact.company || load.delivery.contact.city || "—")
                  : `${load.delivery.contact.city || "—"}, ${load.delivery.contact.state || "—"}`}
              </Text>
            </View>
          </View>
        )}
        <View style={styles.datesRow}>
          <Text style={[styles.dateText, { color: colors.muted }]}>
            Pickup: {formatDate(load.pickup.date)}
          </Text>
          <Text style={[styles.dateText, { color: colors.muted }]}>
            Delivery: {formatDate(load.delivery.date)}
          </Text>
        </View>
        {/* Pending upload indicator — visible even after picked up */}
        {(pendingCount > 0 || failedCount > 0) && (
          <View style={[styles.uploadBanner, {
            backgroundColor: failedCount > 0 ? colors.error + "18" : colors.warning + "18",
            borderColor: failedCount > 0 ? colors.error + "44" : colors.warning + "44",
          }]}>
            <Text style={[styles.uploadBannerText, { color: failedCount > 0 ? colors.error : colors.warning }]}>
              {failedCount > 0
                ? `⚠ ${failedCount} photo${failedCount !== 1 ? "s" : ""} failed to upload`
                : `⬆ ${pendingCount} photo${pendingCount !== 1 ? "s" : ""} uploading...`}
            </Text>
          </View>
        )}

        {load.wasAlternateDelivery && (
          <View style={[styles.altDropBadge, { backgroundColor: colors.warning + "14" }]}>
            <IconSymbol name="arrow.triangle.branch" size={11} color={colors.warning} />
            <Text style={[styles.altDropBadgeText, { color: colors.warning }]} numberOfLines={1}>
              Alt drop: {load.actualDeliveryLocation?.name ?? "Alternate location"}
            </Text>
          </View>
        )}

        <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
          {canViewRates ? (
            <Text style={[styles.payAmount, { color: colors.primary }]}>
              {formatCurrency(load.driverPay)}
            </Text>
          ) : (
            <View />
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {load.gatePassUrl ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.primary + "18", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 }}>
                <IconSymbol name="key.fill" size={11} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "600" }}>Gate Pass</Text>
              </View>
            ) : null}
            {(() => {
              if (!load.storageExpiryDate || !load.gatePassUrl) return null;
              const now = new Date();
              const expiry = new Date(load.storageExpiryDate);
              const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              if (daysLeft > 3) return null; // only show within 3 days
              const pillColor =
                daysLeft <= 0 ? colors.error :
                daysLeft === 1 ? colors.error :
                daysLeft === 2 ? colors.warning :
                colors.success; // 3 days = green
              const daysAgo = Math.abs(daysLeft);
              const pillLabel =
                daysLeft < 0 ? (daysAgo === 1 ? "Expired 1 day ago" : `Expired ${daysAgo} days ago`) :
                daysLeft === 0 ? "Expires today" :
                daysLeft === 1 ? "Expires tomorrow" :
                `Storage: ${daysLeft} days`;
              return (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: pillColor + "22", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: pillColor }} />
                  <Text style={{ color: pillColor, fontSize: 11, fontWeight: "700" }}>{pillLabel}</Text>
                </View>
              );
            })()}

          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (isDeletable) {
    return (
      <ReanimatedSwipeable
        renderRightActions={renderRightActions}
        rightThreshold={60}
        overshootRight={false}
        friction={2}
      >
        {card}
      </ReanimatedSwipeable>
    );
  }

  if (isArchivable) {
    return (
      <ReanimatedSwipeable
        renderRightActions={renderArchiveAction}
        rightThreshold={60}
        overshootRight={false}
        friction={2}
      >
        {card}
      </ReanimatedSwipeable>
    );
  }

  return card;
});

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  tab,
  onAddLoad,
  driverCode,
  isLoading,
}: {
  tab: TabFilter;
  onAddLoad: () => void;
  driverCode?: string | null;
  isLoading?: boolean;
}) {
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.emptySubtitle, { color: colors.muted, marginTop: 12 }]}>
          Checking for assigned loads...
        </Text>
      </View>
    );
  }

  const messages: Record<TabFilter, { emoji: string; title: string; subtitle: string }> = {
    all: { emoji: "📋", title: "No Loads", subtitle: "Tap + to add your first load." },
    new: {
      emoji: "📦",
      title: "No Pending Loads",
      subtitle: driverCode
        ? `No loads have been assigned to you yet.\nShare your Driver ID with your dispatcher.`
        : "New loads assigned to you will appear here.\nTap + to add a load manually.",
    },
    picked_up: { emoji: "🚛", title: "Nothing In Transit", subtitle: "Loads you've picked up will appear here." },
    delivered: { emoji: "✅", title: "No Delivered Loads", subtitle: "Completed deliveries will appear here." },
    archived: { emoji: "🗂️", title: "No Archived Loads", subtitle: "Archived loads will appear here." },
  };
  const m = messages[tab];
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyEmoji}>{m.emoji}</Text>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{m.title}</Text>
      <Text style={[styles.emptySubtitle, { color: colors.muted }]}>{m.subtitle}</Text>
      {/* Show driver code pill so driver can share it with dispatcher */}
      {tab === "new" && driverCode && (
        <View style={[styles.driverCodePill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.driverCodeLabel, { color: colors.muted }]}>Your Driver ID</Text>
          <Text style={[styles.driverCodeValue, { color: colors.primary }]}>{driverCode}</Text>
        </View>
      )}
      {(tab === "new" || tab === "all") && (
        <TouchableOpacity
          style={[styles.emptyAddBtn, { backgroundColor: colors.primary }]}
          onPress={onAddLoad}
          activeOpacity={0.85}
        >
          <IconSymbol name="plus" size={16} color="#FFFFFF" />
          <Text style={styles.emptyAddBtnText}>Add Load Manually</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── FAB ─────────────────────────────────────────────────────────────────────

function FAB({ onAddLoad, onScanVIN }: { onAddLoad: () => void; onScanVIN: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const animation = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const toValue = open ? 0 : 1;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.spring(animation, {
      toValue,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
    setOpen(!open);
  };

  const close = () => {
    Animated.spring(animation, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    setOpen(false);
  };

  const rotation = animation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] });
  const option1Translate = animation.interpolate({ inputRange: [0, 1], outputRange: [0, -130] });
  const option2Translate = animation.interpolate({ inputRange: [0, 1], outputRange: [0, -70] });
  const optionOpacity = animation.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });

  const bottomOffset = insets.bottom + 80; // above tab bar

  return (
    <>
      {/* Backdrop to close FAB */}
      {open && (
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      )}

      <View style={[styles.fabContainer, { bottom: bottomOffset }]} pointerEvents="box-none">

        {/* Option 1: Add New Load */}
        <Animated.View
          style={[
            styles.fabOptionRow,
            { transform: [{ translateY: option1Translate }], opacity: optionOpacity },
          ]}
          pointerEvents={open ? "auto" : "none"}
        >
          <View style={[styles.fabOptionLabel, { backgroundColor: colors.foreground }]}>
            <Text style={[styles.fabOptionLabelText, { color: colors.background }]}>Add New Load</Text>
          </View>
          <TouchableOpacity
            style={[styles.fabOption, { backgroundColor: colors.primary }]}
            onPress={() => { close(); setTimeout(onAddLoad, 200); }}
            activeOpacity={0.85}
          >
            <IconSymbol name="pencil" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>

        {/* Option 2: Scan VIN */}
        <Animated.View
          style={[
            styles.fabOptionRow,
            { transform: [{ translateY: option2Translate }], opacity: optionOpacity },
          ]}
          pointerEvents={open ? "auto" : "none"}
        >
          <View style={[styles.fabOptionLabel, { backgroundColor: colors.foreground }]}>
            <Text style={[styles.fabOptionLabelText, { color: colors.background }]}>Scan VIN</Text>
          </View>
          <TouchableOpacity
            style={[styles.fabOption, { backgroundColor: "#1A73E8" }]}
            onPress={() => { close(); setTimeout(onScanVIN, 200); }}
            activeOpacity={0.85}
          >
            <IconSymbol name="barcode.viewfinder" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>

        {/* Main FAB */}
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={toggle}
          activeOpacity={0.85}
        >
          <Animated.View style={{ transform: [{ rotate: rotation }] }}>
            <IconSymbol name="plus" size={28} color="#FFFFFF" />
          </Animated.View>
        </TouchableOpacity>

      </View>
    </>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LoadsScreen() {
  const colors = useColors();
  const { canViewRates } = usePermissions();
  const { loads, isLoadingPlatformLoads, platformLoadError, lastSyncedAt, refreshPlatformLoads, deleteLoad, clearNonPlatformLoads, archiveAllDelivered, archiveSingleLoad, clearAllArchived } = useLoads();

  const handleDeleteLoad = useCallback((load: Load) => {
    if (load.id.startsWith("platform-")) return; // safety guard
    const vehicleLabel = load.vehicles[0]
      ? [load.vehicles[0].year, load.vehicles[0].make, load.vehicles[0].model].filter(Boolean).join(" ")
      : load.loadNumber;
    Alert.alert(
      "Delete Load?",
      `Remove "${vehicleLabel}" from your list? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            deleteLoad(load.id);
          },
        },
      ]
    );
  }, [deleteLoad]);
  const { driver } = useAuth();
  const { entries: queueEntries } = usePhotoQueue();
  const queueCountsByLoad = useMemo(() => {
    const map: Record<string, { pending: number; failed: number }> = {};
    for (const e of queueEntries) {
      if (!e.loadId) continue;
      if (!map[e.loadId]) map[e.loadId] = { pending: 0, failed: 0 };
      if (e.status === "pending" || e.status === "uploading") map[e.loadId].pending++;
      else if (e.status === "failed") map[e.loadId].failed++;
    }
    return map;
  }, [queueEntries]);
  const exclusiveStatus = useConvexQuery(
    api.companies.hasExclusiveLink,
    driver?.id ? { clerkUserId: driver.id } : "skip",
  );
  const [activeTab, setActiveTab] = useState<TabFilter>("new");
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupMode, setGroupMode] = useState<"default" | "pickup" | "dropoff" | "shipper">("default");
  const [showSortSheet, setShowSortSheet] = useState(false);

  // Clear search when switching tabs
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      setSearchQuery("");
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  // Fetch the DB profile by local code — same source as Profile screen.
  // getMyProfile only works for session-auth users; getProfileByCode works for all phone-auth drivers.
  const localDriverCode = driver?.driverCode ?? null;
  const isValidLocalCode = /^D-\d{5}$/.test(localDriverCode ?? "");
  const { data: dbProfile } = trpc.driver.getProfileByCode.useQuery(
    { driverCode: localDriverCode ?? "D-00000" },
    { enabled: isValidLocalCode, retry: false, staleTime: 60_000 }
  );
  // Platform code (D-68544) takes priority; fall back to local code only if platform code not yet assigned
  const displayDriverCode = dbProfile?.platformDriverCode ?? localDriverCode ?? null;

  const groupKeyFn = useCallback((load: Load): string => {
    if (groupMode === "pickup") return load.pickup.contact.company || load.pickup.contact.city || "Unknown";
    if (groupMode === "dropoff") return load.delivery.contact.company || load.delivery.contact.city || "Unknown";
    if (groupMode === "shipper") return load.orgName || "Unknown";
    return "";
  }, [groupMode]);

  const sortedLoads = useMemo(() => {
    const sorted = [...loads];
    if (groupMode !== "default") {
      sorted.sort((a, b) => {
        const ga = groupKeyFn(a).toLowerCase();
        const gb = groupKeyFn(b).toLowerCase();
        if (ga !== gb) return ga.localeCompare(gb);
        return new Date(b.assignedAt || b.pickup.date || 0).getTime()
             - new Date(a.assignedAt || a.pickup.date || 0).getTime();
      });
    } else {
      sorted.sort((a, b) => {
        return new Date(b.assignedAt || b.pickup.date || 0).getTime()
             - new Date(a.assignedAt || a.pickup.date || 0).getTime();
      });
    }
    return sorted;
  }, [loads, groupMode, groupKeyFn]);

  const baseFilteredLoads = sortedLoads.filter((l) => l.status === activeTab);

  // Search filter — only active on Delivered and Archived tabs
  const filteredLoads = useMemo(() => {
    const isSearchTab = activeTab === "delivered" || activeTab === "archived";
    if (!isSearchTab || !searchQuery.trim()) return baseFilteredLoads;
    const q = searchQuery.trim().toLowerCase();
    return baseFilteredLoads.filter((load) =>
      load.vehicles.some((v) => {
        const vin = (v.vin ?? "").toLowerCase();
        const make = (v.make ?? "").toLowerCase();
        const model = (v.model ?? "").toLowerCase();
        const year = (v.year ?? "").toLowerCase();
        // Match against any field individually, or combined "year make model"
        const combined = `${year} ${make} ${model}`.toLowerCase();
        return (
          vin.includes(q) ||
          make.includes(q) ||
          model.includes(q) ||
          year.includes(q) ||
          combined.includes(q)
        );
      })
    );
  }, [baseFilteredLoads, activeTab, searchQuery]);
  const newCount = sortedLoads.filter((l) => l.status === "new").length;
  const pickedUpCount = sortedLoads.filter((l) => l.status === "picked_up").length;

  // Compute stats for the current tab's loads
  const tabStats = useMemo(() => {
    const tabLoads = filteredLoads;
    // Total vehicles in current tab
    const totalVehicles = tabLoads.reduce((sum, l) => sum + l.vehicles.length, 0);
    // Delivery stats — computed from ALL loads (not just current tab)
    const now = new Date();
    const thisMonth = now.getMonth(); // 0-indexed
    const thisYear = now.getFullYear();
    const deliveredLoads = sortedLoads.filter((l) => l.status === "delivered" || l.status === "archived");
    let deliveredThisMonth = 0;
    let deliveredThisYear = 0;
    let deliveredAllTime = 0;
    for (const l of deliveredLoads) {
      const vehicleCount = Math.max(l.vehicles.length, 1);
      deliveredAllTime += vehicleCount;
      // Use delivery date if available, fall back to assignedAt
      const dateStr = l.delivery.date || l.assignedAt || "";
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          if (d.getFullYear() === thisYear) {
            deliveredThisYear += vehicleCount;
            if (d.getMonth() === thisMonth) {
              deliveredThisMonth += vehicleCount;
            }
          }
        }
      }
    }
    // Build pin arrays for map modal — one pin per vehicle in each load
    const pickupPins: MapPin[] = tabLoads
      .filter((l) => l.pickup.lat && l.pickup.lng)
      .flatMap((l) => {
        const city = l.pickup.contact.company || l.pickup.contact.name || [l.pickup.contact.city, l.pickup.contact.state].filter(Boolean).join(", ") || l.pickup.contact.address;
        if (l.vehicles.length === 0) {
          return [{ lat: l.pickup.lat, lng: l.pickup.lng, label: `Load #${l.loadNumber}`, sublabel: city }];
        }
        return l.vehicles.map((v) => {
          const parts = [v.year, v.make, v.model].filter(Boolean);
          // Label shows year/make/model only — no VIN
          const label = parts.length > 0 ? parts.join(" ") : `Load #${l.loadNumber}`;
          const vehicleKey = v.vin ? `${l.loadNumber}-${v.vin}` : `${l.loadNumber}-${v.make}-${v.model}`;
          return { lat: l.pickup.lat, lng: l.pickup.lng, label, sublabel: city, vehicleKey };
        });
      });
    const dropoffPins: MapPin[] = tabLoads
      .filter((l) => l.delivery.lat && l.delivery.lng)
      .flatMap((l) => {
        const city = l.delivery.contact.company || l.delivery.contact.name || [l.delivery.contact.city, l.delivery.contact.state].filter(Boolean).join(", ") || l.delivery.contact.address;
        if (l.vehicles.length === 0) {
          return [{ lat: l.delivery.lat, lng: l.delivery.lng, label: `Load #${l.loadNumber}`, sublabel: city }];
        }
        return l.vehicles.map((v) => {
          const parts = [v.year, v.make, v.model].filter(Boolean);
          // Label shows year/make/model only — no VIN
          const label = parts.length > 0 ? parts.join(" ") : `Load #${l.loadNumber}`;
          const vehicleKey = v.vin ? `${l.loadNumber}-${v.vin}` : `${l.loadNumber}-${v.make}-${v.model}`;
          return { lat: l.delivery.lat, lng: l.delivery.lng, label, sublabel: city, vehicleKey };
        });
      });
    // Build flat vehicle roster list for the roster sheet
    const vehicleList = tabLoads.flatMap((l) =>
      l.vehicles.map((v) => {
        const parts = [v.year, v.make, v.model].filter(Boolean);
        const desc = parts.length > 0 ? parts.join(" ") : (v as any).displayName ?? "Unknown Vehicle";
        const vin6 = v.vin && v.vin.length >= 6 ? v.vin.slice(-6).toUpperCase() : (v.vin ?? "").toUpperCase();
        return { desc, vin6, loadNumber: l.loadNumber };
      })
    );
    const uniquePickupCount = new Set(pickupPins.map((p) => `${p.lat},${p.lng}`)).size;
    const uniqueDropoffCount = new Set(dropoffPins.map((p) => `${p.lat},${p.lng}`)).size;
    return {
      totalVehicles,
      pickupPins,
      dropoffPins,
      uniquePickupCount,
      uniqueDropoffCount,
      vehicleList,
      deliveredThisMonth,
      deliveredThisYear,
      deliveredAllTime,
    };
  }, [filteredLoads, sortedLoads]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refreshPlatformLoads();
    setTimeout(() => setRefreshing(false), 1500);
  }, [refreshPlatformLoads]);

  const handleLoadPress = (load: Load) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/load/${load.id}` as any);
  };

  const handleAddLoad = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/add-load" as any);
  };

  const handleScanVIN = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const pendingLoads = loads.filter((l) => l.status === "new" || l.status === "picked_up");
    const pendingVINs = pendingLoads.flatMap((l) =>
      l.vehicles
        .filter((v) => v.vin && v.vin.trim().length >= 6)
        .map((v) => ({ loadId: l.id, vin: v.vin as string, loadNumber: l.loadNumber }))
    );
    setPendingLoadVINs(pendingVINs);
    setIsExclusiveDriver(exclusiveStatus?.hasExclusive === true);
    setVINLaunchContext("add-load");
    router.push("/vin-scanner" as any);
  };

  const [mapModal, setMapModal] = useState<{ type: "pickup" | "dropoff" } | null>(null);
  const [vehicleRosterVisible, setVehicleRosterVisible] = useState(false);

  // Swipe gesture to navigate between tabs
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // Slide animation: translateX slides content in from swipe direction
  const slideAnim = useRef(new Animated.Value(0)).current;
  const SCREEN_WIDTH = 390; // approximate, good enough for slide offset

  const switchTab = useCallback((newTab: TabFilter, direction: "left" | "right") => {
    // Instantly position content off-screen in the incoming direction
    const fromX = direction === "left" ? SCREEN_WIDTH : -SCREEN_WIDTH;
    slideAnim.setValue(fromX);
    setActiveTab(newTab);
    // Animate slide in to center
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  const swipePanResponder = useRef(
    PanResponder.create({
      // Only claim the gesture if horizontal movement dominates vertical
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        const { dx, dy } = gestureState;
        return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12;
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const { dx, vx } = gestureState;
        // Require at least 50px or fast flick (velocity > 0.3)
        if (Math.abs(dx) < 50 && Math.abs(vx) < 0.3) return;
        const currentIndex = TAB_ORDER.indexOf(activeTabRef.current);
        if (dx < 0 && currentIndex < TAB_ORDER.length - 1) {
          // Swipe left → next tab — new content slides in from the right
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          switchTab(TAB_ORDER[currentIndex + 1], "right");
        } else if (dx > 0 && currentIndex > 0) {
          // Swipe right → previous tab — new content slides in from the left
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          switchTab(TAB_ORDER[currentIndex - 1], "left");
        }
      },
    })
  ).current;

  // ── Universal tab pulse animation (plays once after any load status change) ────
  // One Animated.Value pair per tab pill
  const tabPulse = useRef<Partial<Record<TabFilter, Animated.Value>>>({
    new: new Animated.Value(1),
    picked_up: new Animated.Value(1),
    delivered: new Animated.Value(1),
    archived: new Animated.Value(1),
  }).current;
  const tabBgOpacity = useRef<Partial<Record<TabFilter, Animated.Value>>>({
    new: new Animated.Value(0),
    picked_up: new Animated.Value(0),
    delivered: new Animated.Value(0),
    archived: new Animated.Value(0),
  }).current;

  // Toast state for the loads index screen (shown after returning from a status change)
  const [tabToastMsg, setTabToastMsg] = useState("");
  const [tabToastVisible, setTabToastVisible] = useState(false);
  const tabToastAnim = useRef(new Animated.Value(0)).current;

  const showTabToast = useCallback((message: string) => {
    setTabToastMsg(message);
    setTabToastVisible(true);
    tabToastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(tabToastAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(tabToastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setTabToastVisible(false));
  }, [tabToastAnim]);

  const playTabPulse = useCallback((tab: TabFilter) => {
    const pulse = tabPulse[tab as keyof typeof tabPulse];
    const bg = tabBgOpacity[tab as keyof typeof tabBgOpacity];
    if (!pulse || !bg) return;
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.spring(pulse, { toValue: 1.18, useNativeDriver: true, speed: 20, bounciness: 8 }),
        Animated.timing(bg, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]),
      Animated.delay(500),
      Animated.parallel([
        Animated.spring(pulse, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 4 }),
        Animated.timing(bg, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]),
    ]).start();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [tabPulse, tabBgOpacity]);

  // Check for a pending highlight signal every time this screen gains focus
  useFocusEffect(
    useCallback(() => {
      const signal = pickupHighlightStore.consume();
      if (signal) {
        // Determine swipe direction based on tab order
        const currentIdx = TAB_ORDER.indexOf(activeTabRef.current);
        const destIdx = TAB_ORDER.indexOf(signal.tab);
        const direction = destIdx >= currentIdx ? "right" : "left";
        switchTab(signal.tab, direction);
        playTabPulse(signal.tab);
        showTabToast(signal.message);
      }
    }, [switchTab, playTabPulse, showTabToast])
  );

  // One-time swipe hint
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const hintAnim = useRef(new Animated.Value(0)).current;
  const hintArrowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem("swipe_hint_shown").then((val) => {
      if (!val) {
        // Show hint after a short delay so the screen has loaded
        const timer = setTimeout(() => {
          setShowSwipeHint(true);
          // Fade in
          Animated.timing(hintAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start(() => {
            // Animate arrow bouncing left-right 3 times
            Animated.sequence([
              Animated.timing(hintArrowAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
              Animated.timing(hintArrowAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
              Animated.timing(hintArrowAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
              Animated.timing(hintArrowAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
              Animated.timing(hintArrowAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
              Animated.timing(hintArrowAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
            ]).start(() => {
              // Fade out after animation completes
              Animated.timing(hintAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
                setShowSwipeHint(false);
              });
            });
          });
          AsyncStorage.setItem("swipe_hint_shown", "1");
        }, 1200);
        return () => clearTimeout(timer);
      }
    });
  }, [hintAnim, hintArrowAnim]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenContainer containerClassName="bg-background">
        {/* Header — single line: greeting + name + ID pill */}
        <View style={[styles.header, { backgroundColor: colors.primary }]}>
          <Text style={styles.headerGreeting} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
            Welcome back, <Text style={styles.headerNameInline}>{driver?.name ?? "Driver"}</Text>
            {displayDriverCode ? (
              <Text style={styles.headerDriverId}>  ·  {displayDriverCode}</Text>
            ) : null}
          </Text>
        </View>

        {/* Tab Filter */}
        <View style={[styles.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = tab.key === "new" ? newCount : tab.key === "picked_up" ? pickedUpCount : undefined;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive && { borderBottomColor: colors.primary, borderBottomWidth: 2.5 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const currentIdx = TAB_ORDER.indexOf(activeTab);
                  const newIdx = TAB_ORDER.indexOf(tab.key);
                  if (newIdx !== currentIdx) {
                    switchTab(tab.key, newIdx > currentIdx ? "right" : "left");
                  }
                }}
                activeOpacity={0.7}
              >
                {/* Every tab pill gets an animated scale + bg-flash on status change */}
                {(() => {
                  const pulse = tabPulse[tab.key as keyof typeof tabPulse];
                  const bg = tabBgOpacity[tab.key as keyof typeof tabBgOpacity];
                  if (!pulse || !bg) {
                    return (
                      <View style={styles.tabLabelRow}>
                        <Text style={[styles.tabLabel, { color: isActive ? colors.primary : colors.muted }]}>
                          {tab.label}
                        </Text>
                        {count !== undefined && count > 0 && (
                          <View style={[styles.tabBadge, { backgroundColor: tab.key === "new" ? colors.warning : colors.primary }]}>
                            <Text style={styles.tabBadgeText}>{count}</Text>
                          </View>
                        )}
                      </View>
                    );
                  }
                  return (
                    <Animated.View
                      style={[
                        styles.tabLabelRow,
                        {
                          transform: [{ scale: pulse }],
                          borderRadius: 12,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          overflow: "hidden",
                        },
                      ]}
                    >
                      {/* Animated background flash layer */}
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          StyleSheet.absoluteFillObject,
                          {
                            borderRadius: 12,
                            backgroundColor: colors.primary,
                            opacity: bg,
                          },
                        ]}
                      />
                      <Text style={[styles.tabLabel, { color: isActive ? colors.primary : colors.muted }]}>
                        {tab.label}
                      </Text>
                      {count !== undefined && count > 0 && (
                        <View style={[styles.tabBadge, { backgroundColor: tab.key === "new" ? colors.warning : colors.primary }]}>
                          <Text style={styles.tabBadgeText}>{count}</Text>
                        </View>
                      )}
                    </Animated.View>
                  );
                })()}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Stats Bar — Pickup Spots / Drop-off Spots / Vehicles */}
        <View style={[styles.statsBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{tabStats.uniquePickupCount}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>PICKUP SPOTS</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMapModal({ type: "pickup" });
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.statLink, { color: colors.primary }]}>View Map ›</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{tabStats.uniqueDropoffCount}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>DROP-OFF SPOTS</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMapModal({ type: "dropoff" });
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.statLink, { color: colors.primary }]}>View Map ›</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{tabStats.totalVehicles}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>VEHICLES</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setVehicleRosterVisible(true);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.statLink, { color: colors.primary }]}>View List ›</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.sortBtn}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowSortSheet(true);
            }}
          >
            <IconSymbol
              name="arrow.up.arrow.down"
              size={16}
              color={groupMode !== "default" ? colors.primary : colors.muted}
            />
            {groupMode !== "default" && (
              <View style={[styles.sortActiveDot, { backgroundColor: colors.primary }]} />
            )}
          </TouchableOpacity>
        </View>
        {/* Search Bar — only shown on Delivered and Archived tabs */}
        {(activeTab === "delivered" || activeTab === "archived") && (
          <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <View style={[styles.searchInputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.searchIcon, { color: colors.muted }]}>🔍</Text>
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder="Search by year, make, model or VIN…"
                placeholderTextColor={colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="never"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery("")}
                  style={styles.searchClearBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View style={[styles.searchClearCircle, { backgroundColor: colors.muted }]}>
                    <Text style={styles.searchClearX}>✕</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Action bar for Delivered / Archived tabs */}
        {activeTab === "delivered" && baseFilteredLoads.length > 0 && (
          <View style={[styles.tabActionBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Text style={[styles.tabActionCount, { color: colors.muted }]}>
              {baseFilteredLoads.length} delivered load{baseFilteredLoads.length !== 1 ? "s" : ""}
            </Text>
            <TouchableOpacity
              style={[styles.tabActionBtn, { backgroundColor: "#607D8B18" }]}
              activeOpacity={0.7}
              onPress={() => {
                Alert.alert(
                  "Archive All Delivered",
                  `Move ${baseFilteredLoads.length} delivered load${baseFilteredLoads.length !== 1 ? "s" : ""} to the Archived tab?`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Archive All",
                      onPress: () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        archiveAllDelivered();
                      },
                    },
                  ],
                );
              }}
            >
              <IconSymbol name="archivebox.fill" size={14} color="#607D8B" />
              <Text style={[styles.tabActionBtnText, { color: "#607D8B" }]}>Archive All</Text>
            </TouchableOpacity>
          </View>
        )}
        {activeTab === "archived" && baseFilteredLoads.length > 0 && (
          <View style={[styles.tabActionBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Text style={[styles.tabActionCount, { color: colors.muted }]}>
              {baseFilteredLoads.length} archived load{baseFilteredLoads.length !== 1 ? "s" : ""}
            </Text>
            <TouchableOpacity
              style={[styles.tabActionBtn, { backgroundColor: colors.error + "14" }]}
              activeOpacity={0.7}
              onPress={() => {
                Alert.alert(
                  "Clear All Archived",
                  `Permanently remove ${baseFilteredLoads.length} archived load${baseFilteredLoads.length !== 1 ? "s" : ""} from this device?\n\nThis only clears your local history — it does not affect the company platform.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Clear All",
                      style: "destructive",
                      onPress: () => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        clearAllArchived();
                      },
                    },
                  ],
                );
              }}
            >
              <IconSymbol name="trash.fill" size={14} color={colors.error} />
              <Text style={[styles.tabActionBtnText, { color: colors.error }]}>Clear All</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Active group indicator */}
        {groupMode !== "default" && (
          <View style={[styles.groupActiveBar, { backgroundColor: colors.primary + "10", borderBottomColor: colors.border }]}>
            <IconSymbol name="arrow.up.arrow.down" size={12} color={colors.primary} />
            <Text style={[styles.groupActiveLabel, { color: colors.primary }]}>
              Grouped by {groupMode === "pickup" ? "Pickup" : groupMode === "dropoff" ? "Drop-off" : "Company"}
            </Text>
            <TouchableOpacity
              onPress={() => { setGroupMode("default"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Text style={[styles.groupActiveClear, { color: colors.muted }]}>Clear ✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Swipe indicator dots — shows current tab position and hints at swipe navigation */}
        <View style={styles.swipeDots}>
          {TAB_ORDER.map((tab) => (
            <View
              key={tab}
              style={[
                styles.swipeDot,
                { backgroundColor: activeTab === tab ? colors.primary : colors.border },
                activeTab === tab && styles.swipeDotActive,
              ]}
            />
          ))}
        </View>
        {/* Vehicle Roster Sheet */}
        <Modal
          visible={vehicleRosterVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setVehicleRosterVisible(false)}
        >
          <TouchableOpacity
            style={styles.rosterOverlay}
            activeOpacity={1}
            onPress={() => setVehicleRosterVisible(false)}
          >
            <View
              style={[styles.rosterSheet, { backgroundColor: colors.background }]}
              onStartShouldSetResponder={() => true}
            >
              {/* Handle */}
              <View style={[styles.rosterHandle, { backgroundColor: colors.border }]} />
              {/* Header */}
              <View style={[styles.rosterHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.rosterTitle, { color: colors.foreground }]}>
                  Vehicles ({tabStats.totalVehicles})
                </Text>
                <TouchableOpacity onPress={() => setVehicleRosterVisible(false)}>
                  <Text style={[styles.rosterClose, { color: colors.primary }]}>Done</Text>
                </TouchableOpacity>
              </View>
              {/* Vehicle List */}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.rosterList}
                showsVerticalScrollIndicator={false}
              >
                {(tabStats.vehicleList ?? []).map((v, i) => (
                  <View
                    key={i}
                    style={[styles.rosterRow, { borderBottomColor: colors.border }]}
                  >
                    <Text style={[styles.rosterIndex, { color: colors.muted }]}>{i + 1}</Text>
                    <Text style={[styles.rosterVehicle, { color: colors.foreground }]} numberOfLines={1}>
                      {v.desc}
                    </Text>
                    {v.vin6 ? (
                      <Text style={[styles.rosterVin, { color: colors.muted, backgroundColor: colors.surface }]}>
                        {v.vin6}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
        {/* Locations Map Modal */}
        <LocationsMapModal
          visible={mapModal !== null}
          onClose={() => setMapModal(null)}
          pickupPins={tabStats.pickupPins ?? []}
          dropoffPins={tabStats.dropoffPins ?? []}
          initialMode={mapModal?.type ?? "pickup"}
        />
        {/* Sort / Group Picker Sheet */}
        <Modal visible={showSortSheet} transparent animationType="slide" onRequestClose={() => setShowSortSheet(false)}>
          <View style={styles.sortSheetWrapper}>
            <Pressable style={styles.sortSheetBackdrop} onPress={() => setShowSortSheet(false)} />
            <View style={[styles.sortSheetContainer, { backgroundColor: colors.surface }]}>
              <View style={[styles.sortSheetHandle, { backgroundColor: colors.border }]} />
              <Text style={[styles.sortSheetTitle, { color: colors.foreground }]}>Group Loads</Text>
              {([
                { key: "default" as const, label: "Newest First", icon: "clock.fill" as const, desc: "Default sort" },
                { key: "pickup" as const, label: "Pickup Location", icon: "arrow.up.circle.fill" as const, desc: "Group by pickup facility or city" },
                { key: "dropoff" as const, label: "Drop-off Location", icon: "arrow.down.circle.fill" as const, desc: "Group by delivery facility or city" },
                { key: "shipper" as const, label: "Company / Shipper", icon: "building.2.fill" as const, desc: "Group by dispatching company" },
              ]).map((opt) => {
                const active = groupMode === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.sortOption, active && { backgroundColor: colors.primary + "12" }]}
                    activeOpacity={0.7}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setGroupMode(opt.key);
                      setShowSortSheet(false);
                    }}
                  >
                    <View style={[styles.sortOptionIcon, { backgroundColor: active ? colors.primary + "20" : colors.border + "60" }]}>
                      <IconSymbol name={opt.icon} size={18} color={active ? colors.primary : colors.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sortOptionLabel, { color: active ? colors.primary : colors.foreground }]}>{opt.label}</Text>
                      <Text style={[styles.sortOptionDesc, { color: colors.muted }]}>{opt.desc}</Text>
                    </View>
                    {active && <IconSymbol name="checkmark.circle.fill" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Modal>
        {/* Offline / stale data banner */}
        {platformLoadError && !isLoadingPlatformLoads && (
          <View style={[styles.offlineBanner, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "44" }]}>
            <Text style={[styles.offlineBannerText, { color: colors.warning }]}>
              {lastSyncedAt
                ? `Offline — showing cached data from ${lastSyncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Unable to reach server — showing cached data"}
            </Text>
          </View>
        )}
        {/* Loads List — wrapped in swipe gesture handler */}
        <Animated.View
          style={{ flex: 1, transform: [{ translateX: slideAnim }] }}
          {...swipePanResponder.panHandlers}
        >
          <FlatList
            data={filteredLoads}
            keyExtractor={(item) => item.id}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            contentContainerStyle={[styles.listContent, { paddingBottom: 120 }]}
            renderItem={({ item, index }) => {
              const counts = queueCountsByLoad[item.id];
              let groupHeader: string | null = null;
              if (groupMode !== "default") {
                const key = groupKeyFn(item);
                const prevKey = index > 0 ? groupKeyFn(filteredLoads[index - 1]) : null;
                if (key !== prevKey) groupHeader = key;
              }
              return (
                <>
                  {groupHeader && (
                    <View style={[styles.groupHeader, { borderBottomColor: colors.border }]}>
                      <View style={[styles.groupDot, { backgroundColor: colors.primary }]} />
                      <Text style={[styles.groupLabel, { color: colors.foreground }]}>{groupHeader}</Text>
                      <Text style={[styles.groupCount, { color: colors.muted }]}>
                        {filteredLoads.filter((l) => groupKeyFn(l) === groupHeader).length}
                      </Text>
                    </View>
                  )}
                  <LoadCard
                    load={item}
                    onPress={() => handleLoadPress(item)}
                    onDelete={!item.id.startsWith("platform-") ? () => handleDeleteLoad(item) : undefined}
                    onArchive={item.status === "delivered" ? () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      archiveSingleLoad(item.id);
                    } : undefined}
                    pendingCount={counts?.pending ?? 0}
                    failedCount={counts?.failed ?? 0}
                  />
                </>
              );
            }}
            ListEmptyComponent={
              searchQuery.trim() && (activeTab === "delivered" || activeTab === "archived") ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyEmoji}>🔍</Text>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Results</Text>
                  <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                    No vehicles match "{searchQuery.trim()}"
                  </Text>
                </View>
              ) : (
                <EmptyState
                  tab={activeTab}
                  onAddLoad={handleAddLoad}
                  driverCode={displayDriverCode}
                  isLoading={activeTab === "new" && isLoadingPlatformLoads}
                />
              )
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        </Animated.View>
      </ScreenContainer>

      {/* One-time swipe hint overlay */}
      {showSwipeHint && (
        <Animated.View
          style={[
            styles.swipeHintOverlay,
            { opacity: hintAnim },
          ]}
          pointerEvents="none"
        >
          <View style={styles.swipeHintContent}>
            <Animated.Text
              style={[
                styles.swipeHintArrow,
                {
                  transform: [
                    {
                      translateX: hintArrowAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 28],
                      }),
                    },
                  ],
                },
              ]}
            >
              →
            </Animated.Text>
            <Text style={styles.swipeHintText}>Swipe to switch tabs</Text>
          </View>
        </Animated.View>
      )}

      {/* Status-change toast — shown after any load moves to a new tab */}
      {tabToastVisible && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tabToastContainer,
            { opacity: tabToastAnim, transform: [{ translateY: tabToastAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
          ]}
        >
          <View style={styles.tabToastContent}>
            <Text style={styles.tabToastText}>{tabToastMsg}</Text>
          </View>
        </Animated.View>
      )}

      {/* FAB — rendered outside ScreenContainer to float above tab bar */}
      <FAB onAddLoad={handleAddLoad} onScanVIN={handleScanVIN} />
    </View>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  offlineBannerText: {
    fontSize: 12,
    fontWeight: "600",
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerGreeting: {
    fontSize: 15,
    color: "rgba(255,255,255,0.85)",
    fontWeight: "500",
  },
  headerNameInline: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  headerDriverId: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "500",
  },
  companyBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: 160,
  },
  companyText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2.5,
    borderBottomColor: "transparent",
  },
  tabLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    flexDirection: "row",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  stripe: { width: 5 },
  cardContent: { flex: 1, padding: 14 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  loadNumber: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  orgBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 6,
  },
  orgBadgeText: { fontSize: 12, fontWeight: "700" },
  altDropBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
  },
  altDropBadgeText: { fontSize: 12, fontWeight: "600" },
  vehicleCount: { fontSize: 17, fontWeight: "700", marginBottom: 10 },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 6,
  },
  routePoint: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeCity: { fontSize: 13, fontWeight: "600", flex: 1 },
  routeLine: { width: 20, height: 1.5, borderRadius: 1 },
  datesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  dateText: { fontSize: 12 },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 1,
  },
  payAmount: { fontSize: 18, fontWeight: "700" },
  payType: { fontSize: 12 },
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderRadius: 14,
  },
  emptyAddBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  // FAB
  fabContainer: {
    position: "absolute",
    right: 20,
    alignItems: "flex-end",
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  fabOptionRow: {
    position: "absolute",
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  fabOptionLabel: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  fabOptionLabelText: {
    fontSize: 13,
    fontWeight: "700",
  },
  fabOption: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  platformBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  platformBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  driverCodePill: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 20,
    minWidth: 160,
  },
  driverCodeLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  driverCodeValue: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1,
  },
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  statTapHint: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    opacity: 0.5,
  },
  // ─── Vehicle Roster Sheet ───────────────────────────────────────────────────
  rosterOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  rosterSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: "60%",
    paddingBottom: 32,
  },
  rosterHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 6,
  },
  rosterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  rosterTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  rosterClose: {
    fontSize: 16,
    fontWeight: "600",
  },
  rosterList: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  rosterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  rosterIndex: {
    fontSize: 13,
    fontWeight: "600",
    width: 22,
    textAlign: "right",
  },
  rosterVehicle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  rosterVin: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  uploadBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  uploadBannerText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  deleteAction: {
    justifyContent: "center" as const,
    alignItems: "center" as const,
    width: 80,
    marginVertical: 6,
    marginRight: 16,
    borderRadius: 14,
  },
  swipeDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 6,
    gap: 6,
  },
  swipeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  swipeDotActive: {
    width: 18,
    borderRadius: 3,
  },
  swipeHintOverlay: {
    position: "absolute",
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: "center",
    pointerEvents: "none",
  },
  swipeHintContent: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 10,
  },
  swipeHintArrow: {
    fontSize: 22,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  swipeHintText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "500",
  },
  tabToastContainer: {
    position: "absolute",
    bottom: 110,
    left: 24,
    right: 24,
    alignItems: "center",
    pointerEvents: "none",
  },
  tabToastContent: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(10,30,50,0.88)",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 22,
    gap: 8,
  },
  tabToastText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  statLink: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: 40,
    padding: 0,
  },
  searchClearBtn: {
    padding: 2,
  },
  searchClearCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  searchClearX: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 12,
  },
  tabActionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  tabActionCount: {
    fontSize: 13,
    fontWeight: "500",
  },
  tabActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tabActionBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // Sort / Group
  sortBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sortActiveDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  sortSheetWrapper: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sortSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sortSheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 36,
    paddingHorizontal: 20,
  },
  sortSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 14,
  },
  sortSheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 16,
  },
  sortOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 4,
  },
  sortOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sortOptionLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  sortOptionDesc: {
    fontSize: 12,
    marginTop: 1,
  },
  // Group headers in load list
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 8,
    marginBottom: 2,
    borderBottomWidth: 1,
  },
  groupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  groupLabel: {
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  groupCount: {
    fontSize: 12,
    fontWeight: "600",
  },
  groupActiveBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
  },
  groupActiveLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  groupActiveClear: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },
});
