import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MOCK_LOADS, type Load, type LoadStatus, type VehicleInspection } from "./data";

// ─── Persistence key ──────────────────────────────────────────────────────────

const LOADS_STORAGE_KEY = "autohaul_loads_v2";
const PLATFORM_LOADS_KEY = "autohaul_platform_loads_v7"; // bumped: platform is now source of truth for status — stale delivered/picked_up cache cleared

// Persists load IDs that the driver has marked as delivered.
// These loads MUST stay in the Delivered tab even if the platform
// changes their status or removes them from the
// driver's assignment list (reassigned to next leg driver).
const DRIVER_DELIVERED_KEY = "@autohaul:driver_delivered_loads_v1";
// Stores full Load snapshots for loads the driver delivered that
// the platform may have removed from the driver's assignments.
const DRIVER_DELIVERED_SNAPSHOTS_KEY = "@autohaul:driver_delivered_snapshots_v1";

// ─── Helper: convert company platform load → driver app Load ─────────────────

export interface PlatformLoad {
  legId: number;
  tripId?: number; // legacy field, may not be present
  loadNumber: string;
  vehicleCount: number;
  pickupLocation: {
    name: string;
    address: string;
    city: string;
    province: string;
    phone?: string;
    contactName?: string;
  };
  deliveryLocation: {
    name: string;
    address: string;
    city: string;
    province: string;
    phone?: string;
    contactName?: string;
  };
  pickupDate: string | number | null;
  deliveryDate: string | number | null;
  rate: string;
  vehicle: {
    vin: string;
    year: number | null;
    make: string | null;
    model: string | null;
    description: string;
    /** Vehicle condition fields set by dispatcher on the platform */
    hasKeys?: boolean | null;
    starts?: boolean | null;
    drives?: boolean | null;
  } | null;
  status: "pending" | "assigned" | "picked_up" | "delivered" | "cancelled";
  /** URL to the gate pass file attached by the dispatcher, if any */
  gatePassUrl?: string | null;
  /** ISO 8601 date string for storage expiry / gate pass expiry */
  storageExpiryDate?: string | null;
}

/**
 * Robustly parse a date value from the company platform.
 * Handles: ISO strings, Unix timestamps (ms), Unix timestamps (s), null/undefined.
 * Returns an ISO string or empty string if unparseable.
 */
