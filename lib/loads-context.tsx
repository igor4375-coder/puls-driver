import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MOCK_LOADS, type Load, type LoadStatus, type VehicleInspection } from "./data";
import { useSettings } from "./settings-context";

// ─── Debounced AsyncStorage writes (reduces I/O pressure) ───────────────────────

const _pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
function debouncedAsyncWrite(key: string, value: string, delayMs = 500) {
  const existing = _pendingWrites.get(key);
  if (existing) clearTimeout(existing);
  _pendingWrites.set(key, setTimeout(() => {
    AsyncStorage.setItem(key, value).catch((err) => console.warn(`[Loads] AsyncStorage write failed for ${key}:`, err));
    _pendingWrites.delete(key);
  }, delayMs));
}

// ─── Persistence key ──────────────────────────────────────────────────────────

const LOADS_STORAGE_KEY = "autohaul_loads_v2";
const DEMO_CLEARED_KEY = "@autohaul:demo_cleared";
const PLATFORM_LOADS_KEY = "autohaul_platform_loads_v7";

// Atomic key for delivered data: stores both IDs and snapshots together
// to prevent inconsistent state if the app is killed mid-write.
const DRIVER_DELIVERED_ATOMIC_KEY = "@autohaul:driver_delivered_atomic_v2";
const STATUS_OVERRIDES_KEY = "@autohaul:status_overrides_v1";
const PLATFORM_SYNC_QUEUE_KEY = "@autohaul:platform_sync_queue_v1";

// Legacy keys (read on startup for migration, then removed)
const DRIVER_DELIVERED_KEY = "@autohaul:driver_delivered_loads_v1";
const DRIVER_DELIVERED_SNAPSHOTS_KEY = "@autohaul:driver_delivered_snapshots_v1";

const STATUS_RANK: Record<string, number> = { new: 0, assigned: 0, picked_up: 1, delivered: 2, archived: 3 };

/** Immediately persist delivered data — no debounce for critical writes. */
function persistDeliveredImmediate(ids: string[], snapshots: Load[]) {
  const payload = JSON.stringify({ ids, snapshots });
  AsyncStorage.setItem(DRIVER_DELIVERED_ATOMIC_KEY, payload).catch((err) =>
    console.warn("[Loads] Failed to persist delivered data:", err),
  );
}

// ─── Helper: convert company platform load → driver app Load ─────────────────

export interface PlatformLoad {
  legId: number | string;
  tripId?: number | string;

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
  /** Company org ID — needed for getLocations filter */
  orgId?: string;
  /** Human-readable company/org name that dispatched this load */
  orgName?: string;
  /** True if this leg's dropoff IS the order's final destination */
  isFinalLeg?: boolean;
  /** The order's ultimate destination */
  finalDestination?: {
    id: string;
    name: string;
    address: string;
    city: string;
    province: string;
  };
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
        previousLegNotes: (pl as any).previousLegNotes ?? null,
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
    orgId: pl.orgId,
    orgName: pl.orgName,
    isFinalLeg: pl.isFinalLeg,
    finalDestination: pl.finalDestination,
  } as Load & { platformTripId: number | string };
}

// ─── Platform sync queue types ────────────────────────────────────────────────

export type PlatformSyncTask =
  | { type: "markAsPickedUp"; args: Record<string, unknown>; id: string; attempts: number; createdAt: number }
  | { type: "markAsDelivered"; args: Record<string, unknown>; id: string; attempts: number; createdAt: number }
  | { type: "syncInspection"; args: Record<string, unknown>; id: string; attempts: number; createdAt: number };

// ─── Context types ────────────────────────────────────────────────────────────

