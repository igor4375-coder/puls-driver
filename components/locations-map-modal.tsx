import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  FlatList,
} from "react-native";
import MapView, { Marker, Callout, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

export interface MapPin {
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  /** Unique key linking a pickup pin to its matching dropoff pin for the same vehicle */
  vehicleKey?: string;
}

/** A location cluster: one map pin representing one or more vehicles at the same coordinates. */
interface LocationCluster {
  lat: number;
  lng: number;
  /** Display name for the location (company / city) */
  locationName: string;
  /** All vehicles at this location */
  vehicles: MapPin[];
}

interface LocationsMapModalProps {
  visible: boolean;
  onClose: () => void;
  /** Pickup pins — shown by default when initialMode is "pickup" */
  pickupPins: MapPin[];
  /** Dropoff pins — shown by default when initialMode is "dropoff" */
  dropoffPins: MapPin[];
  /** Which layer to show first */
  initialMode: "pickup" | "dropoff";
}

const PICKUP_COLOR = "#F59E0B";
const DROPOFF_COLOR = "#EF4444";
const HIGHLIGHT_COLOR = "#7C3AED"; // purple for selected cluster
const CLUSTER_RADIUS = 0.001; // ~100m — pins within this lat/lng delta are grouped

/** Compute a region that fits all pins with padding. */
function fitRegion(pins: { lat: number; lng: number }[]): Region {
  if (pins.length === 0) {
    return { latitude: 52.0, longitude: -100.0, latitudeDelta: 30, longitudeDelta: 30 };
  }
  if (pins.length === 1) {
    return {
      latitude: pins[0].lat,
      longitude: pins[0].lng,
      latitudeDelta: 0.5,
      longitudeDelta: 0.5,
    };
  }
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latDelta = (maxLat - minLat) * 1.5 + 0.5;
  const lngDelta = (maxLng - minLng) * 1.5 + 0.5;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(latDelta, 0.5),
    longitudeDelta: Math.max(lngDelta, 0.5),
  };
}

/**
 * Group a flat list of MapPins into LocationClusters.
 * Pins whose lat/lng are within CLUSTER_RADIUS of each other are merged.
 */
function buildClusters(pins: MapPin[]): LocationCluster[] {
  const clusters: LocationCluster[] = [];
  for (const pin of pins) {
    const existing = clusters.find(
      (c) =>
        Math.abs(c.lat - pin.lat) < CLUSTER_RADIUS &&
        Math.abs(c.lng - pin.lng) < CLUSTER_RADIUS
    );
    if (existing) {
      existing.vehicles.push(pin);
    } else {
      clusters.push({
        lat: pin.lat,
        lng: pin.lng,
        locationName: pin.sublabel ?? pin.label,
        vehicles: [pin],
      });
    }
  }
  return clusters;
}