function parsePlatformDate(raw: string | number | null | undefined): string {
  if (!raw) return "";
  // Numeric: could be seconds or milliseconds since epoch
  if (typeof raw === "number") {
    // Heuristic: if > 1e10 it's milliseconds, otherwise seconds
    const ms = raw > 1e10 ? raw : raw * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  // String: try direct parse
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  return "";
}

function platformLoadToLoad(pl: PlatformLoad): Load {
  // Debug: log raw platform location data to help diagnose geocoding issues
  console.log(`[Platform] Load ${pl.loadNumber} deliveryLocation:`, JSON.stringify(pl.deliveryLocation));
  // Map company platform status → driver app status
  const statusMap: Record<string, LoadStatus> = {
    pending: "new",
    assigned: "new",   // company platform uses "assigned" for newly assigned loads
    picked_up: "picked_up",
    delivered: "delivered",
    cancelled: "archived",
  };

  // Vehicle — guard against null vehicle or null fields
  const v = pl.vehicle;
  const vehicleVin = v?.vin ?? "";
  const vehicleDesc = v?.description ?? "";

  // The platform sometimes stores year/make/model as null but puts the full
  // vehicle name in `description` (e.g. "2021 Toyota Camry").
  // Parse description as fallback when structured fields are missing.
  let vehicleYear = v?.year != null ? String(v.year) : "";
  let vehicleMake = v?.make ?? "";
  let vehicleModel = v?.model ?? "";

  if ((!vehicleYear || !vehicleMake || !vehicleModel) && vehicleDesc) {
    // Try to parse "YYYY Make Model" from description
    const descMatch = vehicleDesc.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (descMatch) {
      if (!vehicleYear) vehicleYear = descMatch[1];
      if (!vehicleMake) vehicleMake = descMatch[2];
      if (!vehicleModel) vehicleModel = descMatch[3].trim();
    }
  }

  // Build a human-readable vehicle name (e.g. "2021 Toyota Camry")
  const vehicleParts = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean);
  // Use description directly if structured fields still can't form a name
  const vehicleDisplayName =
    vehicleParts.length > 0
      ? vehicleParts.join(" ")
      : vehicleDesc || "Unknown Vehicle";

  return {
    // Use "platform-{legId}" as the local ID so we can distinguish platform loads
    // legId is the per-leg unique identifier from the company platform
    id: `platform-${pl.legId ?? pl.tripId}`,  // legId is the correct field; tripId is legacy fallback
    loadNumber: pl.loadNumber,
    status: statusMap[pl.status] ?? "new",
    vehicles: [
      {
        id: `platform-${pl.tripId}-v1`,
        year: vehicleYear,
        make: vehicleMake,
        model: vehicleModel,
        color: "",
        vin: vehicleVin,
        bodyType: vehicleDesc,
        // Store display name for easy rendering
        displayName: vehicleDisplayName,
        // Vehicle condition fields from the platform (null = not set by dispatcher)
        hasKeys: v?.hasKeys ?? null,
        starts: v?.starts ?? null,
        drives: v?.drives ?? null,
      } as any,
    ],
    pickup: {
      contact: {
        name: pl.pickupLocation.contactName ?? (pl.pickupLocation as any).contact ?? pl.pickupLocation.name,
        company: pl.pickupLocation.name,
        // Try all possible phone field name variants the platform might send
        phone: pl.pickupLocation.phone
          ?? (pl.pickupLocation as any).phoneNumber
          ?? (pl.pickupLocation as any).phone_number
          ?? (pl.pickupLocation as any).contactPhone
          ?? "",
        email: (pl.pickupLocation as any).email ?? "",
        address: pl.pickupLocation.address
          ?? (pl.pickupLocation as any).street
          ?? (pl.pickupLocation as any).streetAddress
          ?? "",
        city: pl.pickupLocation.city
          ?? (pl.pickupLocation as any).town
          ?? (pl.pickupLocation as any).municipality
          ?? "",
        // Try all possible province/state field name variants
        state: pl.pickupLocation.province
          ?? (pl.pickupLocation as any).state
          ?? (pl.pickupLocation as any).region
          ?? (pl.pickupLocation as any).stateProvince
          ?? "",
        zip: (pl.pickupLocation as any).zip
          ?? (pl.pickupLocation as any).postalCode
          ?? (pl.pickupLocation as any).postal_code
          ?? "",
      },
      date: parsePlatformDate(pl.pickupDate),
      lat: 0,
      lng: 0,
    },
    delivery: {
      contact: {
        name: pl.deliveryLocation.contactName ?? (pl.deliveryLocation as any).contact ?? pl.deliveryLocation.name,
        company: pl.deliveryLocation.name,
        // Try all possible phone field name variants the platform might send
        phone: pl.deliveryLocation.phone
          ?? (pl.deliveryLocation as any).phoneNumber
          ?? (pl.deliveryLocation as any).phone_number
          ?? (pl.deliveryLocation as any).contactPhone
          ?? "",
        email: (pl.deliveryLocation as any).email ?? "",
        address: pl.deliveryLocation.address
          ?? (pl.deliveryLocation as any).street
          ?? (pl.deliveryLocation as any).streetAddress
          ?? "",
        city: pl.deliveryLocation.city
          ?? (pl.deliveryLocation as any).town
          ?? (pl.deliveryLocation as any).municipality
          ?? "",
        // Try all possible province/state field name variants
        state: pl.deliveryLocation.province
          ?? (pl.deliveryLocation as any).state
          ?? (pl.deliveryLocation as any).region
          ?? (pl.deliveryLocation as any).stateProvince
          ?? "",
        zip: (pl.deliveryLocation as any).zip
          ?? (pl.deliveryLocation as any).postalCode
          ?? (pl.deliveryLocation as any).postal_code
          ?? "",
      },
      date: parsePlatformDate(pl.deliveryDate),
      lat: 0,
      lng: 0,
    },
    driverPay: parseFloat(pl.rate) || 0,
    paymentType: "cod",
    notes: "",
    assignedAt: parsePlatformDate(pl.pickupDate),
    // Mark as platform-sourced for UI differentiation
    platformTripId: pl.legId ?? pl.tripId ?? 0,
    // Gate pass data from the platform
    gatePassUrl: pl.gatePassUrl ?? null,
    gatePassExpiresAt: pl.storageExpiryDate ? parsePlatformDate(pl.storageExpiryDate) || pl.storageExpiryDate : null,
    storageExpiryDate: pl.storageExpiryDate ? parsePlatformDate(pl.storageExpiryDate) || pl.storageExpiryDate : null,
  } as Load & { platformTripId: number };
}