interface LoadsContextType {
  loads: Load[];
  isLoadingPlatformLoads: boolean;
  platformLoadError: string | null;
  lastSyncedAt: Date | null;
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
  /** Move all delivered loads to "archived" status immediately. */
  archiveAllDelivered: () => void;
  /** Move a single load to "archived" status. Works for both platform and local loads. */
  archiveSingleLoad: (loadId: string) => void;
  /** Permanently remove all archived loads from local storage. */
  clearAllArchived: () => void;

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
  /** Merge partial fields onto a load (both local & platform arrays + delivered snapshot). */
  patchLoad: (loadId: string, patch: Partial<Load>) => void;
  /** Queue a platform API call (markAsPickedUp/markAsDelivered/syncInspection) that survives navigation and app restarts. */
  queuePlatformSync: (task: Omit<PlatformSyncTask, "id" | "attempts" | "createdAt">) => void;
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
          headers: { "User-Agent": "PulsDispatchApp/1.0" },
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
  // When a real driver is authenticated, start with empty local loads.
  // Start empty; demo mock data is loaded in the useEffect below only if
  // the user hasn't previously cleared it.
  const isDemoMode = !driverCode || driverCode === "D-00001";
  const [localLoads, setLocalLoadsRaw] = useState<Load[]>([]);
  const localLoadsInitRef = React.useRef(false);