export function LocationsMapModal({
  visible,
  onClose,
  pickupPins,
  dropoffPins,
  initialMode,
}: LocationsMapModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [mode, setMode] = useState<"pickup" | "dropoff">(initialMode);
  // Key of the selected cluster: "lat,lng" string — stable across re-renders
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setSelectedClusterKey(null);
    }
  }, [visible, initialMode]);

  const primaryPins = mode === "pickup" ? pickupPins : dropoffPins;
  const primaryColor = mode === "pickup" ? PICKUP_COLOR : DROPOFF_COLOR;
  const toggleLabel = mode === "pickup" ? "Show Drop-off Points" : "Show Pickup Points";
  const toggleDotColor = mode === "pickup" ? DROPOFF_COLOR : PICKUP_COLOR;
  const title = mode === "pickup" ? "Pickup Locations" : "Drop-off Locations";

  // Build clusters from the current mode's pins
  const clusters = useMemo(() => buildClusters(primaryPins), [primaryPins]);

  const clusterKey = (c: LocationCluster) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
  const selectedCluster = selectedClusterKey
    ? clusters.find((c) => clusterKey(c) === selectedClusterKey) ?? null
    : null;

  const fitMap = useCallback((pins: { lat: number; lng: number }[]) => {
    if (Platform.OS === "web" || !mapRef.current || pins.length === 0) return;
    mapRef.current.animateToRegion(fitRegion(pins), 400);
  }, []);

  useEffect(() => {
    if (visible) {
      setTimeout(() => fitMap(clusters), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, visible]);

  const handleToggleMode = () => {
    setSelectedClusterKey(null);
    setMode((m) => (m === "pickup" ? "dropoff" : "pickup"));
  };

  const handleSelectCluster = (cluster: LocationCluster) => {
    const key = clusterKey(cluster);
    setSelectedClusterKey((prev) => (prev === key ? null : key));
  };

  const totalVehicles = primaryPins.length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === "ios" ? 12 : insets.top + 8,
            },
          ]}
        >
          <View style={styles.headerLeft}>
            <View style={[styles.pinDot, { backgroundColor: primaryColor }]} />
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <IconSymbol name="xmark" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Toggle row */}
        <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.toggleBtn, { borderColor: toggleDotColor }]}
            onPress={handleToggleMode}
            activeOpacity={0.75}
          >
            <View style={[styles.toggleDot, { backgroundColor: toggleDotColor }]} />
            <Text style={[styles.toggleBtnText, { color: toggleDotColor }]}>{toggleLabel}</Text>
          </TouchableOpacity>
          {selectedCluster && (
            <TouchableOpacity
              style={[styles.clearBtn, { borderColor: colors.border }]}
              onPress={() => setSelectedClusterKey(null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.clearBtnText, { color: colors.muted }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Map */}
        <View style={styles.mapContainer}>
          {Platform.OS === "web" ? (
            <View style={[styles.webFallback, { backgroundColor: colors.surface }]}>
              <IconSymbol name="map" size={40} color={colors.muted} />
              <Text style={[styles.webFallbackText, { color: colors.muted }]}>
                Map view is available on iOS and Android
              </Text>
              {clusters.map((c, i) => (
                <Text key={i} style={[styles.webPin, { color: colors.foreground }]}>
                  📍 {c.locationName} — {c.vehicles.length} vehicle{c.vehicles.length !== 1 ? "s" : ""}
                </Text>
              ))}
            </View>
          ) : clusters.length === 0 ? (
            <View style={[styles.webFallback, { backgroundColor: colors.surface }]}>
              <IconSymbol name="map" size={40} color={colors.muted} />
              <Text style={[styles.webFallbackText, { color: colors.muted }]}>
                Resolving locations…
              </Text>
              <Text style={[styles.webFallbackText, { color: colors.muted, fontSize: 12 }]}>
                Addresses are being geocoded. Pull to refresh in a moment.
              </Text>
            </View>
          ) : (
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={fitRegion(clusters)}
              showsUserLocation
              showsCompass
              showsScale
            >
              {clusters.map((cluster, idx) => {
                const isSelected = clusterKey(cluster) === selectedClusterKey;
                const count = cluster.vehicles.length;
                const bgColor = isSelected ? HIGHLIGHT_COLOR : primaryColor;
                return (
                  <Marker
                    key={`cluster-${idx}`}
                    coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
                    tracksViewChanges={false}
                    onPress={() => handleSelectCluster(cluster)}
                  >
                    {/* Custom marker: circle with vehicle count badge */}
                    <View style={[styles.markerWrap]}>
                      <View style={[styles.markerBubble, { backgroundColor: bgColor }]}>
                        <Text style={styles.markerCount}>{count}</Text>
                      </View>
                      <View style={[styles.markerTail, { borderTopColor: bgColor }]} />
                    </View>
                    {/* Empty Callout prevents the default iOS callout from
                        intercepting the tap and blocking onPress propagation */}
                    <Callout tooltip>
                      <View />
                    </Callout>
                  </Marker>
                );
              })}
            </MapView>
          )}
        </View>

        {/* Bottom panel: location list OR expanded vehicle list for selected cluster */}
        <View
          style={[
            styles.pinList,
            { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 },
          ]}
        >
          {selectedCluster ? (
            /* ── Expanded: all vehicles at the selected location ── */
            <>
              <View style={styles.clusterHeader}>
                <View style={styles.clusterHeaderLeft}>
                  <View style={[styles.pinBullet, { backgroundColor: HIGHLIGHT_COLOR }]}>
                    <Text style={styles.pinBulletText}>{selectedCluster.vehicles.length}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.clusterTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {selectedCluster.locationName}
                    </Text>
                    <Text style={[styles.clusterSubtitle, { color: colors.muted }]}>
                      {selectedCluster.vehicles.length} vehicle{selectedCluster.vehicles.length !== 1 ? "s" : ""} at this location
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedClusterKey(null)}
                  style={[styles.collapseBtn, { borderColor: colors.border }]}
                  activeOpacity={0.7}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <IconSymbol name="chevron.down" size={14} color={colors.muted} />
                </TouchableOpacity>
              </View>
              <FlatList
                data={selectedCluster.vehicles}
                keyExtractor={(item, i) => item.vehicleKey ?? `v-${i}`}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                style={styles.vehicleScroll}
                showsVerticalScrollIndicator={false}
                renderItem={({ item, index }) => (
                  <View
                    style={[
                      styles.vehicleRow,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={[styles.vehicleIndex, { backgroundColor: primaryColor + "22" }]}>
                      <Text style={[styles.vehicleIndexText, { color: primaryColor }]}>{index + 1}</Text>
                    </View>
                    <View style={styles.vehicleInfo}>
                      <Text style={[styles.vehicleLabel, { color: colors.foreground }]}>{item.label}</Text>
                    </View>
                  </View>
                )}
              />
            </>
          ) : (
            /* ── Default: list of all location clusters ── */
            <>
              <Text style={[styles.pinListTitle, { color: colors.muted }]}>
                {clusters.length} {clusters.length === 1 ? "Location" : "Locations"}
                {"  ·  "}{totalVehicles} vehicle{totalVehicles !== 1 ? "s" : ""}
                {"  ·  TAP TO SEE VEHICLES"}
              </Text>
              <ScrollView style={styles.pinScroll} showsVerticalScrollIndicator={false}>
                {clusters.map((cluster, idx) => {
                  const count = cluster.vehicles.length;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.pinRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleSelectCluster(cluster)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.pinBullet, { backgroundColor: primaryColor }]}>
                        <Text style={styles.pinBulletText}>{count}</Text>
                      </View>
                      <View style={styles.pinInfo}>
                        <Text style={[styles.pinLabel, { color: colors.foreground }]}>{cluster.locationName}</Text>
                        <Text style={[styles.pinSublabel, { color: colors.muted }]}>
                          {count} vehicle{count !== 1 ? "s" : ""} — tap to expand
                        </Text>
                      </View>
                      <IconSymbol name="chevron.right" size={14} color={colors.muted} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  pinDot: { width: 12, height: 12, borderRadius: 6 },
  headerTitle: { fontSize: 17, fontWeight: "700", letterSpacing: 0.2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  toggleDot: { width: 8, height: 8, borderRadius: 4 },
  toggleBtnText: { fontSize: 13, fontWeight: "600" },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  clearBtnText: { fontSize: 13 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  webFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  webFallbackText: { fontSize: 14, textAlign: "center" },
  webPin: { fontSize: 14, textAlign: "center" },
  pinList: {
    borderTopWidth: 0.5,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxHeight: 260,
  },
  pinScroll: { flex: 1 },
  pinListTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderRadius: 6,
  },
  pinBullet: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  pinBulletText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  pinInfo: { flex: 1 },
  pinLabel: { fontSize: 14, fontWeight: "600" },
  pinSublabel: { fontSize: 12, marginTop: 2 },
  // Cluster expanded view
  clusterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
  },
  clusterHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  clusterTitle: { fontSize: 14, fontWeight: "700" },
  clusterSubtitle: { fontSize: 12, marginTop: 1 },
  collapseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleScroll: { flex: 1 },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
  },
  vehicleIndex: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleIndexText: { fontSize: 12, fontWeight: "700" },
  vehicleInfo: { flex: 1 },
  vehicleLabel: { fontSize: 14, fontWeight: "500" },
  // Custom map marker styles
  markerWrap: { alignItems: "center" },
  markerBubble: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  markerCount: { color: "#fff", fontSize: 14, fontWeight: "800" },
  markerTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
});