// ─── Context types ────────────────────────────────────────────────────────────

interface LoadsContextType {
  loads: Load[];
  isLoadingPlatformLoads: boolean;
  platformLoadError: string | null;
  getLoad: (id: string) => Load | undefined;
  updateLoadStatus: (loadId: string, status: LoadStatus) => void;
  savePickupInspection: (loadId: string, vehicleId: string, inspection: VehicleInspection) => void;
  saveDeliveryInspection: (loadId: string, vehicleId: string, inspection: VehicleInspection) => void;
  updateVehicleInfo: (
    loadId: string,
    vehicleId: string,
    info: Partial<Pick<import("./data").Vehicle, "vin" | "year" | "make" | "model">>
  ) => void;
  addLoad: (load: Load) => void;
  refreshPlatformLoads: () => void;
  revertVehicleToPickupPending: (loadId: string, vehicleId: string) => void;
  /** Move all delivered loads to "archived" status immediately. */
  archiveAllDelivered: () => void;

  /**
   * Delete a non-platform load (id does NOT start with "platform-").
   * Silently ignores platform loads to prevent accidental deletion.
   */
  deleteLoad: (loadId: string) => void;
  /**
   * Remove all non-platform loads (demo/mock/manually-added).
   * Useful for clearing test data before a real session.
   */
  clearNonPlatformLoads: () => void;
}

const LoadsContext = createContext<LoadsContextType | null>(null);

