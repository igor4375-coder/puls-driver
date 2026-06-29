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
import { type Load, type LoadStatus, type VehicleInspection } from "./data";
import { useSettings } from "./settings-context";
import { photoQueue } from "./photo-queue";

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

// ─── Persistence keys ─────────────────────────────────────────────────────────
//
// IMPORTANT (v60+ multi-account isolation): All per-driver state is keyed with
// a `:${driverCode}` suffix so two Clerk accounts on the same device cannot
// clobber each other's load list, status overrides, sync queue, or delivered
// snapshots. Use the `useScopedKeys()` builder below — never reference these
// base constants directly when reading/writing per-driver data.
//
// Pre-v60 unsuffixed data is migrated into the first signed-in driver's scope
// once on upgrade (see SCOPE_MIGRATION_FLAG_KEY logic in LoadsProvider).

const LOADS_STORAGE_BASE = "autohaul_loads_v2";
const PLATFORM_LOADS_BASE = "autohaul_platform_loads_v7";
const DRIVER_DELIVERED_ATOMIC_BASE = "@autohaul:driver_delivered_atomic_v2";
const STATUS_OVERRIDES_BASE = "@autohaul:status_overrides_v1";
const PLATFORM_SYNC_QUEUE_BASE = "@autohaul:platform_sync_queue_v1";
// v64+: server-fetched delivered loads (from platform v3.5.0
// `getDeliveredLoads`). Persisted as an instant-render cache so the
// Delivered tab still works offline.
const SERVER_DELIVERED_LOADS_BASE = "@autohaul:server_delivered_loads_v1";

// Global keys (deliberately unscoped — apply to the install, not to a driver)
const SCOPE_MIGRATION_FLAG_KEY = "@autohaul:scope_migrated_v60";
// One-shot purge flag for the MOCK_LOADS test vehicles that used to seed in
// demo mode (Toyota Camry / Honda Accord / etc. — IDs L001–L004). v53 removed
// the seeder entirely; this flag tracks that we've also wiped any persisted
// residue from older builds so the test loads can never reappear.
const MOCK_PURGE_FLAG_KEY = "@autohaul:mock_loads_purged_v53";
const MOCK_LOAD_IDS = new Set(["L001", "L002", "L003", "L004"]);

// Legacy keys (read once on startup for migration, then removed)
const DRIVER_DELIVERED_KEY = "@autohaul:driver_delivered_loads_v1";
const DRIVER_DELIVERED_SNAPSHOTS_KEY = "@autohaul:driver_delivered_snapshots_v1";

const STATUS_RANK: Record<string, number> = { new: 0, assigned: 0, picked_up: 1, delivered: 2, archived: 3 };

interface ScopedKeys {
  localLoads: string;
  platformLoads: string;
  driverDelivered: string;
  statusOverrides: string;
  platformSyncQueue: string;
  serverDeliveredLoads: string;
}

function buildScopedKeys(driverCode: string | null | undefined): ScopedKeys | null {
  if (!driverCode) return null;
  const suffix = `:${driverCode}`;
  return {
    localLoads: `${LOADS_STORAGE_BASE}${suffix}`,
    platformLoads: `${PLATFORM_LOADS_BASE}${suffix}`,
    driverDelivered: `${DRIVER_DELIVERED_ATOMIC_BASE}${suffix}`,
    statusOverrides: `${STATUS_OVERRIDES_BASE}${suffix}`,
    platformSyncQueue: `${PLATFORM_SYNC_QUEUE_BASE}${suffix}`,
    serverDeliveredLoads: `${SERVER_DELIVERED_LOADS_BASE}${suffix}`,
  };
}

/**
 * v59 → v60 one-time migration: copies any unsuffixed pre-v60 data into the
 * first signed-in driver's scope, then deletes the unsuffixed copies. Subsequent
 * sign-ins (incl. the multi-account "Add another account" flow) start with a
 * fresh per-driver scope.
 */
