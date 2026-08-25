/**
 * PhotoQueue class — exported separately for unit testing.
 * The singleton `photoQueue` lives in photo-queue.ts and imports from here.
 *
 * Upload lifecycle (v2 — "upload first, stamp later"):
 * 1. Photos are enqueued as "pending" — immediately compressed and uploaded to R2.
 * 2. After upload succeeds, a fire-and-forget request asks the server to stamp
 *    the photo asynchronously (server downloads from R2, stamps, re-uploads).
 * 3. Uploads run in parallel (UPLOAD_CONCURRENCY at a time) for speed.
 * 4. An AppState listener resumes uploads when the app returns to foreground.
 * 5. A background retry loop handles any failures with escalating backoff.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { compressImage } from "./image-compress";
import {
  reportPhotoCaptured,
  reportPhotoUploaded,
} from "./inspection-photo-progress";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PhotoStatus = "pending" | "uploading" | "done" | "failed";

export interface StampMeta {
  driverCode?: string;
  companyName?: string;
  inspectionType?: string;
  vin?: string | null;
  locationLabel?: string | null;
  lat?: number | null;
  lng?: number | null;
  capturedAt?: string;
}

export interface PhotoQueueEntry {
  clientId: string;
  localUri: string;
  remoteUrl: string | null;
  status: PhotoStatus;
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
  loadId?: string;
  vehicleId?: string;
  /** Human-readable load number (e.g. LD-2026-52760) for R2 folder naming */
  loadNumber?: string;
  /**
   * v71+: which inspection bucket this photo belongs to (pickup or delivery).
   * Used by the backfill safety net + sync-queue deferral logic to group
   * photos by (loadId, vehicleId, inspectionType) so syncInspection only
   * fires when EVERY photo for that inspection has reached HTTPS. Optional
   * for backward-compat with pre-v71 persisted entries (treated as "pickup"
   * by default in lookups that need it).
   */
  inspectionType?: "pickup" | "delivery";
  /**
   * v80+: platform leg id + driver code for live progress drips to
   * driversApi.reportInspectionPhotoProgress. Optional — absent on
   * local-only / add-load photos and pre-v80 persisted entries.
   */
  progressLegId?: number | string;
  progressDriverCode?: string;
  createdAt: number;
  stampMeta?: StampMeta;
  stamped?: boolean;
  /** R2 key for async stamping after upload */
  r2Key?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Base storage key — at runtime suffixed with `:${driverCode}` so each Clerk
// account on the device keeps its own queue. See `setActiveDriver()`.
const QUEUE_STORAGE_BASE = "@autohaul/photo_queue_v1";
const SCOPE_MIGRATION_FLAG_KEY = "@autohaul/photo_queue_scope_migrated_v60";
const PHOTOS_DIR = (FileSystem.documentDirectory ?? "") + "inspection_photos/";
// v66+: there is NO max-retries cap. A photo that fails to upload
// stays "pending" forever and keeps retrying with the capped backoff
// below. The only way an entry ever stops retrying is if the user
// manually deletes it from the queue. This is the contract drivers
// were promised: "the app never gives up on a photo, ever."
const RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 90_000, 180_000, 300_000];
const MAX_RETRY_DELAY_MS = 300_000; // 5 minutes — caps the backoff for retries beyond the table.
const BACKGROUND_INTERVAL_MS = 15_000;
// v65+: adaptive concurrency by network type. Wi-Fi can comfortably
// handle 4 parallel uploads; cellular stays at 2 to avoid TCP-handover
// drops (NSURLErrorDomain Code=-1005) on weak LTE signal.
const UPLOAD_CONCURRENCY_CELLULAR = 2;
const UPLOAD_CONCURRENCY_WIFI = 4;
const STALE_UPLOAD_MS = 60_000;
// v66+: longer cellular timeout. A genuinely-slow 500 KB upload over
// 2-bar LTE can take 60–80 s — better to wait than time out and waste
// the bytes already in flight.
const UPLOAD_TIMEOUT_WIFI_MS = 30_000;
const UPLOAD_TIMEOUT_CELLULAR_MS = 90_000;
// v83+: absolute ceiling on a single upload attempt, covering compression,
// presign, and the PUT together. Every individual step already has its own
// timeout, but this is the backstop that guarantees an attempt can only
// ever end in success or failure — never limbo. A hung attempt used to
// leave the queue's mutex held forever, which silently killed all uploads
// until the app was force-quit.
const UPLOAD_ATTEMPT_DEADLINE_MS = 180_000;
// v83+: how long the sync mutex may be held without any batch completing
// before another caller is allowed to steal it. Refreshed after every
// completed batch, so genuine progress on a long queue never trips it.
const SYNC_LEASE_MS = 240_000;
// v83+: an entry sitting in "uploading" for longer than this is treated as
// stuck for UI purposes, so the driver sees "stuck" and a working Retry
// instead of a reassuring "uploading…" that never advances.
const STUCK_UPLOADING_MS = 3 * 60_000;
// v65+: a queue entry that's been "pending" with at least one failed
// attempt and a recorded error for longer than this threshold is
// considered stuck for UI purposes (surfaced as "Stuck" to the driver
// for visibility). Does NOT change retry semantics — v66 removed the
// retry cap, so a stuck entry keeps trying forever in the background.
const STUCK_PENDING_MS = 5 * 60_000;
// v65+: hard cap on retained "done" entries. Above this, the oldest
// done+stamped entries are pruned regardless of inspection-record
// retention rules to keep the AsyncStorage payload bounded.
const MAX_DONE_ENTRIES = 200;
// v65+: minimum age for a done+stamped entry to become eligible for
// the "safe" prune path (i.e. only prune if not referenced by any
// inspection record AND older than this). Gives backfill ample time
// to swap local→HTTPS into inspection.photos before we drop the
// queue's pointer to the local file.
const SAFE_PRUNE_MIN_AGE_MS = 60 * 60_000;