  // Wrap setLocalLoads to auto-persist
  const setLocalLoads = React.useCallback((updater: Load[] | ((prev: Load[]) => Load[])) => {
    setLocalLoadsRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      debouncedAsyncWrite(LOADS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Platform loads fetched from company platform
  const [platformLoads, setPlatformLoads] = useState<Load[]>([]);
  const [isLoadingPlatformLoads, setIsLoadingPlatformLoads] = useState(false);
  const [platformLoadError, setPlatformLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const { settings } = useSettings();

  // Local status overrides — maps loadId → { status, timestamp }.
  // Persisted to AsyncStorage so they survive app restarts.
  // Platform sync will never downgrade a load to a lower-rank status.
  const localStatusOverridesRef = React.useRef<Map<string, { status: LoadStatus; at: number }>>(new Map());

  // VINs for field pickups already synced to the platform (prevents duplicate syncs)
  const fieldPickupSyncedRef = React.useRef<Set<string>>(new Set());

  // ── Platform sync queue ──────────────────────────────────────────────────
  // Persistent queue of platform API calls that must survive screen navigation
  // and app restarts. Processed here in the always-mounted LoadsProvider.
  const [syncQueue, setSyncQueue] = useState<PlatformSyncTask[]>([]);
  const syncProcessingRef = React.useRef(false);

  // Load persisted sync queue on startup
  useEffect(() => {
    AsyncStorage.getItem(PLATFORM_SYNC_QUEUE_KEY).then((val) => {
      if (val) {
        try {
          const tasks = JSON.parse(val) as PlatformSyncTask[];
          if (tasks.length > 0) {
            console.log(`[PlatformSync] Loaded ${tasks.length} pending task(s) from storage`);
            setSyncQueue(tasks);
          }
        } catch { /* ignore corrupt data */ }
      }
    }).catch(() => {});
  }, []);

  const persistSyncQueue = useCallback((tasks: PlatformSyncTask[]) => {
    AsyncStorage.setItem(PLATFORM_SYNC_QUEUE_KEY, JSON.stringify(tasks)).catch(() => {});
  }, []);

  const queuePlatformSync = useCallback((task: Omit<PlatformSyncTask, "id" | "attempts" | "createdAt">) => {
    const fullTask = {
      ...task,
      id: `${task.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      attempts: 0,
      createdAt: Date.now(),
    } as PlatformSyncTask;
    console.log(`[PlatformSync] Queued ${task.type}`, JSON.stringify(task.args).slice(0, 200));
    setSyncQueue((prev) => {
      const updated = [...prev, fullTask];
      persistSyncQueue(updated);
      return updated;
    });
  }, [persistSyncQueue]);

  // Process the sync queue
  useEffect(() => {
    if (syncQueue.length === 0 || syncProcessingRef.current) return;
    syncProcessingRef.current = true;

    (async () => {
      const remaining: PlatformSyncTask[] = [];
      for (const task of syncQueue) {
        try {
          console.log(`[PlatformSync] Processing ${task.type} (attempt ${task.attempts + 1})`);
          if (task.type === "markAsPickedUp") {
            await markAsPickedUpAction(task.args as any);
          } else if (task.type === "markAsDelivered") {
            await markAsDeliveredAction(task.args as any);
          } else if (task.type === "syncInspection") {
            await syncInspectionAction(task.args as any);
          }
          console.log(`[PlatformSync] ${task.type} succeeded`);
        } catch (err) {
          console.warn(`[PlatformSync] ${task.type} failed (attempt ${task.attempts + 1}):`, err);
          const maxAttempts = 5;
          if (task.attempts + 1 < maxAttempts) {
            remaining.push({ ...task, attempts: task.attempts + 1 });
          } else {
            console.error(`[PlatformSync] ${task.type} permanently failed after ${maxAttempts} attempts`);
          }
        }
      }
      setSyncQueue(remaining);
      persistSyncQueue(remaining);
      syncProcessingRef.current = false;
    })();
  }, [syncQueue, markAsPickedUpAction, markAsDeliveredAction, syncInspectionAction, persistSyncQueue]);

  // Retry failed sync tasks when app comes to foreground
  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      if (state === "active" && syncQueue.length > 0 && !syncProcessingRef.current) {
        setSyncQueue((prev) => [...prev]); // trigger re-process
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [syncQueue.length]);

  // ── Driver-delivered tracking ─────────────────────────────────────────────
  // Set of load IDs that the driver explicitly marked as delivered.
  // These survive platform sync so the load stays in the Delivered tab.
  const driverDeliveredRef = React.useRef<Set<string>>(new Set());
  // Full Load snapshots for delivered loads that the platform may have
  // removed from the driver's assignment list (e.g. reassigned to next leg).
  const [deliveredSnapshots, setDeliveredSnapshots] = useState<Load[]>([]);

  // Load persisted driver-delivered data on startup (atomic key, with legacy migration)
  useEffect(() => {
    (async () => {
      try {
        const atomicVal = await AsyncStorage.getItem(DRIVER_DELIVERED_ATOMIC_KEY);
        if (atomicVal) {
          const { ids, snapshots } = JSON.parse(atomicVal) as { ids: string[]; snapshots: Load[] };
          driverDeliveredRef.current = new Set(ids);
          setDeliveredSnapshots(snapshots);
          return;
        }
        // Migrate from legacy separate keys
        const [legacyIds, legacySnaps] = await Promise.all([
          AsyncStorage.getItem(DRIVER_DELIVERED_KEY),
          AsyncStorage.getItem(DRIVER_DELIVERED_SNAPSHOTS_KEY),
        ]);
        const ids: string[] = legacyIds ? JSON.parse(legacyIds) : [];
        const snapshots: Load[] = legacySnaps ? JSON.parse(legacySnaps) : [];
        if (ids.length > 0 || snapshots.length > 0) {
          driverDeliveredRef.current = new Set(ids);
          setDeliveredSnapshots(snapshots);
          persistDeliveredImmediate(ids, snapshots);
          AsyncStorage.multiRemove([DRIVER_DELIVERED_KEY, DRIVER_DELIVERED_SNAPSHOTS_KEY]).catch(() => {});
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // Load persisted status overrides on startup
  useEffect(() => {
    AsyncStorage.getItem(STATUS_OVERRIDES_KEY).then((val) => {
      if (val) {
        try {
          const entries = JSON.parse(val) as [string, { status: LoadStatus; at: number }][];
          localStatusOverridesRef.current = new Map(entries);
        } catch { /* ignore corrupt data */ }
      }
    }).catch(() => {});
  }, []);

  // Load persisted local (non-platform) loads on startup.
  // In demo mode, seed MOCK_LOADS only on the very first launch;
  // once the user clears them they stay cleared across restarts.
  useEffect(() => {
    if (localLoadsInitRef.current) return;
    localLoadsInitRef.current = true;
    (async () => {
      if (isDemoMode) {
        const cleared = await AsyncStorage.getItem(DEMO_CLEARED_KEY).catch(() => null);
        if (cleared) return; // user cleared demo data — stay empty
      }
      const cached = await AsyncStorage.getItem(LOADS_STORAGE_KEY).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Load[];
          if (parsed.length > 0) setLocalLoadsRaw(parsed);
        } catch { /* ignore corrupt data */ }
        return;
      }
      if (isDemoMode) {
        setLocalLoadsRaw(MOCK_LOADS);
      }
    })();
  }, [isDemoMode]);

  // Helper: mark a load as driver-delivered and snapshot it.
  // Uses immediate (non-debounced) atomic write so data survives app kills.
  const markDriverDelivered = React.useCallback((loadId: string, load: Load) => {
    driverDeliveredRef.current.add(loadId);
    setDeliveredSnapshots((prev) => {
      const exists = prev.some((l) => l.id === loadId);
      const updated = exists
        ? prev.map((l) => (l.id === loadId ? { ...load, status: "delivered" as LoadStatus } : l))
        : [...prev, { ...load, status: "delivered" as LoadStatus }];
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, []);
  // Geocode cache: address string -> {lat, lng}
  const geocacheRef = React.useRef<Record<string, { lat: number; lng: number }>>({});
  const geocacheLoadedRef = React.useRef(false);

  // Convex action to fetch loads from the company platform
  const fetchAssignedLoads = useAction(api.platform.getAssignedLoads);
  const markAsPickedUpAction = useAction(api.platform.markAsPickedUp);
  const markAsDeliveredAction = useAction(api.platform.markAsDelivered);
  const syncInspectionAction = useAction(api.platform.syncInspection);
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
      debouncedAsyncWrite(GEO_CACHE_KEY, JSON.stringify(geocacheRef.current));
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

      // Capture any picked-up platform loads about to be dropped (computed
      // inside the functional updater so we see the true current state).
      // We snapshot them AFTER setPlatformLoads to avoid calling setState
      // inside another setState callback.
      let droppedPickedUp: Load[] = [];

      setPlatformLoads((prev) => {
        const newIds = new Set(geocoded.map((l) => l.id));
        droppedPickedUp = prev.filter(
          (l) =>
            l.status === "picked_up" &&
            !newIds.has(l.id) &&
            !driverDeliveredRef.current.has(l.id)
        );

        const inspectionMap = new Map<string, Map<string, { pickup?: VehicleInspection; delivery?: VehicleInspection; frozen?: VehicleInspection }>>();
        for (const l of prev) {
          for (const v of l.vehicles) {
            if (v.pickupInspection || v.deliveryInspection || v.frozenPickupInspection) {
              if (!inspectionMap.has(l.id)) inspectionMap.set(l.id, new Map());
              inspectionMap.get(l.id)!.set(v.id, {
                pickup: v.pickupInspection,
                delivery: v.deliveryInspection,
                frozen: v.frozenPickupInspection,
              });
            }
          }
        }
        const resolveStatus = (loadId: string, freshStatus: LoadStatus, existingStatus?: LoadStatus) => {
          if (!existingStatus || existingStatus === freshStatus) return freshStatus;

          const override = localStatusOverridesRef.current.get(loadId);
          if (override) {
            const overrideRank = STATUS_RANK[override.status] ?? 0;
            const freshRank = STATUS_RANK[freshStatus] ?? 0;
            // Never let the platform downgrade below the driver's local override
            if (freshRank < overrideRank) return override.status;
          }

          // Even without an explicit override, never downgrade an existing higher status
          const existingRank = STATUS_RANK[existingStatus] ?? 0;
          const freshRank = STATUS_RANK[freshStatus] ?? 0;
          if (freshRank < existingRank) return existingStatus;

          return freshStatus;
        };

        if (inspectionMap.size === 0) {
          return geocoded.map((l) => {
            const existing = prev.find((p) => p.id === l.id);
            if (!existing) return l;
            const mergedStatus = resolveStatus(l.id, l.status, existing.status);
            return {
              ...l,
              status: mergedStatus,
              deliveredAt: existing.deliveredAt ?? l.deliveredAt,
              ...(mergedStatus === "picked_up" || mergedStatus === "delivered" || mergedStatus === "archived"
                ? { pickup: { ...l.pickup, date: existing.pickup.date } }
                : {}),
              ...(mergedStatus === "delivered" || mergedStatus === "archived"
                ? { delivery: { ...l.delivery, date: existing.delivery.date } }
                : {}),
            };
          });
        }
        return geocoded.map((l) => {
          const existing = prev.find((p) => p.id === l.id);
          const loadInsps = inspectionMap.get(l.id);
          const mergedStatus = resolveStatus(l.id, l.status, existing?.status);
          return {
            ...l,
            status: mergedStatus,
            deliveredAt: existing?.deliveredAt ?? l.deliveredAt,
            ...(existing && (mergedStatus === "picked_up" || mergedStatus === "delivered" || mergedStatus === "archived")
              ? { pickup: { ...l.pickup, date: existing.pickup.date } }
              : {}),
            ...(existing && (mergedStatus === "delivered" || mergedStatus === "archived")
              ? { delivery: { ...l.delivery, date: existing.delivery.date } }
              : {}),
            vehicles: l.vehicles.map((v) => {
              const saved = loadInsps?.get(v.id);
              if (!saved) return v;
              return {
                ...v,
                ...(saved.pickup && { pickupInspection: saved.pickup }),
                ...(saved.delivery && { deliveryInspection: saved.delivery }),
                ...(saved.frozen && { frozenPickupInspection: saved.frozen }),
              };
            }),
          };
        });
      });
      setLastSyncedAt(new Date());
      setPlatformLoads((current) => {
        debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(current));
        return current;
      });

      // Snapshot any picked-up loads that were dropped from the platform response.
      // This preserves them so the driver can still complete the delivery flow
      // even if dispatch dismisses or unassigns the load.
      if (droppedPickedUp.length > 0) {
        setDeliveredSnapshots((prev) => {
          let updated = [...prev];
          for (const l of droppedPickedUp) {
            driverDeliveredRef.current.add(l.id);
            const exists = updated.some((s) => s.id === l.id);
            const snapshot = { ...l, status: "picked_up" as LoadStatus };
            if (exists) {
              updated = updated.map((s) => (s.id === l.id ? snapshot : s));
            } else {
              updated = [...updated, snapshot];
            }
          }
          persistDeliveredImmediate([...driverDeliveredRef.current], updated);
          return updated;
        });
      }
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

  // Refresh loads immediately when the app returns to the foreground
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active" && appStateRef.current !== "active") {
        doFetchLoads();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [doFetchLoads]);

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
            debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(geocoded));
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

  // ── Field pickup → platform load VIN matching ─────────────────────────────
  // When the company creates an order from a field pickup notification, a new
  // platform load arrives with the same VIN. Detect this match, transfer the
  // locally-stored inspection data, fire markAsPickedUp + syncInspection with
  // the real platform identifiers, and retire the local field pickup load.
  useEffect(() => {
    if (platformLoads.length === 0 || localLoads.length === 0) return;

    const pickedUpFPs = localLoads.filter(
      (l) => l.isFieldPickup && l.status === "picked_up",
    );
    if (pickedUpFPs.length === 0) return;

    const vinToFP = new Map<string, Load>();
    for (const fp of pickedUpFPs) {
      for (const v of fp.vehicles) {
        const vin = v.vin?.trim().toUpperCase();
        if (vin && !fieldPickupSyncedRef.current.has(vin)) {
          vinToFP.set(vin, fp);
        }
      }
    }
    if (vinToFP.size === 0) return;

    for (const pl of platformLoads) {
      for (const pv of pl.vehicles) {
        const vin = pv.vin?.trim().toUpperCase();
        if (!vin) continue;
        const fp = vinToFP.get(vin);
        if (!fp) continue;

        fieldPickupSyncedRef.current.add(vin);
        vinToFP.delete(vin);

        const fpVehicle = fp.vehicles.find(
          (fv) => fv.vin?.trim().toUpperCase() === vin,
        );
        const inspection =
          fpVehicle?.frozenPickupInspection ?? fpVehicle?.pickupInspection;
        const legId = pl.platformTripId;
        if (!legId || !driverCode) continue;

        if (inspection) {
          savePickupInspection(pl.id, pv.id, inspection);
        }

        updateLoadStatus(pl.id, "picked_up");
        setLocalLoads((prev) => prev.filter((l) => l.id !== fp.id));

        const damages = (inspection?.damages ?? []).map((d) => ({
          id: d.id,
          zone: d.zone,
          type: d.type,
          severity: d.severity,
          x: d.xPct != null ? d.xPct / 100 : 0.5,
          y: d.yPct != null ? d.yPct / 100 : 0.5,
          diagramView: d.diagramView,
          note: d.description || undefined,
        }));
        const noDamage = inspection?.noDamage ?? damages.length === 0;
        const photos = (inspection?.photos ?? []).filter((p) =>
          p.startsWith("http"),
        );
        const gpsLat = inspection?.locationLat ?? 0;
        const gpsLng = inspection?.locationLng ?? 0;
        const completedAt =
          inspection?.completedAt ?? new Date().toISOString();

        const additionalData: Record<string, unknown> = {};
        const ai = inspection?.additionalInspection;
        if (ai) {
          if (ai.odometer) additionalData.odometer = ai.odometer;
          if (ai.drivable !== null && ai.drivable !== undefined) additionalData.drivable = ai.drivable;
          if (ai.windscreen !== null && ai.windscreen !== undefined) additionalData.windscreen = ai.windscreen;
          if (ai.glassesIntact !== null && ai.glassesIntact !== undefined) additionalData.glassesIntact = ai.glassesIntact;
          if (ai.titlePresent !== null && ai.titlePresent !== undefined) additionalData.titlePresent = ai.titlePresent;
          if (ai.billOfSale !== null && ai.billOfSale !== undefined) additionalData.billOfSale = ai.billOfSale;
          if (ai.keys !== null && ai.keys !== undefined) additionalData.keys = ai.keys;
          if (ai.remotes !== null && ai.remotes !== undefined) additionalData.remotes = ai.remotes;
          if (ai.headrests !== null && ai.headrests !== undefined) additionalData.headrests = ai.headrests;
          if (ai.cargoCover !== null && ai.cargoCover !== undefined) additionalData.cargoCover = ai.cargoCover;
          if (ai.spareTire !== null && ai.spareTire !== undefined) additionalData.spareTire = ai.spareTire;
          if (ai.radio !== null && ai.radio !== undefined) additionalData.radio = ai.radio;
          if (ai.manuals !== null && ai.manuals !== undefined) additionalData.manuals = ai.manuals;
          if (ai.navigationDisk !== null && ai.navigationDisk !== undefined) additionalData.navigationDisk = ai.navigationDisk;
          if (ai.pluginChargerCable !== null && ai.pluginChargerCable !== undefined) additionalData.pluginChargerCable = ai.pluginChargerCable;
          if (ai.headphones !== null && ai.headphones !== undefined) additionalData.headphones = ai.headphones;
        }

        const savedSigPaths = settings.driverSignaturePaths.filter(
          (p) => !p.d.startsWith("__live__"),
        );
        const driverSigStr =
          savedSigPaths.length > 0
            ? savedSigPaths.map((p) => p.d).join(" ")
            : undefined;

        console.log(
          `[FieldPickupSync] Matched VIN ${vin} → platform load ${pl.loadNumber} (legId=${legId}). Syncing...`,
        );

        markAsPickedUpAction({
          loadNumber: pl.loadNumber,
          legId: String(legId),
          driverCode,
          pickupTime: completedAt,
          pickupGPS: { lat: gpsLat, lng: gpsLng },
          pickupPhotos: photos,
          customerNotAvailable: true,
          ...(driverSigStr ? { driverSig: driverSigStr } : {}),
          damages,
          noDamage,
          vehicleVin: fpVehicle?.vin || "",
          ...(Object.keys(additionalData).length > 0
            ? { additionalInspection: additionalData }
            : {}),
        }).catch((err) =>
          console.warn("[FieldPickupSync] markAsPickedUp failed:", err),
        );

        syncInspectionAction({
          loadNumber: pl.loadNumber,
          legId: String(legId),
          driverCode,
          inspectionType: "pickup",
          vehicleVin: fpVehicle?.vin || "",
          photos,
          damages,
          noDamage,
          gps: { lat: gpsLat, lng: gpsLng },
          timestamp: completedAt,
          notes: inspection?.notes || undefined,
          ...(Object.keys(additionalData).length > 0
            ? { additionalInspection: additionalData }
            : {}),
        }).catch((err) =>
          console.error("[FieldPickupSync] syncInspection failed:", err),
        );
      }
    }
  }, [
    platformLoads,
    localLoads,
    driverCode,
    settings.driverSignaturePaths,
    savePickupInspection,
    updateLoadStatus,
    setLocalLoads,
    markAsPickedUpAction,
    syncInspectionAction,
  ]);

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
    //    assignment list after they were delivered OR picked up. Preserve
    //    their stored status so picked_up loads stay in Picked Up tab.
    for (const l of deliveredSnapshots) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        result.push(l);
      }
    }

    return result;
  }, [platformLoads, localLoads, deliveredSnapshots]);

  const getLoad = useCallback(
    (id: string) => loads.find((l) => l.id === id),
    [loads]
  );

  const updateLoadStatus = useCallback((loadId: string, status: LoadStatus) => {
    localStatusOverridesRef.current.set(loadId, { status, at: Date.now() });
    AsyncStorage.setItem(
      STATUS_OVERRIDES_KEY,
      JSON.stringify([...localStatusOverridesRef.current.entries()]),
    ).catch(() => {});

    // When the driver marks a load as delivered, persist that decision locally
    // so it survives platform sync (which may drop the load).
    if (status === "delivered") {
      // Find the current load to snapshot it (with deliveredAt timestamp)
      const currentLoad = [...platformLoads, ...localLoads].find((l) => l.id === loadId);
      const deliveredAt = new Date().toISOString();
      if (currentLoad) {
        markDriverDelivered(loadId, {
          ...currentLoad,
          deliveredAt,
          delivery: { ...currentLoad.delivery, date: deliveredAt },
        });
      }
      // Stamp deliveredAt and actual delivery date on the load in both arrays
      const stampFn = (prev: Load[]) =>
        prev.map((l) =>
          l.id === loadId
            ? { ...l, deliveredAt, delivery: { ...l.delivery, date: deliveredAt } }
            : l
        );
      setLocalLoads(stampFn);
      setPlatformLoads((prev) => {
        const updated = stampFn(prev);
        debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
        return updated;
      });
    }

    // When marking as picked_up, freeze the pickup inspection and stamp actual pickup date
    if (status === "picked_up") {
      const pickedUpAt = new Date().toISOString();
      const freezeFn = (prev: Load[]) =>
        prev.map((l) => {
          if (l.id !== loadId) return l;
          return {
            ...l,
            status,
            pickup: { ...l.pickup, date: pickedUpAt },
            vehicles: l.vehicles.map((v) => ({
              ...v,
              frozenPickupInspection: v.pickupInspection
                ? { ...v.pickupInspection }
                : v.frozenPickupInspection,
            })),
          };
        });
      setLocalLoads(freezeFn);
      setPlatformLoads((prev) => {
        const updated = freezeFn(prev);
        debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
        return updated;
      });
      return;
    }

    // Update in both local and platform arrays (skip if we already stamped above for delivered)
    if (status !== "delivered") {
      setLocalLoads((prev) =>
        prev.map((l) => (l.id === loadId ? { ...l, status } : l))
      );
      setPlatformLoads((prev) => {
        const updated = prev.map((l) => (l.id === loadId ? { ...l, status } : l));
        debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
        return updated;
      });
    }
  }, [platformLoads, localLoads, markDriverDelivered]);

  const savePickupInspection = useCallback(
    (loadId: string, vehicleId: string, inspection: VehicleInspection) => {
      const updateFn = (prev: Load[]) =>
        prev.map((l) => {
          if (l.id !== loadId) return l;
          if (l.status === "delivered" || l.status === "archived") return l;
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
      debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
      return updated;
    });
    setDeliveredSnapshots((prev) => {
      const updated = archiveFn(prev);
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, [geocacheReady]);



  // ── deleteLoad: remove a single non-platform load ───────────────────────────
  const deleteLoad = useCallback((loadId: string) => {
    if (loadId.startsWith("platform-")) return;
    setLocalLoads((prev) => prev.filter((l) => l.id !== loadId));
    driverDeliveredRef.current.delete(loadId);
    setDeliveredSnapshots((prev) => {
      const updated = prev.filter((l) => l.id !== loadId);
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, []);

  // ── clearNonPlatformLoads: wipe all demo/mock/manual loads ───────────────────
  const clearNonPlatformLoads = useCallback(() => {
    setLocalLoadsRaw([]);
    AsyncStorage.setItem(LOADS_STORAGE_KEY, "[]").catch(() => {});
    AsyncStorage.setItem(DEMO_CLEARED_KEY, "1").catch(() => {});
    const platformOnly = new Set(
      [...driverDeliveredRef.current].filter((id) => id.startsWith("platform-"))
    );
    driverDeliveredRef.current = platformOnly;
    setDeliveredSnapshots((prev) => {
      const updated = prev.filter((l) => l.id.startsWith("platform-"));
      persistDeliveredImmediate([...platformOnly], updated);
      return updated;
    });
  }, []);

  const patchLoad = useCallback((loadId: string, patch: Partial<Load>) => {
    const mergeFn = (prev: Load[]) =>
      prev.map((l) => (l.id === loadId ? { ...l, ...patch } : l));
    setLocalLoads(mergeFn);
    setPlatformLoads((prev) => {
      const updated = mergeFn(prev);
      debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
      return updated;
    });
    setDeliveredSnapshots((prev) => {
      const updated = mergeFn(prev);
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, []);

  const archiveAllDelivered = useCallback(() => {
    const archiveFn = (prev: Load[]) =>
      prev.map((l) =>
        l.status === "delivered" ? { ...l, status: "archived" as LoadStatus } : l
      );
    setLocalLoads(archiveFn);
    setPlatformLoads((prev) => {
      const updated = archiveFn(prev);
      debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
      return updated;
    });
    setDeliveredSnapshots((prev) => {
      const updated = archiveFn(prev);
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, []);

  const archiveSingleLoad = useCallback((loadId: string) => {
    const patchFn = (prev: Load[]) =>
      prev.map((l) => (l.id === loadId && l.status === "delivered" ? { ...l, status: "archived" as LoadStatus } : l));
    setLocalLoads(patchFn);
    setPlatformLoads((prev) => {
      const updated = patchFn(prev);
      debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
      return updated;
    });
    setDeliveredSnapshots((prev) => {
      const updated = patchFn(prev);
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, []);

  const clearAllArchived = useCallback(() => {
    const removeFn = (prev: Load[]) => prev.filter((l) => l.status !== "archived");
    setLocalLoads(removeFn);
    setPlatformLoads((prev) => {
      const updated = removeFn(prev);
      debouncedAsyncWrite(PLATFORM_LOADS_KEY, JSON.stringify(updated));
      return updated;
    });
    const archivedIds = new Set(
      [...driverDeliveredRef.current].filter((id) => {
        const allLoads = [...localLoads, ...platformLoads, ...deliveredSnapshots];
        const load = allLoads.find((l) => l.id === id);
        return load?.status === "archived";
      })
    );
    for (const id of archivedIds) driverDeliveredRef.current.delete(id);
    setDeliveredSnapshots((prev) => {
      const updated = removeFn(prev);
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, [localLoads, platformLoads, deliveredSnapshots]);

  return (
    <LoadsContext.Provider
      value={{
        loads,
        isLoadingPlatformLoads,
        platformLoadError,
        lastSyncedAt,
        getLoad,
        updateLoadStatus,
        savePickupInspection,
        saveDeliveryInspection,
        updateVehicleInfo,
        addLoad,
        refreshPlatformLoads,
        archiveAllDelivered,
        archiveSingleLoad,
        clearAllArchived,
        deleteLoad,
        clearNonPlatformLoads,
        patchLoad,
        queuePlatformSync,
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