async function migrateUnsuffixedToScope(scope: ScopedKeys): Promise<void> {
  try {
    const alreadyDone = await AsyncStorage.getItem(SCOPE_MIGRATION_FLAG_KEY);
    if (alreadyDone) return;
    const pairs: [string, string][] = [
      [LOADS_STORAGE_BASE, scope.localLoads],
      [PLATFORM_LOADS_BASE, scope.platformLoads],
      [DRIVER_DELIVERED_ATOMIC_BASE, scope.driverDelivered],
      [STATUS_OVERRIDES_BASE, scope.statusOverrides],
      [PLATFORM_SYNC_QUEUE_BASE, scope.platformSyncQueue],
      [SERVER_DELIVERED_LOADS_BASE, scope.serverDeliveredLoads],
    ];
    for (const [oldKey, newKey] of pairs) {
      const val = await AsyncStorage.getItem(oldKey).catch(() => null);
      if (!val) continue;
      const existingScopedVal = await AsyncStorage.getItem(newKey).catch(() => null);
      if (existingScopedVal == null) {
        await AsyncStorage.setItem(newKey, val).catch(() => {});
      }
      await AsyncStorage.removeItem(oldKey).catch(() => {});
    }
    await AsyncStorage.setItem(SCOPE_MIGRATION_FLAG_KEY, "1").catch(() => {});
    console.log("[Loads] v59→v60 unsuffixed-data migration complete");
  } catch (err) {
    console.warn("[Loads] Scope migration failed:", err);
  }
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
  /** Server-side delivery timestamp (set when the leg's status flips to
   * "delivered"). Populated by both `getAssignedLoads` (null for active
   * legs) and `getDeliveredLoads` (always set). Added in platform v3.5.0. */
  completedAt?: string | number | null;
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
  /** Per-leg dispatch notes (from "Dispatch Notes" field on the platform) */
  notes?: string | null;
  /** Load-level driver notes that apply to the whole order */
  driverNotes?: string | null;
  /** Pickup-specific instructions for this leg */
  pickupInstructions?: string | null;
  /** Dropoff-specific instructions for this leg */
  dropoffInstructions?: string | null;
  /** Note from the previous leg's delivery driver */
  previousLegNotes?: string | null;
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
    notes: [pl.notes, pl.driverNotes].filter(Boolean).join("\n\n") || "",
    dispatchNotes: pl.notes || null,
    driverNotes: pl.driverNotes || null,
    pickupInstructions: pl.pickupInstructions || null,
    dropoffInstructions: pl.dropoffInstructions || null,
    assignedAt: parsePlatformDate(pl.pickupDate),
    // Server-side delivery timestamp (v3.5.0+). Drives the Delivered-tab
    // sort order and the 30-day auto-archive. Falls back to deliveryDate
    // for older platform versions that didn't expose completedAt.
    deliveredAt: parsePlatformDate(pl.completedAt) || parsePlatformDate(pl.deliveryDate) || undefined,
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

/**
 * Merge a server-fetched delivered load (authoritative for status,
 * dates, etc.) with whatever locally-captured inspection data we still
 * have on hand.
 *
 * Why we need this: when a driver completes a delivery, the inspection
 * photos and damages are uploaded to R2 via the photo queue. The
 * inspection record itself is then synced via syncInspection /
 * markAsDelivered. Both can lag behind a slow connection or a queue
 * backlog. If the user navigates to the Delivered tab while uploads
 * are still pending, the server-fetched record may have a stale or
 * empty inspection block — but the local snapshot still carries the
 * full set. Prefer local inspection data so the driver doesn't see
 * "their photos vanished."
 */
function mergeServerDeliveredWithLocal(server: Load, local: Load): Load {
  return {
    ...server,
    // Stamp deliveredAt from local snapshot if server didn't include
    // one (older platform versions). Otherwise prefer server.
    deliveredAt: server.deliveredAt ?? local.deliveredAt,
    vehicles: server.vehicles.map((sv) => {
      const lv = local.vehicles.find((v) => {
        if (v.vin && sv.vin && v.vin.toUpperCase() === sv.vin.toUpperCase()) return true;
        return v.id === sv.id;
      });
      if (!lv) return sv;
      return {
        ...sv,
        // Local inspection data wins. The driver captured these photos
        // on this device — uploads may still be queued, so the server's
        // copy can legitimately be empty even after the leg flips
        // delivered. We prefer local so the driver doesn't see a
        // half-empty inspection card.
        pickupInspection: lv.pickupInspection ?? sv.pickupInspection,
        deliveryInspection: lv.deliveryInspection ?? sv.deliveryInspection,
        frozenPickupInspection: lv.frozenPickupInspection ?? sv.frozenPickupInspection,
      };
    }),
  };
}

// ─── Platform sync queue types ────────────────────────────────────────────────

// `status` defaults to "pending"/undefined for backward-compat with persisted
// pre-v62 tasks. Tasks that exhaust their retry budget are kept in the queue
// with status="failed_permanent" so the user can see them and manually retry,
// instead of being silently dropped.
/**
 * v71+: added `deferred` for syncInspection tasks that are sitting in the
 * queue waiting on photo uploads to finish. They are NOT auto-retried by
 * the normal pending-task processor; they get promoted back to `pending`
 * by the photoQueue subscription whenever every clientId in their
 * `photoClientIds` resolves to an HTTPS URL.
 */
export type PlatformSyncTaskStatus = "pending" | "failed_permanent" | "deferred";

type PlatformSyncTaskBase = {
  id: string;
  attempts: number;
  createdAt: number;
  status?: PlatformSyncTaskStatus;
  lastError?: string;
  /**
   * v71+: when a syncInspection task is queued with a non-empty
   * `args.photoClientIds`, the queue processor will RESOLVE those clientIds
   * to live HTTPS URLs at processing time and DEFER the task (without
   * incrementing attempts or marking it failed) whenever one or more
   * uploads are still in flight. `deferCount` is incremented every time
   * a task is held back, purely for diagnostic logging. The task fires
   * exactly once when every clientId has resolved to an HTTPS URL, and
   * the photoClientIds field is stripped from the args before the
   * Convex action is invoked (Convex's strict validator wouldn't accept
   * a field it doesn't know about).
   */
  deferCount?: number;
};

export type PlatformSyncTask =
  | ({ type: "markAsPickedUp"; args: Record<string, unknown> } & PlatformSyncTaskBase)
  | ({ type: "markAsDelivered"; args: Record<string, unknown> } & PlatformSyncTaskBase)
  | ({ type: "syncInspection"; args: Record<string, unknown> } & PlatformSyncTaskBase);

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
  /** Pull the delivered-loads history from the platform. Defaults to a
   * forced refresh (good for pull-to-refresh); pass `false` to respect
   * the 60s throttle (good for tab-focus prefetches). */
  refreshDeliveredLoads: (force?: boolean) => void;
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
  /**
   * Wait for any queued platform-sync tasks (markAsPickedUp / markAsDelivered /
   * syncInspection) to finish processing, up to `timeoutMs`. Used by the
   * multi-account session-switch flow to ensure pending API calls complete
   * with the OUTGOING Clerk session's auth token before the session swaps.
   *
   * Resolves true if the queue drained, false if the timeout fired first.
   */
  flushPlatformSyncQueue: (timeoutMs?: number) => Promise<boolean>;
  /** Read the current platform-sync queue (pending + failed-permanent tasks). */
  syncQueue: PlatformSyncTask[];
  /** Reset failed-permanent tasks to pending so they retry on the next pass. */
  retryFailedSyncTasks: () => void;
  /** Remove a sync task by id (used to clear unrecoverable tasks). */
  dismissSyncTask: (id: string) => void;
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
  // Local (non-platform) loads — manually-added or scanned loads owned by
  // this driver. Mock/demo data is intentionally never seeded; the app only
  // shows loads that come from the company platform or were created by the
  // driver themselves.

  // Per-driver storage keys (v60+). Rebuilt whenever driverCode changes so
  // each Clerk session reads/writes to its own AsyncStorage namespace.
  const scopedKeys = React.useMemo(() => buildScopedKeys(driverCode ?? null), [driverCode]);
  // Stable ref so callbacks/useEffects can read the latest keys without
  // becoming dependencies (which would re-create them on every render).
  const scopedKeysRef = React.useRef<ScopedKeys | null>(scopedKeys);
  scopedKeysRef.current = scopedKeys;

  const [localLoads, setLocalLoadsRaw] = useState<Load[]>([]);
  const localLoadsInitRef = React.useRef(false);

  // Wrap setLocalLoads to auto-persist (uses the active driver's scoped key)
  const setLocalLoads = React.useCallback((updater: Load[] | ((prev: Load[]) => Load[])) => {
    setLocalLoadsRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const key = scopedKeysRef.current?.localLoads;
      if (key) debouncedAsyncWrite(key, JSON.stringify(next));
      return next;
    });
  }, []);

  // Platform loads fetched from company platform
  const [platformLoads, setPlatformLoadsRaw] = useState<Load[]>([]);
  const platformLoadsHydratedRef = React.useRef(false);
  // Mirror of the latest committed platformLoads — read by doFetchLoads so
  // the downgrade-detection pass doesn't have to use a no-op functional
  // updater to peek at the current state.
  const platformLoadsRef = React.useRef<Load[]>([]);
  React.useEffect(() => {
    platformLoadsRef.current = platformLoads;
  }, [platformLoads]);

  // Wrap setPlatformLoads to auto-persist on every change.
  // Previously only a handful of call sites persisted, which meant saving a
  // delivery/pickup inspection updated memory only — if the OS killed the app
  // before the next doFetchLoads() ran, those photos + damages were lost.
  const setPlatformLoads = React.useCallback(
    (updater: Load[] | ((prev: Load[]) => Load[])) => {
      setPlatformLoadsRaw((prev) => {
        const next = typeof updater === "function" ? (updater as (p: Load[]) => Load[])(prev) : updater;
        const key = scopedKeysRef.current?.platformLoads;
        if (platformLoadsHydratedRef.current && key) {
          debouncedAsyncWrite(key, JSON.stringify(next));
        }
        return next;
      });
    },
    []
  );

  // ── Server-fetched delivered loads (platform v3.5.0+) ────────────────────
  // Authoritative history of delivered legs from `getDeliveredLoads`.
  // Replaces our long-time reliance on local AsyncStorage `deliveredSnapshots`
  // for the Delivered tab. We still keep snapshots as an instant-render
  // cache for offline / pre-fetch / mid-flight Mark Delivered taps, but
  // anything in this list is authoritative.
  const [serverDeliveredLoads, setServerDeliveredLoadsRaw] = useState<Load[]>([]);
  const serverDeliveredLoadsHydratedRef = React.useRef(false);
  const serverDeliveredLoadsRef = React.useRef<Load[]>([]);
  React.useEffect(() => {
    serverDeliveredLoadsRef.current = serverDeliveredLoads;
  }, [serverDeliveredLoads]);

  const setServerDeliveredLoads = React.useCallback(
    (updater: Load[] | ((prev: Load[]) => Load[])) => {
      setServerDeliveredLoadsRaw((prev) => {
        const next = typeof updater === "function" ? (updater as (p: Load[]) => Load[])(prev) : updater;
        const key = scopedKeysRef.current?.serverDeliveredLoads;
        if (serverDeliveredLoadsHydratedRef.current && key) {
          debouncedAsyncWrite(key, JSON.stringify(next));
        }
        return next;
      });
    },
    []
  );

  // Closure over scopedKeysRef — replaces module-level persistDeliveredImmediate.
  // Always writes to the *current* driver's scoped key; callers don't need to
  // pass the key in.
  const persistDeliveredImmediate = React.useCallback((ids: string[], snapshots: Load[]) => {
    const key = scopedKeysRef.current?.driverDelivered;
    if (!key) return;
    AsyncStorage.setItem(key, JSON.stringify({ ids, snapshots })).catch((err) =>
      console.warn("[Loads] Failed to persist delivered data:", err),
    );
  }, []);
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

  // Load persisted sync queue on startup AND whenever the active driver
  // swaps. The reset effect below clears in-memory state first, so this
  // pulls the queue belonging to the new driver only.
  useEffect(() => {
    if (!scopedKeys) {
      setSyncQueue([]);
      return;
    }
    AsyncStorage.getItem(scopedKeys.platformSyncQueue).then((val) => {
      if (val) {
        try {
          const tasks = JSON.parse(val) as PlatformSyncTask[];
          if (tasks.length > 0) {
            // v71+: on cold launch, automatically reset any task that hit
            // `failed_permanent` more than 1 hour ago back to `pending`
            // with attempts=0. The most common cause of failed_permanent
            // in practice is a transient platform outage (validator drift,
            // dev-tier deploy lag, network blip during 5 consecutive
            // retries). The platform usually recovers within minutes; an
            // hour later we should optimistically try again. Worst case
            // it fails 5 more times and goes back to failed_permanent.
            // Best case the platform issue is fixed and the inspection
            // photos land on dispatch without the driver having to tap
            // "Retry All" in their Profile.
            const ONE_HOUR_MS = 60 * 60 * 1000;
            const now = Date.now();
            let resetCount = 0;
            const healed = tasks.map((t) => {
              if (t.status !== "failed_permanent") return t;
              if (now - t.createdAt < ONE_HOUR_MS) return t;
              resetCount++;
              return {
                ...t,
                status: "pending" as PlatformSyncTaskStatus,
                attempts: 0,
                lastError: undefined,
              };
            });
            if (resetCount > 0) {
              console.log(
                `[PlatformSync] Cold-launch heal: reset ${resetCount} failed_permanent task(s) (older than 1h) for ${driverCode}`,
              );
              AsyncStorage.setItem(
                scopedKeys.platformSyncQueue,
                JSON.stringify(healed),
              ).catch(() => {});
            }
            console.log(`[PlatformSync] Loaded ${healed.length} pending task(s) from storage for ${driverCode}`);
            setSyncQueue(healed);
          } else {
            setSyncQueue([]);
          }
        } catch { /* ignore corrupt data */ }
      } else {
        setSyncQueue([]);
      }
    }).catch(() => {});
  }, [scopedKeys, driverCode]);

  const persistSyncQueue = useCallback((tasks: PlatformSyncTask[]) => {
    const key = scopedKeysRef.current?.platformSyncQueue;
    if (!key) return;
    AsyncStorage.setItem(key, JSON.stringify(tasks)).catch(() => {});
  }, []);

  /**
   * v71+: every photoQueue change is also our cue to scan deferred
   * syncInspection tasks and check whether their watched clientIds have all
   * reached HTTPS. Each task that has resolved gets flipped back to
   * `status: "pending"`, which lets the main processing effect pick it up
   * on the next pass. Tasks that are still partial stay deferred — no
   * empty/partial photos[] array ever leaves the queue.
   */
  const promoteDeferredSyncTasks = useCallback(() => {
    setSyncQueue((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (t.status !== "deferred") return t;
        if (t.type !== "syncInspection") {
          // Non-syncInspection tasks shouldn't be deferred — promote
          // defensively if we ever see one.
          changed = true;
          return { ...t, status: "pending" as PlatformSyncTaskStatus };
        }
        const ids = (t.args as { photoClientIds?: unknown }).photoClientIds;
        if (!Array.isArray(ids) || ids.length === 0) {
          changed = true;
          return { ...t, status: "pending" as PlatformSyncTaskStatus };
        }
        // A deferred task is ready to fire when NO clientId is still
        // sitting at a file:// URI (i.e. still uploading). Pruned/missing
        // entries (bestUriFor → null) are treated as accepted loss — the
        // processing pass will warn about them, but they don't block the
        // remaining HTTPS photos from reaching the platform.
        const stillPending = (ids as string[]).some((id) => {
          const uri = photoQueue.bestUriFor(id);
          return uri !== null && !uri.startsWith("http");
        });
        if (!stillPending) {
          changed = true;
          return { ...t, status: "pending" as PlatformSyncTaskStatus };
        }
        return t;
      });
      if (!changed) return prev;
      persistSyncQueue(next);
      return next;
    });
  }, [persistSyncQueue]);

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
    // Only process pending tasks. Failed-permanent tasks stay in the queue
    // for visibility / manual retry but don't auto-retry. Deferred tasks
    // (v71+: photo-deferred syncInspection) wait for the photoQueue
    // subscription to promote them back to pending when their uploads
    // finish — see promoteDeferredSyncTasks below.
    const pendingTasks = syncQueue.filter(
      (t) => t.status !== "failed_permanent" && t.status !== "deferred",
    );
    if (pendingTasks.length === 0) return;
    syncProcessingRef.current = true;

    // CRITICAL: snapshot the IDs of tasks we're processing on this pass.
    // Without this, any task queued WHILE this pass is awaiting a network
    // call would be silently wiped by the final setSyncQueue(remaining)
    // call below, because that closure-bound `syncQueue` is the snapshot
    // taken when the effect first ran. This was the root cause of the
    // "marked picked up locally but platform still shows assigned" bug
    // when drivers tapped Pick Up on multiple vehicles in succession.
    const processingSnapshot = pendingTasks;
    const processingIds = new Set(processingSnapshot.map((t) => t.id));

    (async () => {
      const remaining: PlatformSyncTask[] = [];
      const permanentlyFailed: PlatformSyncTask[] = [];
      // v71+: tasks whose `photoClientIds` haven't all resolved to HTTPS yet
      // are kept in the queue without incrementing `attempts` or running
      // any network call. They re-evaluate on the next queue tick (which is
      // triggered by the photo-queue subscription whenever an upload status
      // changes — see the kick at the end of the backfill effect below).
      const deferred: PlatformSyncTask[] = [];
      for (const task of processingSnapshot) {
        try {
          console.log(`[PlatformSync] Processing ${task.type} (attempt ${task.attempts + 1})`);
          if (task.type === "markAsPickedUp") {
            await markAsPickedUpAction(task.args as any);
          } else if (task.type === "markAsDelivered") {
            await markAsDeliveredAction(task.args as any);
            // Platform has confirmed delivery — force the local state to
            // "delivered" too. This closes the loop so a successful platform
            // delivery deterministically pulls the driver's screen out of
            // "Picked Up" even if the original local stamp was lost
            // (e.g. due to a remount or kill before AsyncStorage settled).
            const legId = (task.args as { legId?: number | string }).legId;
            if (legId !== undefined && legId !== null) {
              const loadId = `platform-${legId}`;
              const deliveredAt = new Date().toISOString();
              driverDeliveredRef.current.add(loadId);
              localStatusOverridesRef.current.set(loadId, { status: "delivered", at: Date.now() });
              persistOverrides();
              const stampFn = (prev: Load[]) =>
                prev.map((l) =>
                  l.id === loadId
                    ? {
                        ...l,
                        status: "delivered" as LoadStatus,
                        deliveredAt: l.deliveredAt ?? deliveredAt,
                        delivery: { ...l.delivery, date: l.delivery.date || deliveredAt },
                      }
                    : l,
                );
              setLocalLoads(stampFn);
              setPlatformLoads(stampFn);
              setDeliveredSnapshots((prev) => {
                const stamped = prev.map((s) =>
                  s.id === loadId
                    ? {
                        ...s,
                        status: "delivered" as LoadStatus,
                        deliveredAt: s.deliveredAt ?? deliveredAt,
                        delivery: { ...s.delivery, date: s.delivery.date || deliveredAt },
                      }
                    : s,
                );
                persistDeliveredImmediate([...driverDeliveredRef.current], stamped);
                return stamped;
              });
            }
          } else if (task.type === "syncInspection") {
            // v71+: photo-deferred syncInspection. If the task was queued
            // with a non-empty photoClientIds[], resolve each clientId to a
            // live HTTPS URL via the photo queue. Until ALL of them are
            // HTTPS, hold the task back — we never want an empty/partial
            // photo array to land on the platform, because the platform's
            // last-write-wins semantics can lock that empty array in for
            // the leg.
            const rawArgs = task.args as Record<string, unknown>;
            const photoClientIds = Array.isArray(rawArgs.photoClientIds)
              ? (rawArgs.photoClientIds as string[])
              : null;
            let resolvedPhotos: string[];
            if (photoClientIds && photoClientIds.length > 0) {
              const resolved = photoClientIds.map((id) => photoQueue.bestUriFor(id));
              const httpsOnly = resolved.filter(
                (u): u is string => !!u && u.startsWith("http"),
              );
              // A clientId can resolve to one of three things:
              //   - HTTPS URL → upload finished, include it
              //   - file:// URL → still pending upload, DEFER the task
              //   - null     → entry was removed/pruned from the queue
              //                (user deleted it from the Upload Queue UI, or
              //                pruning ran after >1h with no inspection
              //                referencing it). Treat as a lost photo —
              //                skip it but don't block the task forever.
              const stillPending = resolved.some(
                (u) => u !== null && !u.startsWith("http"),
              );
              if (stillPending) {
                const newDeferCount = (task.deferCount ?? 0) + 1;
                if (newDeferCount === 1 || newDeferCount % 10 === 0) {
                  console.log(
                    `[PlatformSync] syncInspection deferred (${httpsOnly.length}/${photoClientIds.length} HTTPS; deferCount=${newDeferCount})`,
                  );
                }
                deferred.push({
                  ...task,
                  status: "deferred" as PlatformSyncTaskStatus,
                  deferCount: newDeferCount,
                });
                continue;
              }
              const lostCount = resolved.filter((u) => u === null).length;
              if (lostCount > 0) {
                console.warn(
                  `[PlatformSync] syncInspection has ${lostCount} pruned/missing clientId(s) — firing with ${httpsOnly.length}/${photoClientIds.length} photos`,
                );
              }
              resolvedPhotos = httpsOnly;
            } else {
              resolvedPhotos = Array.isArray(rawArgs.photos)
                ? (rawArgs.photos as string[]).filter(
                    (p): p is string => typeof p === "string" && p.startsWith("http"),
                  )
                : [];
            }
            // Strip the app-only `photoClientIds` and rebuild a clean args
            // object for the Convex action — Convex validates strictly and
            // would reject an unknown field.
            const { photoClientIds: _omitClientIds, ...cleanArgs } = rawArgs;
            const finalArgs = {
              ...cleanArgs,
              photos: resolvedPhotos,
              photoUploadedCount: resolvedPhotos.length,
              // Preserve any caller-provided expected count, else fall back
              // to the clientId list length when present, else the resolved
              // count. This keeps the platform progress bar accurate.
              photoExpectedCount:
                typeof rawArgs.photoExpectedCount === "number"
                  ? rawArgs.photoExpectedCount
                  : photoClientIds?.length ?? resolvedPhotos.length,
            };
            await syncInspectionAction(finalArgs as any);
          }
          console.log(`[PlatformSync] ${task.type} succeeded`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[PlatformSync] ${task.type} failed (attempt ${task.attempts + 1}):`, errMsg);
          const maxAttempts = 5;
          if (task.attempts + 1 < maxAttempts) {
            remaining.push({
              ...task,
              attempts: task.attempts + 1,
              lastError: errMsg,
            });
          } else {
            console.error(`[PlatformSync] ${task.type} permanently failed after ${maxAttempts} attempts`, task);
            // Keep failed-permanent tasks in the queue (status=failed_permanent)
            // so they can be inspected by the user / retried manually instead
            // of being silently dropped.
            permanentlyFailed.push({
              ...task,
              attempts: task.attempts + 1,
              status: "failed_permanent",
              lastError: errMsg,
            });
          }
        }
      }

      // CRITICAL: functional updater — keep ANY task that was queued while
      // we were processing (i.e., not in our processingIds snapshot), then
      // append our retry list, any permanently-failed tasks, AND any v71+
      // photo-deferred tasks (still waiting on uploads). This closes the
      // race where bursts of queuePlatformSync calls during a network
      // round-trip would be wiped by an overwriting setSyncQueue.
      setSyncQueue((current) => {
        const queuedDuringProcessing = current.filter((t) => !processingIds.has(t.id));
        const merged = [
          ...queuedDuringProcessing,
          ...deferred,
          ...remaining,
          ...permanentlyFailed,
        ];
        persistSyncQueue(merged);
        return merged;
      });
      syncProcessingRef.current = false;
    })();
  }, [syncQueue, markAsPickedUpAction, markAsDeliveredAction, syncInspectionAction, persistSyncQueue, setLocalLoads, setPlatformLoads]);

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

  // ── Photo backfill: swap local URIs → HTTPS in inspection records ─────────
  //
  // Background uploads for individual photos can finish AFTER the driver
  // taps Complete Pickup / Save Inspection. When that happens we need to:
  //   1. Replace the local file path in inspection.photos with the HTTPS
  //      URL (keeps both views — app + platform — pointing at the same
  //      asset and protects against eventual local-file cleanup).
  //   2. Re-queue syncInspection with the now-complete HTTPS list so the
  //      company platform receives every photo, not just the ones that
  //      raced to upload before the driver hit "Complete Pickup".
  //
  // This is the safety net for a partial-upload scenario where the driver
  // is on flaky cell service: every photo will eventually land on R2 and
  // every inspection record (local + platform) gets patched as it does.
  const fullySyncedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runBackfill = () => {
      const swapMap = new Map<string, string>();
      for (const e of photoQueue.getEntries()) {
        if (e.remoteUrl && e.remoteUrl.startsWith("http")) {
          swapMap.set(e.localUri, e.remoteUrl);
        }
      }
      // v70+: do NOT bail when swapMap is empty. An inspection whose
      // photos[] is already 100% HTTPS (because uploads finished
      // before the inspection record was first saved — the common
      // Wi-Fi case via `bestUriFor` in camera-session) still needs
      // its syncInspection trigger evaluated. Without this, the
      // backfill stayed a no-op and the platform never received an
      // inspection submission for those legs.

      type CompletedRecord = {
        load: Load;
        vehicle: import("./data").Vehicle;
        type: "pickup" | "delivery";
        inspection: VehicleInspection;
      };
      const completed: CompletedRecord[] = [];

      const swapInsp = (
        l: Load,
        v: import("./data").Vehicle,
        type: "pickup" | "delivery",
        insp: VehicleInspection | undefined,
      ): VehicleInspection | undefined => {
        // v71+: reconstruction path. If we have NO inspection record at
        // all, or one whose photos[] array is empty, but the photo queue
        // contains entries tagged with this (loadId, vehicleId, type),
        // we use the queue as the source of truth and try to reconstruct
        // a minimal inspection. This handles the multi-vehicle scenario
        // where an early empty-photos syncInspection landed on the
        // platform, then getAssignedLoads echoed back photos=[], wiping
        // the local file:// URIs that the swap path below would need.
        // Without this, the safety net never fires because there's
        // nothing left to swap.
        const queueEntries = photoQueue.getEntriesForInspection(l.id, v.id, type);
        const queuedHttpsUrls = queueEntries
          .map((e) => e.remoteUrl)
          .filter((u): u is string => !!u && u.startsWith("http"));
        const queueHasAnyPending = queueEntries.some(
          (e) => !e.remoteUrl || !e.remoteUrl.startsWith("http"),
        );
        const queueIsFullyUploaded =
          queueEntries.length > 0 && !queueHasAnyPending;

        if (!insp || insp.photos.length === 0) {
          // No local photos to swap. If the queue says we have uploaded
          // photos for this bucket and nothing pending, queue a
          // syncInspection from the queue's URL list. We don't write a
          // synthesized inspection back to local state — local state
          // stays as-is so the rest of the app (e.g. "X photos uploaded"
          // counters) doesn't lie about what the driver captured.
          if (queueIsFullyUploaded) {
            const key = `${l.id}:${v.id}:${type}`;
            if (!fullySyncedRef.current.has(key)) {
              completed.push({
                load: l,
                vehicle: v,
                type,
                inspection: {
                  vehicleId: v.id,
                  damages: insp?.damages ?? [],
                  noDamage: insp?.noDamage ?? false,
                  photos: queuedHttpsUrls,
                  notes: insp?.notes ?? "",
                  locationLat: insp?.locationLat,
                  locationLng: insp?.locationLng,
                  locationLabel: insp?.locationLabel,
                  additionalInspection: insp?.additionalInspection,
                } as VehicleInspection,
              });
            }
          }
          return insp;
        }

        let changed = false;
        const newPhotos = insp.photos.map((p) => {
          if (p.startsWith("http")) return p;
          const r = swapMap.get(p);
          if (r) {
            changed = true;
            return r;
          }
          return p;
        });
        // v70+: evaluate the syncInspection trigger BEFORE the
        // "no swaps happened" short-circuit. The fullySyncedRef
        // key (now added at queue-time below, not here) prevents
        // duplicate firings within this session; the platform
        // merges additively so a redundant call across sessions
        // is a cheap no-op on the server.
        const effective = changed ? newPhotos : insp.photos;
        const allHttps = effective.every((p) => p.startsWith("http"));
        if (allHttps) {
          const key = `${l.id}:${v.id}:${type}`;
          if (!fullySyncedRef.current.has(key)) {
            // v71+: union with queue-tagged HTTPS URLs that the
            // inspection record may not yet know about (e.g. a photo
            // uploaded after a stale getAssignedLoads merge dropped it
            // from inspection.photos).
            const union = Array.from(
              new Set([...effective, ...queuedHttpsUrls]),
            );
            completed.push({
              load: l,
              vehicle: v,
              type,
              inspection: { ...insp, photos: union },
            });
          }
        }
        if (!changed) return insp;
        return { ...insp, photos: newPhotos };
      };

      const swapLoad = (l: Load): Load => {
        let changed = false;
        const newVehicles = l.vehicles.map((v) => {
          const newPickup = swapInsp(l, v, "pickup", v.pickupInspection);
          const newDelivery = swapInsp(l, v, "delivery", v.deliveryInspection);
          if (newPickup === v.pickupInspection && newDelivery === v.deliveryInspection) {
            return v;
          }
          changed = true;
          return { ...v, pickupInspection: newPickup, deliveryInspection: newDelivery };
        });
        return changed ? { ...l, vehicles: newVehicles } : l;
      };

      setLocalLoads((prev) => {
        const next = prev.map(swapLoad);
        return next.every((l, i) => l === prev[i]) ? prev : next;
      });
      setPlatformLoads((prev) => {
        const next = prev.map(swapLoad);
        return next.every((l, i) => l === prev[i]) ? prev : next;
      });

      if (completed.length === 0) return;
      if (!driverCode) {
        // v71+: log loudly. Pre-v71 this was a silent return that left
        // an inspection ready-to-sync but un-syncable forever. The
        // driverCode is set by AuthProvider on mount; if we see this
        // warning the auth state hasn't hydrated yet — the next
        // photoQueue event will retrigger the backfill.
        console.warn(
          `[Backfill] ${completed.length} inspection(s) fully uploaded but driverCode not yet available — will retry on next photoQueue event`,
        );
        return;
      }
      for (const { load, vehicle, type, inspection } of completed) {
        if (!load.id.startsWith("platform-")) continue;
        const legId = (load as Load & { platformTripId?: number | string }).platformTripId;
        if (legId === undefined || legId === null) {
          // v71+: this used to be a silent `continue`. If a hydrated
          // load is missing platformTripId, the inspection cannot be
          // synced to the platform — we want to know about it.
          console.warn(
            `[Backfill] Skipping ${type} sync for ${load.loadNumber} ${vehicle.vin || "(no VIN)"} — platformTripId missing on load`,
          );
          continue;
        }
        // v70+: mark synced ONLY when we're actually about to queue
        // the call. Prior code added to fullySyncedRef inside the
        // swap loop, which meant a runBackfill pass before
        // driverCode/legId were ready would permanently lock the
        // inspection out of the safety-net without ever shipping it.
        const key = `${load.id}:${vehicle.id}:${type}`;
        if (fullySyncedRef.current.has(key)) continue;
        fullySyncedRef.current.add(key);
        const syncDamages = (inspection.damages ?? []).map((d) => ({
          id: d.id,
          zone: d.zone,
          type: d.type,
          severity: d.severity,
          x: (d as any).xPct != null ? (d as any).xPct / 100 : 0.5,
          y: (d as any).yPct != null ? (d as any).yPct / 100 : 0.5,
          diagramView: (d as any).diagramView,
          note: (d as any).description || undefined,
        }));
        console.log(
          `[Backfill] All ${type} photos uploaded for ${load.loadNumber} ${vehicle.vin} — re-queuing syncInspection with ${inspection.photos.length} URLs`,
        );
        queuePlatformSync({
          type: "syncInspection",
          args: {
            loadNumber: load.loadNumber,
            legId,
            driverCode,
            inspectionType: type,
            vehicleVin: vehicle.vin || "",
            photos: inspection.photos,
            damages: syncDamages,
            noDamage: inspection.noDamage ?? false,
            gps: {
              lat: inspection.locationLat ?? 0,
              lng: inspection.locationLng ?? 0,
            },
            timestamp: new Date().toISOString(),
            notes: inspection.notes || undefined,
            // v69+: backfill only fires when EVERY photo has transitioned
            // to HTTPS for this inspection, so uploaded === expected here.
            // Sending both anyway fills the platform's progress bar to
            // 100% and clears any "still uploading" UI state.
            photoUploadedCount: inspection.photos.length,
            photoExpectedCount: inspection.photos.length,
            ...((inspection as VehicleInspection & { handoffNote?: string }).handoffNote
              ? { handoffNote: (inspection as VehicleInspection & { handoffNote?: string }).handoffNote }
              : {}),
            ...(inspection.additionalInspection
              ? { additionalInspection: inspection.additionalInspection }
              : {}),
          },
        });
      }
    };

    // v65+: also runs queue pruning after each backfill pass.
    // We collect every HTTPS URL currently referenced by any inspection
    // record across all known loads (active + delivered snapshots), then
    // pass those to `photoQueue.pruneDoneEntries` so it can safely drop
    // done+stamped entries that nothing references anymore. Without this
    // the queue grows by ~1 entry per photo capture forever — drivers
    // were hitting 11k entries / ~10 MB AsyncStorage payloads and the
    // queue file write was blocking the JS thread on every status
    // change. See v64 incident notes.
    let pruneTimer: ReturnType<typeof setTimeout> | null = null;
    const schedulePrune = () => {
      if (pruneTimer) return;
      pruneTimer = setTimeout(() => {
        pruneTimer = null;
        try {
          const referenced = new Set<string>();
          const collectFromLoad = (l: Load) => {
            for (const v of l.vehicles) {
              for (const ins of [v.pickupInspection, v.deliveryInspection, v.frozenPickupInspection]) {
                if (!ins) continue;
                for (const p of ins.photos) {
                  if (p && p.startsWith("http")) referenced.add(p);
                }
              }
            }
          };
          platformLoadsRef.current.forEach(collectFromLoad);
          // Local loads + delivered snapshots — read via setter functional
          // form to grab current state without forcing a re-render. We can't
          // safely use a ref here for localLoads because the setter wraps
          // persistence and the ref isn't being updated, so just inspect
          // both. (deliveredSnapshotsRef and localLoadsRef don't exist; reading
          // by passing a no-op updater is cheap.)
          setLocalLoads((prev) => {
            prev.forEach(collectFromLoad);
            return prev;
          });
          setDeliveredSnapshots((prev) => {
            prev.forEach(collectFromLoad);
            return prev;
          });
          // v71+: ALSO mark every clientId referenced by a deferred or
          // pending syncInspection task as "still needed" by resolving its
          // current bestUriFor and adding that to the reference set. Without
          // this guard, the prune pass could (after 1+ hour) drop a done+
          // stamped queue entry that an inspection's local photos[] array
          // no longer points at (because of the platform-echo wipe we just
          // fixed in swapInsp). Once dropped, the deferred task's clientId
          // resolves to null forever and the inspection never syncs.
          setSyncQueue((prev) => {
            for (const t of prev) {
              if (t.type !== "syncInspection") continue;
              const ids = (t.args as { photoClientIds?: unknown }).photoClientIds;
              if (!Array.isArray(ids)) continue;
              for (const id of ids as string[]) {
                if (typeof id !== "string" || !id) continue;
                const uri = photoQueue.bestUriFor(id);
                if (uri && uri.startsWith("http")) referenced.add(uri);
              }
            }
            return prev;
          });

          photoQueue.pruneDoneEntries(referenced).catch((err) => {
            console.warn("[Prune] pruneDoneEntries failed:", err);
          });
        } catch (err) {
          console.warn("[Prune] failed:", err);
        }
      }, 30_000);
    };

    const unsub = photoQueue.subscribe(() => {
      // Debounce so a burst of upload completions coalesces into one pass.
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        try {
          runBackfill();
          schedulePrune();
          // v71+: every photo-queue change is also our cue to promote any
          // photo-deferred syncInspection tasks whose clientIds have all
          // resolved to HTTPS. Promoted tasks flip back to "pending" and
          // the main processing useEffect picks them up on the next
          // syncQueue mutation.
          promoteDeferredSyncTasks();
        } catch (err) {
          console.warn("[Backfill] failed:", err);
        }
      }, 1500);
    });

    return () => {
      if (timer) clearTimeout(timer);
      if (pruneTimer) clearTimeout(pruneTimer);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverCode, queuePlatformSync, setLocalLoads, setPlatformLoads, promoteDeferredSyncTasks]);

  // ── Driver-delivered tracking ─────────────────────────────────────────────
  // Set of load IDs that the driver explicitly marked as delivered.
  // These survive platform sync so the load stays in the Delivered tab.
  const driverDeliveredRef = React.useRef<Set<string>>(new Set());
  // Full Load snapshots for delivered loads that the platform may have
  // removed from the driver's assignment list (e.g. reassigned to next leg).
  const [deliveredSnapshots, setDeliveredSnapshots] = useState<Load[]>([]);

  // v63 repair: undo the v59-v62 "force delivered" corruption.
  //
  // Background: a pre-v63 bug in doFetchLoads added every dropped picked-up
  // load to driverDeliveredRef, and the loads useMemo then unconditionally
  // forced status="delivered" for any id present in that Set. The previous
  // migrateStuckSnapshots function compounded the damage by RE-WRITING the
  // persisted snapshot's status from picked_up → delivered on every launch.
  //
  // What we know after v63:
  //   - driverDeliveredRef.add() is only called from explicit delivery paths:
  //     markDriverDelivered (driver tap) and the post-success markAsDelivered
  //     processor. Both write the snapshot with status="delivered".
  //   - Therefore: any id in driverDeliveredRef whose snapshot is NOT
  //     status="delivered" is unambiguously legacy corruption. Drop it.
  //
  // We deliberately leave the snapshot itself in deliveredSnapshots — its
  // legitimate status (picked_up, etc.) is preserved so the load can still
  // be displayed and completed via the normal flow.
  const repairLegacyDeliveredCorruption = React.useCallback(
    (ids: string[], snapshots: Load[]): { ids: string[]; changed: boolean } => {
      const snapById = new Map(snapshots.map((s) => [s.id, s]));
      const validIds: string[] = [];
      let changed = false;
      for (const id of ids) {
        const snap = snapById.get(id);
        if (snap && snap.status === "delivered") {
          validIds.push(id);
        } else {
          changed = true;
          console.log(
            `[v63 Repair] Removing corrupted delivered ID ${id} (snapshot status=${snap?.status ?? "missing"})`,
          );
        }
      }
      return { ids: validIds, changed };
    },
    [],
  );

  // Persist the localStatusOverridesRef Map to AsyncStorage. Centralised so
  // every mutation site writes the same shape and we have one place to debug
  // override-persistence issues.
  const persistOverrides = React.useCallback(() => {
    const k = scopedKeysRef.current?.statusOverrides;
    if (!k) return;
    AsyncStorage.setItem(
      k,
      JSON.stringify([...localStatusOverridesRef.current.entries()]),
    ).catch(() => {});
  }, []);

  // Load persisted driver-delivered data when scope (driverCode) becomes
  // available or changes. Legacy unsuffixed keys are migrated by the
  // SCOPE_MIGRATION_FLAG_KEY pass before this fires.
  useEffect(() => {
    if (!scopedKeys) {
      driverDeliveredRef.current = new Set();
      setDeliveredSnapshots([]);
      return;
    }
    (async () => {
      try {
        const atomicVal = await AsyncStorage.getItem(scopedKeys.driverDelivered);
        if (atomicVal) {
          const { ids, snapshots } = JSON.parse(atomicVal) as { ids: string[]; snapshots: Load[] };
          const repaired = repairLegacyDeliveredCorruption(ids, snapshots);
          driverDeliveredRef.current = new Set(repaired.ids);
          setDeliveredSnapshots(snapshots);
          if (repaired.changed) {
            console.log(
              `[v63 Repair] Cleaned ${ids.length - repaired.ids.length} corrupted delivered IDs`,
            );
            persistDeliveredImmediate(repaired.ids, snapshots);
          }
          return;
        }
        // Pre-v60 legacy keys (unsuffixed). Read once, migrate into the
        // current driver's scope, then delete.
        const [legacyIds, legacySnaps] = await Promise.all([
          AsyncStorage.getItem(DRIVER_DELIVERED_KEY),
          AsyncStorage.getItem(DRIVER_DELIVERED_SNAPSHOTS_KEY),
        ]);
        const ids: string[] = legacyIds ? JSON.parse(legacyIds) : [];
        const snapshots: Load[] = legacySnaps ? JSON.parse(legacySnaps) : [];
        if (ids.length > 0 || snapshots.length > 0) {
          const repaired = repairLegacyDeliveredCorruption(ids, snapshots);
          driverDeliveredRef.current = new Set(repaired.ids);
          setDeliveredSnapshots(snapshots);
          persistDeliveredImmediate(repaired.ids, snapshots);
          AsyncStorage.multiRemove([DRIVER_DELIVERED_KEY, DRIVER_DELIVERED_SNAPSHOTS_KEY]).catch(() => {});
        }
      } catch { /* ignore */ }
    })();
  }, [scopedKeys, repairLegacyDeliveredCorruption, persistDeliveredImmediate]);

  // Load persisted status overrides when scope becomes available
  useEffect(() => {
    if (!scopedKeys) {
      localStatusOverridesRef.current = new Map();
      return;
    }
    AsyncStorage.getItem(scopedKeys.statusOverrides).then((val) => {
      if (val) {
        try {
          const entries = JSON.parse(val) as [string, { status: LoadStatus; at: number }][];
          localStatusOverridesRef.current = new Map(entries);
        } catch { /* ignore corrupt data */ }
      } else {
        localStatusOverridesRef.current = new Map();
      }
    }).catch(() => {});
  }, [scopedKeys]);

  // Load persisted local (non-platform) loads when the scope becomes
  // available or changes. We never seed demo/mock data — production drivers
  // should only ever see real loads.
  useEffect(() => {
    localLoadsInitRef.current = false;
    (async () => {
      const key = scopedKeys?.localLoads;
      if (!key) {
        setLocalLoadsRaw([]);
        localLoadsInitRef.current = true;
        return;
      }
      const cached = await AsyncStorage.getItem(key).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Load[];
          // Defensive filter — strip out any pre-v53 MOCK_LOADS residue that
          // may still be persisted under this scope from an older build.
          const cleaned = parsed.filter((l) => !MOCK_LOAD_IDS.has(l.id));
          setLocalLoadsRaw(cleaned);
          if (cleaned.length !== parsed.length) {
            AsyncStorage.setItem(key, JSON.stringify(cleaned)).catch(() => {});
          }
        } catch {
          setLocalLoadsRaw([]);
        }
      } else {
        setLocalLoadsRaw([]);
      }
      localLoadsInitRef.current = true;
    })();
  }, [scopedKeys]);

  // One-shot purge of any MOCK_LOADS residue persisted by pre-v53 builds.
  // Sweeps the legacy unscoped key plus every per-driver scoped key in
  // AsyncStorage. Runs once per install (gated by MOCK_PURGE_FLAG_KEY).
  useEffect(() => {
    (async () => {
      try {
        const done = await AsyncStorage.getItem(MOCK_PURGE_FLAG_KEY);
        if (done === "1") return;
        const allKeys = await AsyncStorage.getAllKeys();
        const localLoadsKeys = allKeys.filter((k) => k.startsWith(LOADS_STORAGE_BASE));
        for (const k of localLoadsKeys) {
          const raw = await AsyncStorage.getItem(k).catch(() => null);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as Load[];
            const cleaned = parsed.filter((l) => !MOCK_LOAD_IDS.has(l.id));
            if (cleaned.length !== parsed.length) {
              await AsyncStorage.setItem(k, JSON.stringify(cleaned)).catch(() => {});
              console.log(`[Loads] Purged ${parsed.length - cleaned.length} mock load(s) from ${k}`);
            }
          } catch { /* corrupt cache, skip */ }
        }
        // Retire the pre-v53 demo-cleared flag — it's no longer read.
        AsyncStorage.removeItem("@autohaul:demo_cleared").catch(() => {});
        AsyncStorage.setItem(MOCK_PURGE_FLAG_KEY, "1").catch(() => {});
      } catch { /* ignore */ }
    })();
  }, []);

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
  const fetchDeliveredLoadsAction = useAction(api.platform.getDeliveredLoads);
  const markAsPickedUpAction = useAction(api.platform.markAsPickedUp);
  const markAsDeliveredAction = useAction(api.platform.markAsDelivered);
  const syncInspectionAction = useAction(api.platform.syncInspection);
  const isFetchingRef = React.useRef(false);
  const isFetchingDeliveredRef = React.useRef(false);
  const lastDeliveredFetchAtRef = React.useRef(0);
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

      // Diagnostic for the "all loads disappeared" failure mode (driver
      // deactivated, every load archived, etc.). Pre-v63 this would silently
      // promote every picked-up leg to "delivered"; v63 keeps statuses
      // intact, but the log helps us spot dispatcher actions that the
      // platform's v3.4.5 webhook will eventually surface explicitly.
      const previousCount = platformLoadsRef.current.length;
      if (previousCount > 0 && geocoded.length === 0) {
        const hadPickedUp = platformLoadsRef.current.some((l) => l.status === "picked_up");
        const hadDelivered = platformLoadsRef.current.some((l) => l.status === "delivered");
        console.warn(
          `[Loads] getAssignedLoads returned 0 results (previous=${previousCount}; pickedUp=${hadPickedUp}; delivered=${hadDelivered}). ` +
            `Possible dispatcher action: driver deactivated, loads archived, or temporarily reassigned.`,
        );
      }

      // ── Downgrade detection ─────────────────────────────────────────────
      //
      // The platform team confirmed dispatchers can legitimately downgrade
      // a leg via two paths:
      //   • reverseLegCompletion: delivered → picked_up (pickup data is
      //     PRESERVED on the server, only delivery fields wiped)
      //   • revertPickup: picked_up/delivered → assigned/pending (BOTH
      //     pickup AND delivery fields wiped on the server)
      //
      // We must respect those reverts on the next poll. Pre-v63 the code
      // refused all downgrades, which kept the driver app permanently out
      // of sync. v63: allow downgrades when:
      //   1. No platform-sync task is currently in-flight for this leg
      //      (otherwise we'd race a legitimate tap that hasn't fired yet)
      //   2. No local override is fresher than RECENT_OVERRIDE_MS — a
      //      recently-tapped status hasn't had time to land on the platform
      //
      // Both guards keep us from treating a slow round-trip as a revert.
      const RECENT_OVERRIDE_MS = 2 * 60 * 1000;
      const inFlightLegIds = new Set(
        syncQueueRef.current
          .filter((t) => t.type === "markAsPickedUp" || t.type === "markAsDelivered")
          .map((t) => String((t.args as { legId?: number | string }).legId))
          .filter((s) => s !== "undefined" && s !== "null"),
      );
      type DowngradeReason = "delivery_reversed" | "pickup_reverted";
      const downgradeMap = new Map<string, { reason: DowngradeReason; freshStatus: LoadStatus }>();
      const previousPlatformLoads = platformLoadsRef.current;
      for (const fresh of geocoded) {
        const existing = previousPlatformLoads.find((p) => p.id === fresh.id);
        if (!existing) continue;
        const freshRank = STATUS_RANK[fresh.status] ?? 0;
        const existingRank = STATUS_RANK[existing.status] ?? 0;
        if (freshRank >= existingRank) continue;
        // Platform is BEHIND local. Apply guards.
        const legIdRaw = (fresh as Load & { platformTripId?: number | string }).platformTripId;
        if (legIdRaw !== undefined && legIdRaw !== null && inFlightLegIds.has(String(legIdRaw))) {
          continue; // sync mid-flight; queue will catch the platform up
        }
        const override = localStatusOverridesRef.current.get(fresh.id);
        if (override && Date.now() - override.at < RECENT_OVERRIDE_MS) {
          continue; // recent local tap; give the queue time to settle
        }
        // Approved downgrade — diagnose which kind.
        let reason: DowngradeReason;
        if (existing.status === "delivered" && fresh.status === "picked_up") {
          reason = "delivery_reversed";
        } else {
          reason = "pickup_reverted";
        }
        downgradeMap.set(fresh.id, { reason, freshStatus: fresh.status });
        console.warn(
          `[Downgrade] ${fresh.loadNumber} (id=${fresh.id}): ${existing.status} → ${fresh.status} (${reason})`,
        );
      }

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

          const freshRank = STATUS_RANK[freshStatus] ?? 0;
          const existingRank = STATUS_RANK[existingStatus] ?? 0;

          if (freshRank > existingRank) return freshStatus;
          if (freshRank === existingRank) return existingStatus;

          // freshRank < existingRank: only honour the downgrade if it was
          // approved by the dispatcher-revert detection above. Otherwise
          // hold the existing higher status (handles slow round-trips).
          if (downgradeMap.has(loadId)) return freshStatus;
          return existingStatus;
        };

        return geocoded.map((l) => {
          const existing = prev.find((p) => p.id === l.id);
          const loadInsps = inspectionMap.get(l.id);
          const mergedStatus = resolveStatus(l.id, l.status, existing?.status);
          const dr = downgradeMap.get(l.id);
          // Pickup-data preservation rule (per platform team):
          //   delivery_reversed → keep pickup, drop delivery
          //   pickup_reverted   → server wiped pickup AND delivery; drop both
          const restorePickup = dr?.reason !== "pickup_reverted";
          const restoreDelivery = dr === undefined;

          return {
            ...l,
            status: mergedStatus,
            deliveredAt: dr ? undefined : (existing?.deliveredAt ?? l.deliveredAt),
            ...(existing && !dr && (mergedStatus === "picked_up" || mergedStatus === "delivered" || mergedStatus === "archived")
              ? { pickup: { ...l.pickup, date: existing.pickup.date } }
              : {}),
            ...(existing && dr?.reason === "delivery_reversed"
              ? { pickup: { ...l.pickup, date: existing.pickup.date } }
              : {}),
            ...(existing && !dr && (mergedStatus === "delivered" || mergedStatus === "archived")
              ? { delivery: { ...l.delivery, date: existing.delivery.date } }
              : {}),
            vehicles: l.vehicles.map((v) => {
              const saved = loadInsps?.get(v.id);
              if (!saved) return v;
              return {
                ...v,
                ...(saved.pickup && restorePickup ? { pickupInspection: saved.pickup } : {}),
                ...(saved.delivery && restoreDelivery ? { deliveryInspection: saved.delivery } : {}),
                ...(saved.frozen && restorePickup ? { frozenPickupInspection: saved.frozen } : {}),
              };
            }),
          };
        });
      });
      setLastSyncedAt(new Date());
      setPlatformLoads((current) => {
        const k = scopedKeysRef.current?.platformLoads;
        if (k) debouncedAsyncWrite(k, JSON.stringify(current));
        return current;
      });

      // ── Apply downgrade side-effects on local state ─────────────────────
      if (downgradeMap.size > 0) {
        for (const [loadId, dg] of downgradeMap.entries()) {
          driverDeliveredRef.current.delete(loadId);
          if (dg.reason === "pickup_reverted") {
            // Server wiped everything — clear the override entirely so the
            // load is once again a clean "assigned" entry.
            localStatusOverridesRef.current.delete(loadId);
          } else {
            // delivery_reversed — roll the override back to picked_up so
            // the driver can immediately re-deliver if dispatch wanted that.
            localStatusOverridesRef.current.set(loadId, { status: "picked_up", at: Date.now() });
          }
        }
        persistOverrides();

        // Mirror the wipe on localLoads (handles loads that exist in both
        // localLoads and platformLoads, plus surfaces the change in any
        // cached views derived from localLoads).
        const applyDowngrade = (prev: Load[]) =>
          prev.map((l) => {
            const dg = downgradeMap.get(l.id);
            if (!dg) return l;
            return {
              ...l,
              status: dg.freshStatus,
              deliveredAt: undefined,
              ...(dg.reason === "pickup_reverted"
                ? {
                    pickup: { ...l.pickup, date: "" },
                    delivery: { ...l.delivery, date: "" },
                  }
                : {
                    delivery: { ...l.delivery, date: "" },
                  }),
              vehicles: l.vehicles.map((v) =>
                dg.reason === "pickup_reverted"
                  ? {
                      ...v,
                      pickupInspection: undefined,
                      deliveryInspection: undefined,
                      frozenPickupInspection: undefined,
                    }
                  : { ...v, deliveryInspection: undefined },
              ),
            };
          });
        setLocalLoads(applyDowngrade);

        // Drop these loads from deliveredSnapshots — the platform owns them
        // again, no need for a frozen copy.
        setDeliveredSnapshots((prev) => {
          const filtered = prev.filter((s) => !downgradeMap.has(s.id));
          if (filtered.length !== prev.length) {
            persistDeliveredImmediate([...driverDeliveredRef.current], filtered);
            return filtered;
          }
          return prev;
        });
      }

      // Snapshot any picked-up loads that were dropped from the platform
      // response so the driver can still complete the delivery flow even if
      // dispatch unassigns / hides / archives the load.
      //
      // CRITICAL (v63 fix): we deliberately do NOT add these IDs to
      // driverDeliveredRef. The pre-v63 code did, and the loads useMemo
      // then unconditionally promoted them to "delivered" — that's the
      // root cause of "Picked Up jumped to Delivered without me touching
      // anything." The Set is reserved for ids the driver (or platform)
      // has explicitly delivered.
      //
      // The snapshot preserves whatever status the load actually had
      // (picked_up). The override map (if set) is used only to prevent a
      // legitimate delivered tap from being demoted back to picked_up by
      // a stale snapshot — never the other way around.
      if (droppedPickedUp.length > 0) {
        setDeliveredSnapshots((prev) => {
          let updated = [...prev];
          for (const l of droppedPickedUp) {
            const override = localStatusOverridesRef.current.get(l.id);
            const existingSnap = updated.find((s) => s.id === l.id);
            const candidateRank = STATUS_RANK[l.status] ?? 0;
            const existingRank = existingSnap ? (STATUS_RANK[existingSnap.status] ?? 0) : -1;
            const overrideRank = override ? (STATUS_RANK[override.status] ?? 0) : -1;
            // Pick the highest-ranking known status so we never demote a
            // previously delivered load (whose driverDeliveredRef entry
            // came from a legitimate path) back to picked_up.
            let bestStatus: LoadStatus = l.status;
            let bestRank = candidateRank;
            if (overrideRank > bestRank) { bestStatus = override!.status; bestRank = overrideRank; }
            if (existingRank > bestRank) { bestStatus = existingSnap!.status; bestRank = existingRank; }
            const snapshot = { ...l, status: bestStatus };
            if (existingSnap) {
              updated = updated.map((s) => (s.id === l.id ? snapshot : s));
            } else {
              updated = [...updated, snapshot];
            }
          }
          persistDeliveredImmediate([...driverDeliveredRef.current], updated);
          return updated;
        });
      }

      // Snapshot cleanup: any non-delivered snapshot whose load reappeared
      // in the platform fetch is now redundant — the platform is the
      // source of truth and the load is already shown via platformLoads.
      // Retain only:
      //   • snapshots whose load is still gone (dropped picked_up)
      //   • delivered snapshots tied to a legitimate driverDeliveredRef entry
      const platformIds = new Set(geocoded.map((l) => l.id));
      setDeliveredSnapshots((prev) => {
        const filtered = prev.filter((s) => {
          if (!platformIds.has(s.id)) return true;
          return s.status === "delivered" && driverDeliveredRef.current.has(s.id);
        });
        if (filtered.length !== prev.length) {
          persistDeliveredImmediate([...driverDeliveredRef.current], filtered);
          return filtered;
        }
        return prev;
      });

      // ──────────────────────────────────────────────────────────────────
      // NOTE: pre-v63 included a "local-ahead-of-platform" auto-recovery
      // that re-queued markAsPickedUp / markAsDelivered when local
      // overrides outranked the fresh platform status. That logic was
      // REMOVED in v63 because it caused the driver app to fight
      // legitimate dispatcher reverts (reverseLegCompletion / revertPickup):
      // the platform team confirmed those are explicit user actions and
      // the only safe response is to honour them locally. The downgrade
      // detection above replaces it. If a real sync-loss ever occurs (a
      // local tap that never made it into the queue), the platform
      // v3.4.4 idempotency on markAsPickedUp + the now-bullet-proof
      // PlatformSyncQueue persistence makes the legitimate retry paths
      // sufficient — proactive re-queueing here was a hammer that broke
      // more than it fixed.
      // ──────────────────────────────────────────────────────────────────
    } catch (err: any) {
      setPlatformLoadError(err?.message ?? "Failed to fetch platform loads");
    } finally {
      setIsLoadingPlatformLoads(false);
      isFetchingRef.current = false;
    }
  }, [driverCode, fetchAssignedLoads, geocodePlatformLoads, persistOverrides, setLocalLoads, setPlatformLoads]);

  // Poll every 30s while the app is open
  useEffect(() => {
    if (!driverCode || driverCode.length < 7) return;
    doFetchLoads();
    pollRef.current = setInterval(doFetchLoads, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [driverCode, doFetchLoads]);

  // ── Fetch delivered loads from the platform (v3.5.0+) ────────────────────
  // Authoritative source for the Delivered tab. Pulled less aggressively
  // than `getAssignedLoads` because delivered records change slowly and
  // the response can be much larger.
  //
  // `force=false` will short-circuit if a fetch ran in the last 60s
  // (e.g. so re-foregrounding the app a few seconds later doesn't double-fire).
  const doFetchDeliveredLoads = useCallback(
    async (force = false) => {
      if (!driverCode || driverCode.length < 7) return;
      if (isFetchingDeliveredRef.current) return;
      const now = Date.now();
      if (!force && now - lastDeliveredFetchAtRef.current < 60_000) return;
      isFetchingDeliveredRef.current = true;
      try {
        // Default 60-day window (matches platform default; making it explicit
        // here means a future platform default change won't silently shrink
        // the driver's history).
        const sinceISO = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
        const raw = (await fetchDeliveredLoadsAction({
          driverCode,
          sinceISO,
          limit: 200,
        })) as PlatformLoad[] | null | undefined;
        if (!Array.isArray(raw)) return;

        const converted = raw.map(platformLoadToLoad);
        // Geocode any missing coords (shouldn't be many — the platform
        // generally has these — but the helper is cheap and covers
        // legacy rows).
        const geocoded = await geocodePlatformLoads(converted);

        // Force status to "delivered" defensively. Server already does this
        // but we don't trust client/server enums to stay in lockstep forever.
        const normalized = geocoded.map((l) => ({
          ...l,
          status: "delivered" as LoadStatus,
        }));

        setServerDeliveredLoads(normalized);
        lastDeliveredFetchAtRef.current = Date.now();
      } catch (err) {
        // Non-fatal — we keep the cached snapshot. The Delivered tab
        // continues to render the previous response.
        console.warn(
          "[getDeliveredLoads] Failed to fetch delivered loads:",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        isFetchingDeliveredRef.current = false;
      }
    },
    [driverCode, fetchDeliveredLoadsAction, geocodePlatformLoads, setServerDeliveredLoads],
  );

  // Initial fetch + slow background refresh (every 5 minutes). Delivered
  // loads change much less often than active legs so polling at the
  // assigned-loads cadence would be wasteful.
  useEffect(() => {
    if (!driverCode || driverCode.length < 7) return;
    doFetchDeliveredLoads(true);
    const interval = setInterval(() => {
      doFetchDeliveredLoads(false);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [driverCode, doFetchDeliveredLoads]);

  // Refresh loads immediately when the app returns to the foreground
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active" && appStateRef.current !== "active") {
        doFetchLoads();
        // Also pull delivered history — a dispatcher may have completed
        // a leg from the web while the driver had the app backgrounded.
        doFetchDeliveredLoads(false);
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [doFetchLoads, doFetchDeliveredLoads]);

  // Load persisted platform loads on startup (before API responds)
  // Wait for geocache to be loaded from AsyncStorage first (geocacheReady)
  // so we can use cached coordinates instead of re-fetching from Nominatim
  useEffect(() => {
    if (!geocacheReady) return; // wait for geocache to load first
    // Disable auto-persist while we (re)hydrate — otherwise the empty initial
    // state from setPlatformLoadsRaw would clobber the very data we're loading.
    platformLoadsHydratedRef.current = false;
    if (!scopedKeys) {
      setPlatformLoadsRaw([]);
      platformLoadsHydratedRef.current = true;
      return;
    }
    (async () => {
      // First-pull migration: copy pre-v60 unsuffixed data into this scope
      // (no-op after the first run, see SCOPE_MIGRATION_FLAG_KEY).
      await migrateUnsuffixedToScope(scopedKeys);

      try {
        const val = await AsyncStorage.getItem(scopedKeys.platformLoads);
        if (val) {
          const cached = JSON.parse(val) as Load[];
          const needsGeo = cached.some(
            (l) => (!l.pickup.lat || !l.pickup.lng) || (!l.delivery.lat || !l.delivery.lng)
          );
          if (needsGeo) {
            const geocoded = await geocodePlatformLoads(cached);
            setPlatformLoadsRaw(geocoded);
            debouncedAsyncWrite(scopedKeys.platformLoads, JSON.stringify(geocoded));
          } else {
            setPlatformLoadsRaw(cached);
          }
        } else {
          setPlatformLoadsRaw([]);
        }
      } catch {
        setPlatformLoadsRaw([]);
      }
      // Flip the flag AFTER the initial restore so subsequent writes go to
      // the correct scoped key.
      platformLoadsHydratedRef.current = true;
    })();
  }, [geocacheReady, geocodePlatformLoads, scopedKeys]);

  // Hydrate persisted server-delivered loads (instant Delivered tab on app
  // open, before getDeliveredLoads finishes its first call).
  useEffect(() => {
    serverDeliveredLoadsHydratedRef.current = false;
    if (!scopedKeys) {
      setServerDeliveredLoadsRaw([]);
      serverDeliveredLoadsHydratedRef.current = true;
      return;
    }
    (async () => {
      try {
        const val = await AsyncStorage.getItem(scopedKeys.serverDeliveredLoads);
        if (val) {
          const cached = JSON.parse(val) as Load[];
          if (Array.isArray(cached)) {
            setServerDeliveredLoadsRaw(cached);
          } else {
            setServerDeliveredLoadsRaw([]);
          }
        } else {
          setServerDeliveredLoadsRaw([]);
        }
      } catch {
        setServerDeliveredLoadsRaw([]);
      }
      serverDeliveredLoadsHydratedRef.current = true;
    })();
  }, [scopedKeys]);

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
  //
  // v63: status comes from the load object itself. The pre-v63 code forced
  // "delivered" for any id present in driverDeliveredRef — but that Set was
  // being populated with picked-up dropped loads too, which is what caused
  // the auto-promotion bug. Every legitimate delivered tap now stamps the
  // load's status="delivered" directly via updateLoadStatus / the post-
  // success markAsDelivered processor / markDriverDelivered, so there is no
  // need for a derived override here.
  const loads = React.useMemo(() => {
    const seen = new Set<string>();
    const result: Load[] = [];

    // 1. Active legs (assigned/picked_up) from getAssignedLoads.
    for (const l of platformLoads) {
      seen.add(l.id);
      result.push(l);
    }

    // 2. Authoritative delivered legs from getDeliveredLoads (platform
    //    v3.5.0+). For each one, merge in any locally-captured inspection
    //    records — photos / damages / signatures may still be queued for
    //    upload to the platform, in which case the server doesn't yet
    //    know about them. Driver should still see their own work.
    for (const l of serverDeliveredLoads) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const localSnap = deliveredSnapshots.find((s) => s.id === l.id);
      result.push(localSnap ? mergeServerDeliveredWithLocal(l, localSnap) : l);
    }

    // 3. Local-only loads (manually added, field pickups, demo data).
    for (const l of localLoads) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        result.push(l);
      }
    }

    // 4. Delivered snapshots that the server hasn't returned yet — covers
    //    three cases:
    //      a) Mid-flight Mark Delivered tap that hasn't reached the
    //         platform yet (or the platform hasn't ack'd back to us).
    //      b) Delivery older than the 60-day server window.
    //      c) Offline mode where getDeliveredLoads couldn't run.
    //    Also covers dropped picked_up snapshots (preserved status).
    for (const l of deliveredSnapshots) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        result.push(l);
      }
    }

    return result;
  }, [platformLoads, serverDeliveredLoads, localLoads, deliveredSnapshots]);

  const getLoad = useCallback(
    (id: string) => loads.find((l) => l.id === id),
    [loads]
  );

  const updateLoadStatus = useCallback((loadId: string, status: LoadStatus) => {
    localStatusOverridesRef.current.set(loadId, { status, at: Date.now() });
    persistOverrides();

    // When the driver marks a load as delivered, persist that decision locally
    // so it survives platform sync (which may drop the load).
    if (status === "delivered") {
      // Find the current load to snapshot it (with deliveredAt timestamp)
      const currentLoad = [...platformLoads, ...localLoads].find((l) => l.id === loadId);
      const deliveredAt = new Date().toISOString();
      if (currentLoad) {
        markDriverDelivered(loadId, {
          ...currentLoad,
          status: "delivered" as LoadStatus,
          deliveredAt,
          delivery: { ...currentLoad.delivery, date: deliveredAt },
        });
      }
      // Stamp status, deliveredAt, and actual delivery date on the load in
      // both arrays. Previously this only stamped deliveredAt and relied on a
      // memo override to "show" the status — which meant the persisted load
      // still carried status: "picked_up" and could flip back after a restart
      // if the ref/override got lost.
      const stampFn = (prev: Load[]) =>
        prev.map((l) =>
          l.id === loadId
            ? {
                ...l,
                status: "delivered" as LoadStatus,
                deliveredAt,
                delivery: { ...l.delivery, date: deliveredAt },
              }
            : l
        );
      setLocalLoads(stampFn);
      setPlatformLoads(stampFn);
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
      setPlatformLoads(freezeFn);
      return;
    }

    // Update in both local and platform arrays (skip if we already stamped above for delivered)
    if (status !== "delivered") {
      setLocalLoads((prev) =>
        prev.map((l) => (l.id === loadId ? { ...l, status } : l))
      );
      setPlatformLoads((prev) => prev.map((l) => (l.id === loadId ? { ...l, status } : l)));
    }
  }, [platformLoads, localLoads, markDriverDelivered, persistOverrides, setLocalLoads, setPlatformLoads]);

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
    // Also refresh delivered history. Force=true bypasses the 60s
    // throttle so a manual pull-to-refresh always hits the server.
    doFetchDeliveredLoads(true);
  }, [doFetchLoads, doFetchDeliveredLoads]);

  // `force=false` respects the 60s throttle (good for tab-focus prefetches);
  // `force=true` always hits the server (pull-to-refresh).
  const refreshDeliveredLoads = useCallback(
    (force: boolean = true) => {
      doFetchDeliveredLoads(force);
    },
    [doFetchDeliveredLoads],
  );

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
    setPlatformLoads(archiveFn);
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

  // ── clearNonPlatformLoads: wipe all manually-added / scanned loads ──────────
  const clearNonPlatformLoads = useCallback(() => {
    setLocalLoadsRaw([]);
    const k = scopedKeysRef.current?.localLoads;
    if (k) AsyncStorage.setItem(k, "[]").catch(() => {});
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
    setPlatformLoads(mergeFn);
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
    setPlatformLoads(archiveFn);
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
    setPlatformLoads(patchFn);
    setDeliveredSnapshots((prev) => {
      const updated = patchFn(prev);
      persistDeliveredImmediate([...driverDeliveredRef.current], updated);
      return updated;
    });
  }, []);

  const clearAllArchived = useCallback(() => {
    const removeFn = (prev: Load[]) => prev.filter((l) => l.status !== "archived");
    setLocalLoads(removeFn);
    setPlatformLoads(removeFn);
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

  // ── flushPlatformSyncQueue ────────────────────────────────────────────────
  // Polls the syncQueue length until it hits zero. Used before swapping Clerk
  // sessions in the multi-account flow so platform API calls fire with the
  // correct auth token.
  const syncQueueRef = React.useRef(syncQueue);
  syncQueueRef.current = syncQueue;
  const flushPlatformSyncQueue = useCallback(async (timeoutMs = 5000): Promise<boolean> => {
    if (syncQueueRef.current.length === 0) return true;
    const start = Date.now();
    return new Promise<boolean>((resolve) => {
      const check = () => {
        if (syncQueueRef.current.length === 0) return resolve(true);
        if (Date.now() - start >= timeoutMs) return resolve(false);
        setTimeout(check, 150);
      };
      check();
    });
  }, []);

  const retryFailedSyncTasks = useCallback(() => {
    setSyncQueue((current) => {
      const reset = current.map((t) =>
        t.status === "failed_permanent"
          ? { ...t, status: "pending" as PlatformSyncTaskStatus, attempts: 0, lastError: undefined }
          : t,
      );
      persistSyncQueue(reset);
      return reset;
    });
  }, [persistSyncQueue]);

  const dismissSyncTask = useCallback((id: string) => {
    setSyncQueue((current) => {
      const next = current.filter((t) => t.id !== id);
      persistSyncQueue(next);
      return next;
    });
  }, [persistSyncQueue]);

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
        refreshDeliveredLoads,
        archiveAllDelivered,
        archiveSingleLoad,
        clearAllArchived,
        deleteLoad,
        clearNonPlatformLoads,
        patchLoad,
        queuePlatformSync,
        flushPlatformSyncQueue,
        syncQueue,
        retryFailedSyncTasks,
        dismissSyncTask,
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