function getUploadApiBase(): string {
  const fromEnv =
    typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_BASE_URL : undefined;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    const { getApiBaseUrl } = require("@/constants/oauth");
    const url = getApiBaseUrl();
    if (url) return url;
  } catch {}
  return "http://127.0.0.1:3000";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function ensurePhotosDir() {
  if (Platform.OS === "web") return;
  const info = await FileSystem.getInfoAsync(PHOTOS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return !!(state.isConnected && state.isInternetReachable);
  } catch {
    return false;
  }
}

/**
 * v65+: returns the current upload concurrency based on network type.
 * Wi-Fi gets 4, cellular gets 2. Unknown (e.g. expo-network failed)
 * falls back to the conservative cellular value.
 */
async function getCurrentConcurrency(): Promise<number> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.type === Network.NetworkStateType.WIFI) {
      return UPLOAD_CONCURRENCY_WIFI;
    }
    return UPLOAD_CONCURRENCY_CELLULAR;
  } catch {
    return UPLOAD_CONCURRENCY_CELLULAR;
  }
}

function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = UPLOAD_TIMEOUT_WIFI_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * v83+: like fetchWithTimeout, but keeps the abort armed through the JSON
 * body read. `fetch` resolves as soon as response HEADERS arrive, so
 * clearing the timer at that point leaves the body read unprotected — a
 * connection that dies mid-body (routine on weak cellular) would hang the
 * read forever. That was the trigger for the wedged-queue incident.
 */