// ─── Geocoding helper ────────────────────────────────────────────────────────
// Uses OpenStreetMap Nominatim (free, no API key required)
// Tries progressively simpler queries as fallbacks to maximise hit rate
//
// NOTE: AbortSignal.timeout() is NOT available in React Native's JS runtime.
// We use a manual setTimeout + AbortController instead.
async function geocodeAddress(address: string, city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  // Build a list of queries from most specific to least specific
  const queries: string[] = [];
  const full = [address, city, state].filter(Boolean).join(", ");
  if (full) queries.push(full);
  // Fallback 1: city + state only (handles cases where street address is unusual)
  const cityState = [city, state].filter(Boolean).join(", ");
  if (cityState && cityState !== full) queries.push(cityState);
  // Fallback 2: city only
  if (city && city !== cityState) queries.push(city);

  for (const q of queries) {
    // Create a manual timeout abort controller — AbortSignal.timeout() is not
    // available in React Native's Hermes/JSC runtime.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const encoded = encodeURIComponent(q);
      console.log(`[Geocode] Trying: "${q}"`);
      // Include countrycodes=ca,us to bias results toward North America and
      // prevent Nominatim from returning wrong-country matches (e.g. a US city
      // when the address is in Canada).
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&addressdetails=0&countrycodes=ca,us`,
        {
          headers: { "User-Agent": "AutoHaulDriverApp/1.0" },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (!res.ok) {
        console.warn(`[Geocode] HTTP ${res.status} for "${q}"`);
        continue;
      }
      const json = await res.json();
      if (json && json.length > 0) {
        const lat = parseFloat(json[0].lat);
        const lng = parseFloat(json[0].lon);
        if (!isNaN(lat) && !isNaN(lng)) {
          console.log(`[Geocode] ✓ "${q}" → ${lat}, ${lng}`);
          return { lat, lng };
        }
      } else {
        console.warn(`[Geocode] No results for "${q}"`);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.warn(`[Geocode] Error for "${q}": ${err?.message ?? err}`);
    }
  }
  console.warn(`[Geocode] All queries failed for address="${address}" city="${city}" state="${state}"`);
  return null;
}

// Geocode cache key in AsyncStorage
// v2: bumped after fixing AbortSignal.timeout bug — forces re-geocode of all addresses
// that previously failed silently due to the unsupported API in React Native.
const GEO_CACHE_KEY = "@autohaul:geocache_v2";

// ─── Provider ─────────────────────────────────────────────────────────────────

export function LoadsProvider({
  children,
  driverCode,
}: {
  children: React.ReactNode;
  driverCode?: string | null;
}) {
  // Local loads: use mock data only in demo mode (no real driverCode)
  // When a real driver is authenticated, start with empty local loads
  const isDemoMode = !driverCode || driverCode === "D-00001";
  const [localLoads, setLocalLoads] = useState<Load[]>(isDemoMode ? MOCK_LOADS : []);
  // Platform loads fetched from company platform
  const [platformLoads, setPlatformLoads] = useState<Load[]>([]);
  const [isLoadingPlatformLoads, setIsLoadingPlatformLoads] = useState(false);
  const [platformLoadError, setPlatformLoadError] = useState<string | null>(null);

  // ── Driver-delivered tracking ─────────────────────────────────────────────
  // Set of load IDs that the driver explicitly marked as delivered.
  // These survive platform sync so the load stays in the Delivered tab.
  const driverDeliveredRef = React.useRef<Set<string>>(new Set());
  // Full Load snapshots for delivered loads that the platform may have
  // removed from the driver's assignment list (e.g. reassigned to next leg).
  const [deliveredSnapshots, setDeliveredSnapshots] = useState<Load[]>([]);

  // Load persisted driver-delivered IDs and snapshots on startup
  useEffect(() => {
    AsyncStorage.getItem(DRIVER_DELIVERED_KEY).then((val) => {
      if (val) {
        try {
          const ids = JSON.parse(val) as string[];
          driverDeliveredRef.current = new Set(ids);
        } catch { /* ignore */ }
      }
    });
    AsyncStorage.getItem(DRIVER_DELIVERED_SNAPSHOTS_KEY).then((val) => {
      if (val) {
        try {
          setDeliveredSnapshots(JSON.parse(val) as Load[]);
        } catch { /* ignore */ }
      }
    });
  }, []);

  // Helper: mark a load as driver-delivered and snapshot it
  const markDriverDelivered = React.useCallback((loadId: string, load: Load) => {
    driverDeliveredRef.current.add(loadId);
    AsyncStorage.setItem(
      DRIVER_DELIVERED_KEY,
      JSON.stringify([...driverDeliveredRef.current])
    ).catch(() => {});
    // Save a snapshot so we can show it even if the platform drops the load
    setDeliveredSnapshots((prev) => {
      const exists = prev.some((l) => l.id === loadId);
      const updated = exists
        ? prev.map((l) => (l.id === loadId ? { ...load, status: "delivered" as LoadStatus } : l))
        : [...prev, { ...load, status: "delivered" as LoadStatus }];
      AsyncStorage.setItem(DRIVER_DELIVERED_SNAPSHOTS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);
  // Geocode cache: address string -> {lat, lng}
  const geocacheRef = React.useRef<Record<string, { lat: number; lng: number }>>({});
  const geocacheLoadedRef = React.useRef(false);

  // Convex action to fetch loads from the company platform
  const fetchAssignedLoads = useAction(api.platform.getAssignedLoads);
  const isFetchingRef = React.useRef(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Load geocode cache from AsyncStorage on first mount
  // This MUST run before the startup geocoding effect so cached coords are available
  const [geocacheReady, setGeocacheReady] = React.useState(false);
  useEffect(() => {
    AsyncStorage.getItem(GEO_CACHE_KEY).then((val) => {
      if (val) {
        try {
          const parsed = JSON.parse(val) as Record<string, { lat: number; lng: number }>;
          const cleaned: Record<string, { lat: number; lng: number }> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (v.lat && v.lng && !isNaN(v.lat) && !isNaN(v.lng)) {
              cleaned[k] = v;
            }
          }
          geocacheRef.current = cleaned;
        } catch { /* ignore */ }
      }
      geocacheLoadedRef.current = true;
      setGeocacheReady(true);
    });
  }, []);

  // Geocode all platform loads that still have lat=0/lng=0
  const geocodePlatformLoads = React.useCallback(async (loads: Load[]) => {
    let changed = false;
    const updated = await Promise.all(
      loads.map(async (load) => {
        let pickupLat = load.pickup.lat;
        let pickupLng = load.pickup.lng;
        let deliveryLat = load.delivery.lat;
        let deliveryLng = load.delivery.lng;

        // Geocode pickup if missing
        if (!pickupLat || !pickupLng) {
          const c = load.pickup.contact;
          const key = [c.address, c.city, c.state].filter(Boolean).join("|");
          if (key && key !== "||") {
            if (geocacheRef.current[key]) {
              pickupLat = geocacheRef.current[key].lat;
              pickupLng = geocacheRef.current[key].lng;
            } else {
              const coords = await geocodeAddress(c.address ?? "", c.city ?? "", c.state ?? "");
              if (coords) {
                pickupLat = coords.lat;
                pickupLng = coords.lng;
                geocacheRef.current[key] = coords;
                changed = true;
              }
            }
          }
        }

        // Geocode delivery if missing
        if (!deliveryLat || !deliveryLng) {
          const c = load.delivery.contact;
          console.log(`[Geocode] Delivery contact for ${load.loadNumber}:`, JSON.stringify({ address: c.address, city: c.city, state: c.state }));
          const key = [c.address, c.city, c.state].filter(Boolean).join("|");
          if (key && key !== "||") {
            if (geocacheRef.current[key]) {
              console.log(`[Geocode] Delivery cache hit for ${load.loadNumber}: ${key}`);
              deliveryLat = geocacheRef.current[key].lat;
              deliveryLng = geocacheRef.current[key].lng;
            } else {
              const coords = await geocodeAddress(c.address ?? "", c.city ?? "", c.state ?? "");
              if (coords) {
                deliveryLat = coords.lat;
                deliveryLng = coords.lng;
                geocacheRef.current[key] = coords;
                changed = true;
              }
            }
          } else {
            console.warn(`[Geocode] Delivery address empty for ${load.loadNumber} — skipping`);
          }
        }

        if (pickupLat !== load.pickup.lat || pickupLng !== load.pickup.lng ||
            deliveryLat !== load.delivery.lat || deliveryLng !== load.delivery.lng) {
          return {
            ...load,
            pickup: { ...load.pickup, lat: pickupLat, lng: pickupLng },
            delivery: { ...load.delivery, lat: deliveryLat, lng: deliveryLng },
          };
        }
        return load;
      })
    );
    if (changed) {
      AsyncStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geocacheRef.current)).catch(() => {});
    }
    return updated;
  }, []);

  // Fetch platform loads via Convex action and geocode them.
  // Platform is always source of truth for status.
  const doFetchLoads = React.useCallback(async () => {
    if (!driverCode || driverCode.length < 7 || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoadingPlatformLoads(true);
    setPlatformLoadError(null);
    try {
      const rawLoads = await fetchAssignedLoads({ driverCode });
      const converted = (rawLoads as PlatformLoad[]).map(platformLoadToLoad);
      const geocoded = await geocodePlatformLoads(converted);
      setPlatformLoads(geocoded);
      AsyncStorage.setItem(PLATFORM_LOADS_KEY, JSON.stringify(geocoded)).catch(() => {});
    } catch (err: any) {
      setPlatformLoadError(err?.message ?? "Failed to fetch platform loads");
    } finally {
      setIsLoadingPlatformLoads(false);
      isFetchingRef.current = false;
    }
  }, [driverCode, fetchAssignedLoads, geocodePlatformLoads]);

  // Poll every 30s while the app is open
  useEffect(() => {
    if (!driverCode || driverCode.length < 7) return;
    doFetchLoads();
    pollRef.current = setInterval(doFetchLoads, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [driverCode, doFetchLoads]);

  // Load persisted platform loads on startup (before API responds)
  // Wait for geocache to be loaded from AsyncStorage first (geocacheReady)
  // so we can use cached coordinates instead of re-fetching from Nominatim
  useEffect(() => {
    if (!geocacheReady) return; // wait for geocache to load first
    AsyncStorage.getItem(PLATFORM_LOADS_KEY).then(async (val) => {
      if (val) {
        try {
          const cached = JSON.parse(val) as Load[];
          // Apply geocoding to any loads missing coordinates
          const needsGeo = cached.some(
            (l) => (!l.pickup.lat || !l.pickup.lng) || (!l.delivery.lat || !l.delivery.lng)
          );
          if (needsGeo) {
            const geocoded = await geocodePlatformLoads(cached);
            setPlatformLoads(geocoded);
            AsyncStorage.setItem(PLATFORM_LOADS_KEY, JSON.stringify(geocoded)).catch(() => {});
          } else {
            setPlatformLoads(cached);
          }
        } catch {
          // ignore
        }
      }
    });
  // geocacheReady is the trigger; geocodePlatformLoads is stable (useCallback)
  }, [geocacheReady, geocodePlatformLoads]);

  // Merge: platform loads first (they're "assigned"), then local loads,
  // then any delivered snapshots the platform may have dropped.
  // De-duplicate by load ID to avoid showing same load twice.
  // Force "delivered" status on any load the driver has marked as delivered.
  const loads = React.useMemo(() => {
    const seen = new Set<string>();
    const result: Load[] = [];

    // 1. Platform loads — override status if driver delivered them
    for (const l of platformLoads) {
      seen.add(l.id);
      if (driverDeliveredRef.current.has(l.id)) {
        result.push({ ...l, status: "delivered" as LoadStatus });
      } else {
        result.push(l);
      }
    }

    // 2. Local loads (demo / manually created)
    for (const l of localLoads) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        if (driverDeliveredRef.current.has(l.id)) {
          result.push({ ...l, status: "delivered" as LoadStatus });
        } else {
          result.push(l);
        }
      }
    }

    // 3. Delivered snapshots — loads the platform removed from the driver's
    //    assignment list after the driver delivered them (e.g. reassigned to
    //    next leg). These MUST still appear in the Delivered tab.
    for (const l of deliveredSnapshots) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        result.push({ ...l, status: "delivered" as LoadStatus });
      }
    }

    return result;
  }, [platformLoads, localLoads, deliveredSnapshots]);

  const getLoad = useCallback(
    (id: string) => loads.find((l) => l.id === id),
    [loads]
  );

  const updateLoadStatus = useCallback((loadId: string, status: LoadStatus) => {
    // When the driver marks a load as delivered, persist that decision locally
    // so it survives platform sync (which may drop the load).
    if (status === "delivered") {
      // Find the current load to snapshot it (with deliveredAt timestamp)
      const currentLoad = [...platformLoads, ...localLoads].find((l) => l.id === loadId);
      const deliveredAt = new Date().toISOString();
      if (currentLoad) {
        markDriverDelivered(loadId, { ...currentLoad, deliveredAt });
      }
      // Stamp deliveredAt on the load in both arrays
      const stampFn = (prev: Load[]) =>
        prev.map((l) => (l.id === loadId ? { ...l, deliveredAt } : l));
      setLocalLoads(stampFn);
      setPlatformLoads((prev) => {
        const updated = stampFn(prev);
        AsyncStorage.setItem(PLATFORM_LOADS_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    }

    // Update in both local and platform arrays (skip if we already stamped above for delivered)
    if (status !== "delivered") {
      setLocalLoads((prev) =>
        prev.map((l) => (l.id === loadId ? { ...l, status } : l))
      );
      setPlatformLoads((prev) => {
        const updated = prev.map((l) => (l.id === loadId ? { ...l, status } : l));
        // Keep cache in sync so the optimistic update survives until the next API poll
        // (the next API response will overwrite this with the authoritative platform status)
        AsyncStorage.setItem(PLATFORM_LOADS_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    }
  }, [platformLoads, localLoads, markDriverDelivered]);

  const savePickupInspection = useCallback(
    (loadId: string, vehicleId: string, inspection: VehicleInspection) => {
      // NOTE: Saving an inspection does NOT change the load status.
      // The driver must manually tap "Mark as Picked Up" after reviewing trip details.
      const updateFn = (prev: Load[]) =>
        prev.map((l) => {
          if (l.id !== loadId) return l;
          return {
            ...l,
            vehicles: l.vehicles.map((v) =>
              v.id === vehicleId ? { ...v, pickupInspection: inspection } : v
            ),
          };
        });
      setLocalLoads(updateFn);
      setPlatformLoads(updateFn);
    },
    []
  );

  const saveDeliveryInspection = useCallback(
    (loadId: string, vehicleId: string, inspection: VehicleInspection) => {
      // NOTE: Saving a delivery inspection does NOT change the load status.
      // The driver must manually tap "Mark as Delivered" after reviewing trip details.
      const updateFn = (prev: Load[]) =>
        prev.map((l) => {
          if (l.id !== loadId) return l;
          return {
            ...l,
            vehicles: l.vehicles.map((v) =>
              v.id === vehicleId ? { ...v, deliveryInspection: inspection } : v
            ),
          };
        });
      setLocalLoads(updateFn);
      setPlatformLoads(updateFn);
    },
    []
  );

  const updateVehicleInfo = useCallback(
    (
      loadId: string,
      vehicleId: string,
      info: Partial<Pick<import("./data").Vehicle, "vin" | "year" | "make" | "model">>
    ) => {
      const updateFn = (prev: Load[]) =>
        prev.map((l) => {
          if (l.id !== loadId) return l;
          return {
            ...l,
            vehicles: l.vehicles.map((v) =>
              v.id === vehicleId ? { ...v, ...info } : v
            ),
          };
        });
      setLocalLoads(updateFn);
      setPlatformLoads(updateFn);
    },
    []
  );

  const addLoad = useCallback((load: Load) => {
    setLocalLoads((prev) => [load, ...prev]);
  }, []);

  // Revert a vehicle back to pending — keeps inspection data (photos, damages) intact
  // Also reverts load status to 'new' so it appears in the Pending tab
  const revertVehicleToPickupPending = useCallback(
    (loadId: string, vehicleId: string) => {
      // Set pickupStatus to 'pending' — does NOT clear inspection data so photos/damages are preserved
      // Always revert load status to 'new' so the load moves back to the Pending tab
      const updateFn = (prev: Load[]) =>
        prev.map((l) => {
          if (l.id !== loadId) return l;
          return {
            ...l,
            status: "new" as const,
            vehicles: l.vehicles.map((v) =>
              v.id === vehicleId ? { ...v, pickupStatus: "pending" as const } : v
            ),
          };
        });
      setLocalLoads(updateFn);
      setPlatformLoads(updateFn);
    },
    []
  );

  const refreshPlatformLoads = useCallback(() => {
    doFetchLoads();
  }, [doFetchLoads]);

  // ── Auto-archive: move delivered loads older than 30 days to "archived" ──────
  // Runs once on startup after deliveredSnapshots are loaded.
  const autoArchiveRan = React.useRef(false);
  useEffect(() => {
    if (autoArchiveRan.current) return;
    // Wait until snapshots are loaded (non-empty or geocacheReady ensures startup is done)
    if (!geocacheReady) return;
    autoArchiveRan.current = true;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const archiveFn = (prev: Load[]) =>
      prev.map((l) => {
        if (l.status !== "delivered") return l;
        if (!l.deliveredAt) return l;
        const age = now - new Date(l.deliveredAt).getTime();
        if (age >= THIRTY_DAYS_MS) {
          return { ...l, status: "archived" as LoadStatus };
        }
        return l;
      });
    setLocalLoads(archiveFn);
    setPlatformLoads((prev) => {
      const updated = archiveFn(prev);
      AsyncStorage.setItem(PLATFORM_LOADS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    setDeliveredSnapshots((prev) => {
      const updated = archiveFn(prev);
      AsyncStorage.setItem(DRIVER_DELIVERED_SNAPSHOTS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, [geocacheReady]);



  // ── deleteLoad: remove a single non-platform load ───────────────────────────
  const deleteLoad = useCallback((loadId: string) => {
    // Guard: never delete platform-assigned loads
    if (loadId.startsWith("platform-")) return;
    setLocalLoads((prev) => prev.filter((l) => l.id !== loadId));
    // Also remove from delivered snapshots if it ended up there
    setDeliveredSnapshots((prev) => {
      const updated = prev.filter((l) => l.id !== loadId);
      AsyncStorage.setItem(DRIVER_DELIVERED_SNAPSHOTS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    // Remove from driver-delivered tracking set
    driverDeliveredRef.current.delete(loadId);
    AsyncStorage.setItem(
      DRIVER_DELIVERED_KEY,
      JSON.stringify([...driverDeliveredRef.current])
    ).catch(() => {});
  }, []);

  // ── clearNonPlatformLoads: wipe all demo/mock/manual loads ───────────────────
  const clearNonPlatformLoads = useCallback(() => {
    setLocalLoads([]);
    // Remove any non-platform snapshots from delivered snapshots
    setDeliveredSnapshots((prev) => {
      const updated = prev.filter((l) => l.id.startsWith("platform-"));
      AsyncStorage.setItem(DRIVER_DELIVERED_SNAPSHOTS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    // Clean up driver-delivered tracking for non-platform IDs
    const platformOnly = new Set(
      [...driverDeliveredRef.current].filter((id) => id.startsWith("platform-"))
    );
    driverDeliveredRef.current = platformOnly;
    AsyncStorage.setItem(
      DRIVER_DELIVERED_KEY,
      JSON.stringify([...platformOnly])
    ).catch(() => {});
  }, []);

  const archiveAllDelivered = useCallback(() => {
    const archiveFn = (prev: Load[]) =>
      prev.map((l) =>
        l.status === "delivered" ? { ...l, status: "archived" as LoadStatus } : l
      );
    setLocalLoads(archiveFn);
    setPlatformLoads((prev) => {
      const updated = archiveFn(prev);
      AsyncStorage.setItem(PLATFORM_LOADS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    setDeliveredSnapshots((prev) => {
      const updated = archiveFn(prev);
      AsyncStorage.setItem(DRIVER_DELIVERED_SNAPSHOTS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  return (
    <LoadsContext.Provider
      value={{
        loads,
        isLoadingPlatformLoads,
        platformLoadError,
        getLoad,
        updateLoadStatus,
        savePickupInspection,
        saveDeliveryInspection,
        updateVehicleInfo,
        addLoad,
        refreshPlatformLoads,
        revertVehicleToPickupPending,
        archiveAllDelivered,
        deleteLoad,
        clearNonPlatformLoads,
      }}
    >
      {children}
    </LoadsContext.Provider>
  );
}

export function useLoads() {
  const ctx = useContext(LoadsContext);
  if (!ctx) throw new Error("useLoads must be used within LoadsProvider");
  return ctx;
}