async function fetchJsonWithTimeout<T>(url: string, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Rejects if `promise` hasn't settled within `ms`. */
function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ─── Queue Class ──────────────────────────────────────────────────────────────

type Listener = (entries: PhotoQueueEntry[]) => void;

export class PhotoQueue {
  entries: PhotoQueueEntry[] = [];
  private listeners: Set<Listener> = new Set();
  // v83+: a LEASE, not a boolean. Holds the timestamp of the last observed
  // progress (lease taken, or a batch completed). Any caller may steal the
  // lease once it goes stale, so a hung upload can no longer kill the queue
  // for the lifetime of the process. Previously this was a plain boolean
  // cleared in a `finally` — and since an upload attempt had no overall
  // deadline, one attempt that never settled meant the flag was never
  // cleared and every subsequent sync() returned at the guard forever.
  private syncLeaseAt: number | null = null;
  private loaded = false;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private appState: AppStateStatus = AppState.currentState;
  // v66+: subscription to OS network state changes so the queue can
  // resume uploads the instant connectivity returns (Wi-Fi reattach,
  // LTE reacquired, airplane mode toggled off) — instead of waiting
  // for the 15-second BACKGROUND_INTERVAL poll.
  private networkSub: { remove: () => void } | null = null;
  private wasOnline: boolean | null = null;
  // Debounced persist — coalesces many rapid changes into one AsyncStorage write
  // so that bursts of photo captures don't pile up serial JSON writes on the JS
  // thread (which was the main cause of capture lag past ~12 photos).
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistPending = false;

  // v60+ multi-account isolation: each driverCode gets its own scoped storage
  // key. `null` means "no driver signed in" — entries persist under the base
  // key (matches pre-v60 behaviour for users not yet migrated).
  private activeDriverCode: string | null = null;

  private currentStorageKey(): string {
    return this.activeDriverCode
      ? `${QUEUE_STORAGE_BASE}:${this.activeDriverCode}`
      : QUEUE_STORAGE_BASE;
  }

  /**
   * Switch the queue to a different driver. Force-flushes the current
   * driver's queue to disk, swaps the scoped key, then reloads the new
   * driver's pending entries.
   *
   * Call this from the auth layer whenever the active Clerk session
   * changes (incl. on initial sign-in and on multi-account "Switch").
   */
  async setActiveDriver(driverCode: string | null): Promise<void> {
    if (driverCode === this.activeDriverCode && this.loaded) return;

    // 1. Force-flush whatever's in memory to the OUTGOING scope so we don't
    //    lose pending uploads on the way out.
    if (this.loaded) {
      await this.persist();
    }

    // 2. Swap scope.
    this.activeDriverCode = driverCode;
    this.entries = [];
    this.loaded = false;
    this.emit();

    // 3. One-time migration: pre-v60 unsuffixed queue → first driver's scope.
    if (driverCode) {
      await this.migrateUnsuffixedToScope(driverCode);
    }

    // 4. Reload from the INCOMING scope.
    await this.load();
  }

  private async migrateUnsuffixedToScope(driverCode: string): Promise<void> {
    try {
      const alreadyDone = await AsyncStorage.getItem(SCOPE_MIGRATION_FLAG_KEY);
      if (alreadyDone) return;
      const legacyVal = await AsyncStorage.getItem(QUEUE_STORAGE_BASE).catch(() => null);
      if (legacyVal) {
        const targetKey = `${QUEUE_STORAGE_BASE}:${driverCode}`;
        const existing = await AsyncStorage.getItem(targetKey).catch(() => null);
        if (existing == null) {
          await AsyncStorage.setItem(targetKey, legacyVal).catch(() => {});
        }
        await AsyncStorage.removeItem(QUEUE_STORAGE_BASE).catch(() => {});
      }
      await AsyncStorage.setItem(SCOPE_MIGRATION_FLAG_KEY, "1").catch(() => {});
    } catch {
      // Silent — the queue still works, just without migration.
    }
  }

  async load() {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(this.currentStorageKey());
      this.entries = raw ? JSON.parse(raw) : [];
      this.entries = this.entries.map((e) =>
        e.status === "uploading" ? { ...e, status: "pending" as PhotoStatus } : e
      );
      this.loaded = true;
      this.emit();
    } catch {
      this.entries = [];
      this.loaded = true;
    }
  }

  /** Debounced write — fire-and-forget for hot paths (enqueue, updateEntry). */
  private schedulePersist() {
    this.persistPending = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistPending = false;
      AsyncStorage.setItem(this.currentStorageKey(), JSON.stringify(this.entries)).catch(() => {});
    }, 250);
  }

  /** Force an immediate write — used on remove, retryFailed, app backgrounding. */
  async persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistPending = false;
    try {
      await AsyncStorage.setItem(this.currentStorageKey(), JSON.stringify(this.entries));
    } catch {}
  }

  private emit() {
    const snapshot = [...this.entries];
    this.listeners.forEach((fn) => fn(snapshot));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn([...this.entries]);
    return () => this.listeners.delete(fn);
  }

  getEntries(): PhotoQueueEntry[] {
    return [...this.entries];
  }

  resolvedUri(clientId: string): string | null {
    const entry = this.entries.find((e) => e.clientId === clientId);
    if (!entry) return null;
    return entry.remoteUrl ?? entry.localUri;
  }

  /**
   * Returns the safest URI for a captured photo:
   *   1. The remote HTTPS URL if upload finished.
   *   2. Otherwise the permanent local path (PHOTOS_DIR/{clientId}.ext).
   *   3. Otherwise the temp camera URI (last resort — can be cleaned by OS).
   *
   * Use this instead of resolvedUri() in any flow where the URI is going to
   * be persisted in inspection.photos, so we never write a temp URI to a
   * record that the driver expects to view later.
   */
  bestUriFor(clientId: string): string | null {
    const entry = this.entries.find((e) => e.clientId === clientId);
    if (!entry) return null;
    if (entry.remoteUrl && entry.remoteUrl.startsWith("http")) return entry.remoteUrl;
    return entry.localUri;
  }

  /**
   * v71+: given any URI that came out of the queue (either a file:// path
   * under PHOTOS_DIR, or an HTTPS remote URL, or the temp camera URI before
   * the copy completed), return the clientId of the matching queue entry —
   * or null if no entry matches. Used by the syncInspection save path to
   * tag a photo array with the stable clientIds it should be resolved by
   * at processing time, so we don't ship empty/partial photo arrays to
   * the platform when uploads haven't finished yet.
   */
  getClientIdForUri(uri: string): string | null {
    if (!uri) return null;
    for (const e of this.entries) {
      if (e.localUri === uri) return e.clientId;
      if (e.remoteUrl && e.remoteUrl === uri) return e.clientId;
    }
    return null;
  }

  /**
   * v71+: every queue entry tagged with the given (loadId, vehicleId,
   * inspectionType) — used by the backfill safety net to reconstruct an
   * inspection's photo set from the queue when the in-memory inspection
   * record has been wiped (e.g. by an empty-photos syncInspection that
   * landed on the platform and was then echoed back through
   * getAssignedLoads). Falls back to "pickup" when an entry's
   * inspectionType is unset (pre-v71 persisted entries).
   */
  getEntriesForInspection(
    loadId: string,
    vehicleId: string,
    inspectionType: "pickup" | "delivery",
  ): PhotoQueueEntry[] {
    return this.entries.filter(
      (e) =>
        e.loadId === loadId &&
        e.vehicleId === vehicleId &&
        (e.inspectionType ?? "pickup") === inspectionType,
    );
  }

  /**
   * Wait until the entry's permanent file copy finishes (localUri patched
   * to PHOTOS_DIR/{clientId}.ext). Resolves immediately if already copied
   * or if the entry already has a remote URL. Times out after `timeoutMs`
   * to avoid hanging forever.
   */
  awaitCopy(clientId: string, timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const entry = this.entries.find((e) => e.clientId === clientId);
        if (!entry) {
          resolve();
          return;
        }
        const copied =
          (entry.remoteUrl != null && entry.remoteUrl.startsWith("http")) ||
          entry.localUri.startsWith(PHOTOS_DIR);
        if (copied || Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  /** Convenience: await copy completion for many clientIds in parallel. */
  async awaitCopies(clientIds: string[], timeoutMs = 5_000): Promise<void> {
    await Promise.all(clientIds.map((id) => this.awaitCopy(id, timeoutMs)));
  }

  /** All queue entries for a given (loadId, vehicleId). */
  getEntriesForVehicle(loadId: string, vehicleId: string): PhotoQueueEntry[] {
    return this.entries.filter(
      (e) => e.loadId === loadId && e.vehicleId === vehicleId
    );
  }

  /**
   * Flush uploads for a vehicle, then return a structured result that lets
   * callers always render every photo (no silent drops):
   *   - `urls`: best URI per entry, in original capture order. HTTPS where
   *     available, otherwise permanent local path. Safe to persist into
   *     inspection.photos.
   *   - `uploadedUrls`: subset of `urls` that are HTTPS — safe to send to
   *     the platform.
   *   - `pendingClientIds`: entries that still don't have a remote URL
   *     after the flush. Caller can poll/subscribe to patch the record
   *     when stragglers finish uploading.
   */
  async flushAndGetResult(
    loadId: string,
    vehicleId: string
  ): Promise<{
    urls: string[];
    uploadedUrls: string[];
    pendingClientIds: string[];
  }> {
    await this.flushForVehicle(loadId, vehicleId);
    const vehicleEntries = this.entries.filter(
      (e) => e.loadId === loadId && e.vehicleId === vehicleId
    );
    const urls: string[] = [];
    const uploadedUrls: string[] = [];
    const pendingClientIds: string[] = [];
    for (const e of vehicleEntries) {
      if (e.remoteUrl && e.remoteUrl.startsWith("http")) {
        urls.push(e.remoteUrl);
        uploadedUrls.push(e.remoteUrl);
      } else {
        urls.push(e.localUri);
        pendingClientIds.push(e.clientId);
      }
    }
    return { urls, uploadedUrls, pendingClientIds };
  }

  startBackgroundRetry(): void {
    if (this.backgroundTimer) return;
    this.load().then(() => this.sync()).catch((err) => console.warn("[PhotoQueue]", err));
    this.backgroundTimer = setInterval(() => {
      this.sync().catch((err) => console.warn("[PhotoQueue]", err));
    }, BACKGROUND_INTERVAL_MS);

    // Resume uploads on foreground; flush pending persist when backgrounding
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
        if (next === "active" && this.appState !== "active") {
          // v65+: iOS suspends setInterval while backgrounded, so an
          // entry that was waiting on a 180s retry delay can end up
          // sitting unattended for hours. Clear stale timers so the
          // very next sync re-attempts them immediately.
          this.resetStaleRetryTimers();
          this.sync().catch(() => {});
        }
        if ((next === "background" || next === "inactive") && this.persistPending) {
          // Force-flush any debounced writes so we never lose queue state on
          // app suspension/kill.
          this.persist().catch(() => {});
        }
        this.appState = next;
      });
    }

    // v66+: instant reconnect via OS network state events. When the
    // device transitions from offline → online (any network type), we
    // fire sync() immediately — no need to wait up to 15 s for the
    // next BACKGROUND_INTERVAL_MS tick. Critical for cellular fleets
    // who routinely lose signal in tunnels, basements, and dead zones.
    if (!this.networkSub) {
      try {
        const sub = Network.addNetworkStateListener((state) => {
          const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
          if (online && this.wasOnline === false) {
            // Offline → online transition. Clear stale retry timers
            // so every pending entry retries on the next sync tick.
            this.resetStaleRetryTimers();
            this.sync().catch(() => {});
          }
          this.wasOnline = online;
        });
        // expo-network returns an EventSubscription with remove();
        // wrap defensively in case its shape ever changes.
        this.networkSub = sub && typeof (sub as { remove?: () => void }).remove === "function"
          ? (sub as { remove: () => void })
          : { remove: () => {} };
      } catch (err) {
        console.warn(
          "[PhotoQueue] network listener unavailable:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  stopBackgroundRetry(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
    if (this.appStateSub) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
    if (this.networkSub) {
      this.networkSub.remove();
      this.networkSub = null;
    }
  }

  /**
   * Enqueue a freshly captured photo.
   *
   * v66+: now AWAITS the temp→permanent file copy before returning.
   * This closes the ~10–50 ms data-loss window that existed before:
   * previously, if the app was force-killed (or crashed, or the OS
   * cleaned temp storage) between the synchronous push and the
   * background copy, the photo's permanent file could be missing on
   * next launch. With the await, the camera shutter doesn't unlock
   * until the photo is safely in PHOTOS_DIR. The 50 ms latency hit
   * per capture is well worth the absolute durability guarantee —
   * "photos can never disappear" is a hard requirement from the
   * cellular-only fleet brief.
   *
   * The network upload itself still starts in the background; only
   * the FILE copy is awaited.
   */
  async enqueue(
    tempUri: string,
    meta?: {
      loadId?: string;
      vehicleId?: string;
      loadNumber?: string;
      inspectionType?: "pickup" | "delivery";
      stampMeta?: StampMeta;
      /** Platform leg id for live dispatch progress (v80+) */
      progressLegId?: number | string;
      progressDriverCode?: string;
    }
  ): Promise<PhotoQueueEntry> {
    await this.load();

    const clientId = uuid();
    // v66+: copy temp → permanent BEFORE creating the queue entry so the
    // entry's `localUri` is guaranteed to point at PHOTOS_DIR. If the
    // copy fails (e.g. disk full), we still create the entry pointing
    // at the temp URI — better to have a possibly-fragile photo
    // reference than to drop the capture entirely.
    let permanentUri = tempUri;
    if (Platform.OS !== "web") {
      try {
        await ensurePhotosDir();
        const ext = tempUri.split(".").pop()?.split("?")[0] ?? "jpg";
        const dest = `${PHOTOS_DIR}${clientId}.${ext}`;
        await FileSystem.copyAsync({ from: tempUri, to: dest });
        permanentUri = dest;
      } catch (err) {
        console.warn(
          "[PhotoQueue] enqueue copy failed, falling back to temp URI:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const entry: PhotoQueueEntry = {
      clientId,
      localUri: permanentUri,
      remoteUrl: null,
      status: "pending",
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      loadId: meta?.loadId,
      vehicleId: meta?.vehicleId,
      loadNumber: meta?.loadNumber,
      inspectionType: meta?.inspectionType,
      progressLegId: meta?.progressLegId,
      progressDriverCode: meta?.progressDriverCode,
      createdAt: Date.now(),
      stampMeta: meta?.stampMeta,
      stamped: !meta?.stampMeta,
    };

    this.entries.push(entry);
    this.emit();
    // v66+: force-flush AsyncStorage immediately (no debounce) so a
    // crash or force-quit in the next moments can't lose the entry
    // either. Otherwise the in-memory state has the photo but the
    // persisted state doesn't yet.
    this.persist().catch(() => {});

    // v80+: bump expected count on the company platform immediately so
    // Trip Details shows "0 / N uploaded" while the PUT is in flight.
    if (
      entry.progressLegId != null &&
      entry.progressLegId !== "" &&
      entry.progressDriverCode &&
      (entry.inspectionType === "pickup" || entry.inspectionType === "delivery")
    ) {
      reportPhotoCaptured({
        legId: entry.progressLegId,
        driverCode: entry.progressDriverCode,
        inspectionType: entry.inspectionType,
        loadNumber: entry.loadNumber,
      });
    }

    // Kick off network upload in background — does NOT block the caller.
    this.uploadEntry(entry).catch(() => {});

    return entry;
  }

  async flushForVehicle(loadId: string, vehicleId: string): Promise<void> {
    await this.load();
    const pending = this.entries.filter(
      (e) =>
        (e.status === "pending" || e.status === "uploading") &&
        e.loadId === loadId &&
        e.vehicleId === vehicleId
    );
    if (pending.length === 0) return;
    const online = await isOnline();
    if (!online) return;
    const concurrency = await getCurrentConcurrency();
    for (let i = 0; i < pending.length; i += concurrency) {
      const batch = pending.slice(i, i + concurrency);
      await Promise.all(batch.map((snapshot) => {
        const live = this.entries.find((e) => e.clientId === snapshot.clientId);
        if (!live || live.status === "done") return Promise.resolve();
        if (live.status === "uploading") {
          return this.waitForUpload(live.clientId);
        }
        return this.uploadEntry(live);
      }));
    }
  }

  private waitForUpload(clientId: string, timeoutMs = 30_000): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const entry = this.entries.find((e) => e.clientId === clientId);
        if (!entry || entry.status === "done" || entry.status === "failed" || Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  async flushAndGetUrls(loadId: string, vehicleId: string): Promise<string[]> {
    await this.flushForVehicle(loadId, vehicleId);
    const vehicleEntries = this.entries.filter(
      (e) => e.loadId === loadId && e.vehicleId === vehicleId
    );
    return vehicleEntries
      .map((e) => e.remoteUrl)
      .filter((url): url is string => url != null && url.startsWith("http"));
  }

  /**
   * Non-blocking variant: returns the HTTP URLs that have already finished
   * uploading for a load (or all vehicles of a load) right now.
   * Use this to fire a markAsDelivered / markAsPickedUp call immediately
   * without waiting on still-pending uploads — the queue will continue to
   * sync in the background and a follow-up syncInspection can ship any
   * late-arriving URLs.
   */
  getUploadedUrls(loadId: string, vehicleId?: string): string[] {
    return this.entries
      .filter(
        (e) =>
          e.loadId === loadId &&
          (vehicleId ? e.vehicleId === vehicleId : true) &&
          e.remoteUrl != null &&
          e.remoteUrl.startsWith("http")
      )
      .map((e) => e.remoteUrl!)
      .filter((u, i, a) => a.indexOf(u) === i);
  }

  /** How many entries are still pending/uploading for this load. */
  pendingCountForLoad(loadId: string): number {
    return this.entries.filter(
      (e) =>
        e.loadId === loadId &&
        (e.status === "pending" || e.status === "uploading")
    ).length;
  }

  async sync(): Promise<void> {
    await this.load();

    const now = Date.now();

    // Watchdog: reset entries stuck in "uploading" for over 60 s back to
    // "pending" so they get retried instead of hanging forever.
    //
    // v83+: this runs BEFORE the lease check. It used to sit after the
    // mutex guard, which meant the one safety net capable of rescuing a
    // wedged queue was itself unreachable whenever the queue was wedged.
    let rescued = false;
    for (const e of this.entries) {
      if (e.status === "uploading" && e.lastAttemptAt && now - e.lastAttemptAt > STALE_UPLOAD_MS) {
        e.status = "pending";
        rescued = true;
      }
    }
    if (rescued) {
      this.schedulePersist();
      this.emit();
    }

    // Lease check: bail only if another pass is actively making progress.
    if (this.syncLeaseAt !== null && now - this.syncLeaseAt < SYNC_LEASE_MS) return;
    if (this.syncLeaseAt !== null) {
      console.warn(
        `[PhotoQueue] Stealing stale sync lease (held ${Math.round((now - this.syncLeaseAt) / 1000)}s)`,
      );
    }

    // v66+: NO max-retry cap. Every pending/failed entry is eligible
    // for another attempt as soon as its backoff timer expires.
    // Backoff is capped at MAX_RETRY_DELAY_MS (5 min) for entries that
    // have exhausted the RETRY_DELAYS_MS table, so a wedged upload
    // retries roughly every 5 minutes forever until it succeeds or
    // the driver manually deletes it.
    const ready = this.entries.filter((e) => {
      if (e.status !== "pending" && e.status !== "failed") return false;
      if (!e.lastAttemptAt) return true;
      const delayIndex = Math.min(e.attempts - 1, RETRY_DELAYS_MS.length - 1);
      const delay = delayIndex >= 0
        ? RETRY_DELAYS_MS[delayIndex] ?? MAX_RETRY_DELAY_MS
        : RETRY_DELAYS_MS[0];
      const cappedDelay = Math.min(delay, MAX_RETRY_DELAY_MS);
      return now - e.lastAttemptAt >= cappedDelay;
    });

    if (ready.length === 0) return;

    const online = await isOnline();
    if (!online) return;

    this.syncLeaseAt = Date.now();
    try {
      const concurrency = await getCurrentConcurrency();
      for (let i = 0; i < ready.length; i += concurrency) {
        const batch = ready.slice(i, i + concurrency);
        await Promise.all(batch.map((entry) => this.uploadEntry(entry)));
        // Renew the lease after every completed batch so a long but
        // healthy queue is never mistaken for a wedged one.
        this.syncLeaseAt = Date.now();
      }
    } finally {
      this.syncLeaseAt = null;
    }
  }

  /**
   * One upload attempt, guaranteed to settle. All status transitions and
   * error handling live here; the actual work is in runUploadAttempt.
   */
  private async uploadEntry(entry: PhotoQueueEntry): Promise<void> {
    this.updateEntry(entry.clientId, { status: "uploading", lastAttemptAt: Date.now() });
    try {
      await withDeadline(
        this.runUploadAttempt(entry),
        UPLOAD_ATTEMPT_DEADLINE_MS,
        "Upload attempt exceeded deadline",
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      // The attempt may have actually succeeded and merely lost the race to
      // the deadline. Never downgrade an entry that already reached "done".
      const live = this.entries.find((e) => e.clientId === entry.clientId);
      if (live?.status === "done") return;
      // v66+: never give up. An entry stays "pending" no matter how many
      // attempts have failed — the scheduler keeps retrying it on the
      // capped (5-minute max) backoff. The only paths out of the queue
      // are a successful upload, or the driver tapping Delete.
      this.updateEntry(entry.clientId, {
        status: "pending",
        lastError: message,
        lastAttemptAt: Date.now(),
        attempts: entry.attempts + 1,
      });
    }
  }

  private async runUploadAttempt(entry: PhotoQueueEntry): Promise<void> {
    // v66+: snapshot the current network state ONCE per upload attempt
    // so compression target + timeout + session type all see the same
    // value. Avoids edge cases where the driver's connection flips
    // Wi-Fi ↔ cellular mid-upload.
    let networkType: Network.NetworkStateType | null = null;
    try {
      const state = await Network.getNetworkStateAsync();
      networkType = state.type ?? null;
    } catch {
      networkType = null;
    }
    const isWifi = networkType === Network.NetworkStateType.WIFI;
    const presignTimeoutMs = isWifi ? UPLOAD_TIMEOUT_WIFI_MS : UPLOAD_TIMEOUT_CELLULAR_MS;

    {
      // v66+: compress with network-aware quality. Cellular gets smaller
      // photos (~120–280 KB) so each PUT fits inside a stable TCP window
      // on weak LTE. Wi-Fi keeps the higher-quality target (~400–800 KB).
      const compressedUri = await compressImage(entry.localUri, isWifi ? "wifi" : "cellular");
      const vin = entry.stampMeta?.vin;
      const groupKey = entry.loadNumber && vin
        ? `${entry.loadNumber}/${vin}`
        : entry.loadNumber
          ? entry.loadNumber
          : [entry.loadId, entry.vehicleId].filter(Boolean).join("-") || "inspections";
      const apiBase = getUploadApiBase();

      // Step 1: Get a presigned upload URL. The timeout covers the JSON
      // body read too — see fetchJsonWithTimeout.
      const params = new URLSearchParams({
        ext: "jpg",
        groupKey,
        clientId: entry.clientId,
      });
      const { uploadUrl, publicUrl, key } = await fetchJsonWithTimeout<{
        uploadUrl: string;
        publicUrl: string;
        key: string;
        clientId: string;
      }>(`${apiBase}/api/photos/upload-url?${params}`, presignTimeoutMs);

      // Step 2: Upload compressed photo directly to R2
      if (Platform.OS === "web") {
        const blobRes = await fetch(compressedUri);
        const blob = await blobRes.blob();
        const uploadResponse = await fetchWithTimeout(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        if (!uploadResponse.ok) {
          throw new Error(`R2 upload failed: HTTP ${uploadResponse.status}`);
        }
      } else {
        // v66+: BACKGROUND session lets iOS keep the PUT running when the
        // app is suspended (phone locked, driver switched to Maps, etc.).
        // This is the most important change in v66 for a cellular-only
        // fleet — drivers spend ~90% of their workday with the app NOT
        // in the foreground, so foreground-only uploads barely got any
        // wall-clock time to run. iOS handles its own retry on TCP drops
        // for background sessions, which also dramatically reduces the
        // NSURLErrorDomain Code=-1005 ("connection lost") failures we
        // were seeing on weak LTE handovers.
        //
        // Caveat: the user manually swiping the app away from the recent-
        // apps switcher still cancels the background session. The queue
        // resumes on next app launch regardless.
        const timeoutMs = isWifi ? UPLOAD_TIMEOUT_WIFI_MS : UPLOAD_TIMEOUT_CELLULAR_MS;
        const uploadPromise = FileSystem.uploadAsync(uploadUrl, compressedUri, {
          httpMethod: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("R2 upload timed out")), timeoutMs)
        );
        const result = await Promise.race([uploadPromise, timeoutPromise]);
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`R2 upload failed: HTTP ${result.status}`);
        }
      }

      // Mark as done immediately — driver sees ✅ right away
      this.updateEntry(entry.clientId, {
        status: "done",
        remoteUrl: publicUrl,
        r2Key: key,
        lastError: null,
        lastAttemptAt: Date.now(),
        attempts: entry.attempts + 1,
      });

      // v80+: drip uploaded count + URL to dispatch Trip Details.
      if (
        entry.progressLegId != null &&
        entry.progressLegId !== "" &&
        entry.progressDriverCode &&
        (entry.inspectionType === "pickup" || entry.inspectionType === "delivery")
      ) {
        reportPhotoUploaded(
          {
            legId: entry.progressLegId,
            driverCode: entry.progressDriverCode,
            inspectionType: entry.inspectionType,
            loadNumber: entry.loadNumber,
          },
          publicUrl,
        );
      }

      // Step 3: Fire-and-forget async stamp on the server.
      // v65+: drop stampMeta from the entry once stamping succeeds.
      // It's not needed for re-uploads (status="done" entries don't
      // re-upload) and trims ~150 bytes per entry off the persisted
      // queue file. At 10k+ done entries this matters.
      if (entry.stampMeta && !entry.stamped) {
        const sm = entry.stampMeta;
        this.requestAsyncStamp(apiBase, key, sm).then(() => {
          this.updateEntry(entry.clientId, { stamped: true, stampMeta: undefined });
        }).catch(() => {});
      }
    }
  }

  private async requestAsyncStamp(apiBase: string, r2Key: string, sm: StampMeta): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      await fetch(`${apiBase}/api/photos/stamp-async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: r2Key,
          inspectionType: sm.inspectionType,
          driverCode: sm.driverCode,
          companyName: sm.companyName,
          vin: sm.vin,
          locationLabel: sm.locationLabel,
          lat: sm.lat,
          lng: sm.lng,
          capturedAt: sm.capturedAt,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private updateEntry(clientId: string, patch: Partial<PhotoQueueEntry>) {
    this.entries = this.entries.map((e) =>
      e.clientId === clientId ? { ...e, ...patch } : e
    );
    this.schedulePersist();
    this.emit();
  }

  async remove(clientId: string): Promise<void> {
    const entry = this.entries.find((e) => e.clientId === clientId);
    if (!entry) return;

    if (Platform.OS !== "web" && entry.localUri.startsWith(PHOTOS_DIR)) {
      try {
        await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
      } catch {}
    }

    this.entries = this.entries.filter((e) => e.clientId !== clientId);
    await this.persist();
    this.emit();
  }

  async retryFailed(): Promise<void> {
    // v65+: also retries entries that are "stuck pending" (have failed
    // attempts + a real error + are older than STUCK_PENDING_MS). Those
    // show up as Failed in the UI; the user expects pressing Retry to
    // actually move them along.
    const now = Date.now();
    this.entries = this.entries.map((e) => {
      if (e.status === "failed") {
        return { ...e, status: "pending" as PhotoStatus, attempts: 0, lastAttemptAt: null };
      }
      // v83+: also rescue entries wedged in "uploading" — otherwise Retry
      // was a no-op for exactly the state drivers were most likely to be
      // staring at.
      if (this.isStuck(e, now)) {
        return { ...e, status: "pending" as PhotoStatus, attempts: 0, lastAttemptAt: null, lastError: null };
      }
      return e;
    });
    // Drop any stale lease so the sync below can't be blocked by a
    // previous pass that hung. Manual Retry must always do something.
    this.syncLeaseAt = null;
    await this.persist();
    this.emit();
    await this.sync();
  }

  /**
   * v65+: classifies an entry as "stuck pending" if it's been pending
   * with a real upload failure for longer than STUCK_PENDING_MS. These
   * are surfaced as "Failed" in the UI so the driver can take action
   * (retry / switch to Wi-Fi) instead of seeing red error rows under
   * a "0 Failed" counter — which is what triggered the 723-queued
   * support escalation in the first place.
   */
  isStuckPending(entry: PhotoQueueEntry, now = Date.now()): boolean {
    if (entry.status !== "pending") return false;
    if (entry.attempts < 1) return false;
    if (!entry.lastError) return false;
    return now - entry.createdAt > STUCK_PENDING_MS;
  }

  /**
   * v83+: an entry that has claimed "uploading" for minutes without
   * finishing. Before this existed, a wedged queue showed the driver a
   * calm "Uploading 2 photos…" indefinitely — no warning, and no Retry
   * button, because the UI only offered Retry when something was
   * classified as failed. Counting these as failed gives the driver an
   * accurate picture and a working escape hatch.
   */
  isStuckUploading(entry: PhotoQueueEntry, now = Date.now()): boolean {
    if (entry.status !== "uploading") return false;
    if (!entry.lastAttemptAt) return false;
    return now - entry.lastAttemptAt > STUCK_UPLOADING_MS;
  }

  /** Either flavour of stuck — the check UI counters should use. */
  isStuck(entry: PhotoQueueEntry, now = Date.now()): boolean {
    return this.isStuckPending(entry, now) || this.isStuckUploading(entry, now);
  }

  /**
   * v65+: a stats variant that surfaces stuck-pending entries as
   * failed. Use this for any UI-facing counter so what the driver
   * sees matches what they're being asked to do.
   */
  get visibleStats() {
    const now = Date.now();
    let pending = 0;
    let uploading = 0;
    let done = 0;
    let failed = 0;
    for (const e of this.entries) {
      if (e.status === "uploading") {
        if (this.isStuckUploading(e, now)) failed++;
        else uploading++;
      }
      else if (e.status === "done") done++;
      else if (e.status === "failed") failed++;
      else if (e.status === "pending") {
        if (this.isStuckPending(e, now)) failed++;
        else pending++;
      }
    }
    return { pending, uploading, done, failed, total: this.entries.length };
  }

  /**
   * v65+: drops "done" + "stamped" entries that the inspection records
   * no longer reference, then enforces an absolute cap of
   * MAX_DONE_ENTRIES on retained done entries.
   *
   * @param retainedRemoteUrls Set of HTTPS URLs currently referenced
   *   by any inspection record (collected by the caller). Done entries
   *   whose remoteUrl is in this set are preserved even past the cap.
   * @returns Number of entries pruned.
   */
  async pruneDoneEntries(retainedRemoteUrls: Set<string>): Promise<number> {
    await this.load();
    const now = Date.now();

    // Phase 1: classify done+stamped entries by whether they're old
    // enough to be eligible AND not referenced by any inspection.
    const safeOldEligible: PhotoQueueEntry[] = [];
    const stillReferenced: PhotoQueueEntry[] = [];
    const tooYoung: PhotoQueueEntry[] = [];
    const otherEntries: PhotoQueueEntry[] = [];

    for (const e of this.entries) {
      if (e.status === "done" && e.stamped) {
        const age = now - e.createdAt;
        const url = e.remoteUrl ?? "";
        const referenced = url && retainedRemoteUrls.has(url);
        if (referenced) {
          stillReferenced.push(e);
        } else if (age >= SAFE_PRUNE_MIN_AGE_MS) {
          safeOldEligible.push(e);
        } else {
          tooYoung.push(e);
        }
      } else {
        otherEntries.push(e);
      }
    }

    // Phase 2: build the survival set.
    // Always keep otherEntries (anything not done+stamped), stillReferenced,
    // and tooYoung (recent uploads — the backfill may not have swapped yet).
    // From safeOldEligible: drop everything.
    let survivors = [...otherEntries, ...stillReferenced, ...tooYoung];

    // Phase 3: enforce hard cap on retained done entries. Even
    // referenced/young entries count toward the cap because a
    // pathological queue with thousands of references would still
    // bloat AsyncStorage. We keep the newest done entries first.
    const survivingDone = survivors
      .filter((e) => e.status === "done")
      .sort((a, b) => b.createdAt - a.createdAt);
    if (survivingDone.length > MAX_DONE_ENTRIES) {
      const toPrune = new Set(
        survivingDone.slice(MAX_DONE_ENTRIES).map((e) => e.clientId),
      );
      survivors = survivors.filter((e) => !toPrune.has(e.clientId));
    }

    const prunedCount = this.entries.length - survivors.length;
    if (prunedCount === 0) return 0;

    // Phase 4: delete local files for pruned entries (best-effort).
    const survivorIds = new Set(survivors.map((e) => e.clientId));
    if (Platform.OS !== "web") {
      const toDelete = this.entries.filter((e) => !survivorIds.has(e.clientId));
      // Run deletes in parallel but don't block on them — file system
      // cleanup is non-critical.
      Promise.all(
        toDelete.map((e) =>
          e.localUri.startsWith(PHOTOS_DIR)
            ? FileSystem.deleteAsync(e.localUri, { idempotent: true }).catch(() => {})
            : Promise.resolve(),
        ),
      ).catch(() => {});
    }

    this.entries = survivors;
    await this.persist();
    this.emit();
    console.log(
      `[PhotoQueue] Pruned ${prunedCount} done entries. Queue size: ${this.entries.length}`,
    );
    return prunedCount;
  }

  /**
   * v65+: reset retry timers on entries whose `lastAttemptAt` is older
   * than max-retry-delay × 2. This happens when the app was backgrounded
   * for a long time and iOS suspended our `setInterval`. Without this,
   * an entry sitting at attempt 6 with lastAttemptAt = 5 hours ago and
   * delay = 180s technically "passes" the retry check… but only on the
   * NEXT sync tick (which is also delayed). Clearing the timer makes
   * the very next sync pick them up immediately.
   *
   * Called from the AppState foreground transition.
   */
  resetStaleRetryTimers(): void {
    const now = Date.now();
    const longestDelay = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const staleThreshold = longestDelay * 2;
    let changed = false;
    this.entries = this.entries.map((e) => {
      if (
        (e.status === "pending" || e.status === "failed") &&
        e.lastAttemptAt &&
        now - e.lastAttemptAt > staleThreshold
      ) {
        changed = true;
        return { ...e, lastAttemptAt: null };
      }
      return e;
    });
    if (changed) {
      this.schedulePersist();
      this.emit();
    }
  }

  get stats() {
    const pending = this.entries.filter((e) => e.status === "pending").length;
    const uploading = this.entries.filter((e) => e.status === "uploading").length;
    const done = this.entries.filter((e) => e.status === "done").length;
    const failed = this.entries.filter((e) => e.status === "failed").length;
    return { pending, uploading, done, failed, total: this.entries.length };
  }
}
