/**
 * PhotoQueue class — exported separately for unit testing.
 * The singleton `photoQueue` lives in photo-queue.ts and imports from here.
 *
 * Upload lifecycle:
 * 1. Photos are enqueued as "pending" — NOT uploaded immediately.
 * 2. flushForVehicle() is called on Save — uploads only the final set for that vehicle.
 * 3. A background retry loop (startBackgroundRetry) runs every BACKGROUND_INTERVAL_MS
 *    and retries any pending/failed photos that are ready for another attempt.
 *    This ensures photos keep uploading even after the driver marks a vehicle as picked up.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { Platform } from "react-native";
import { compressImage } from "./image-compress";

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
  createdAt: number;
  stampMeta?: StampMeta;
  stamped?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_STORAGE_KEY = "@autohaul/photo_queue_v1";
const PHOTOS_DIR = (FileSystem.documentDirectory ?? "") + "inspection_photos/";
const MAX_RETRIES = 10; // Keep retrying until success (up to 10 attempts)
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000]; // escalating backoff
const BACKGROUND_INTERVAL_MS = 20_000; // Check for pending uploads every 20 seconds

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

// ─── Queue Class ──────────────────────────────────────────────────────────────

type Listener = (entries: PhotoQueueEntry[]) => void;

export class PhotoQueue {
  entries: PhotoQueueEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private syncing = false;
  private loaded = false;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;

  async load() {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      this.entries = raw ? JSON.parse(raw) : [];
      // Reset any "uploading" entries to "pending" (app was killed mid-upload)
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

  private async persist() {
    try {
      await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.entries));
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
   * Start the background retry loop.
   * Call once at app startup (in _layout.tsx or a top-level provider).
   * The loop checks every BACKGROUND_INTERVAL_MS for any pending photos
   * that are ready to upload (respecting backoff delays), and uploads them.
   * This ensures photos keep uploading even after the driver navigates away
   * or marks a vehicle as picked up.
   */
  startBackgroundRetry(): void {
    if (this.backgroundTimer) return; // already running
    // Run once immediately on start to catch any pending from a previous session
    this.load().then(() => this.sync()).catch((err) => console.warn("[PhotoQueue]", err));
    this.backgroundTimer = setInterval(() => {
      this.sync().catch((err) => console.warn("[PhotoQueue]", err));
    }, BACKGROUND_INTERVAL_MS);
  }

  stopBackgroundRetry(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  async enqueue(
    tempUri: string,
    meta?: { loadId?: string; vehicleId?: string; stampMeta?: StampMeta }
  ): Promise<PhotoQueueEntry> {
    await this.load();

    const clientId = uuid();
    let localUri = tempUri;

    if (Platform.OS !== "web") {
      try {
        await ensurePhotosDir();
        const ext = tempUri.split(".").pop()?.split("?")[0] ?? "jpg";
        const dest = `${PHOTOS_DIR}${clientId}.${ext}`;
        await FileSystem.copyAsync({ from: tempUri, to: dest });
        localUri = dest;
      } catch {
        localUri = tempUri;
      }
    }

    const entry: PhotoQueueEntry = {
      clientId,
      localUri,
      remoteUrl: null,
      status: "pending",
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      loadId: meta?.loadId,
      vehicleId: meta?.vehicleId,
      createdAt: Date.now(),
      stampMeta: meta?.stampMeta,
      stamped: !meta?.stampMeta,
    };

    this.entries.push(entry);
    await this.persist();
    this.emit();
    // Start stamp+upload immediately in the background so most photos are
    // already on R2 by the time the driver hits Save.
    this.uploadEntry(entry).catch((err) => console.warn("[PhotoQueue]", err));
    return entry;
  }

  /**
   * Upload all pending photos for a specific vehicle immediately.
   * Call this when the driver taps Save on the inspection screen.
   * Photos deleted before Save are already removed from the queue and never uploaded.
   * After this returns, the background retry loop will handle any that failed.
   */
  async flushForVehicle(loadId: string, vehicleId: string): Promise<void> {
    await this.load();
    const pending = this.entries.filter(
      (e) =>
        (e.status === "pending" || e.status === "uploading") &&
        e.attempts < MAX_RETRIES &&
        e.loadId === loadId &&
        e.vehicleId === vehicleId
    );
    if (pending.length === 0) return;
    const online = await isOnline();
    if (!online) return;
    const CONCURRENCY = 3;
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((snapshot) => {
        // Re-read current status from the live entries array because the
        // enqueue-triggered background upload may have already started.
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

  /**
   * Flush all pending uploads for a vehicle AND return the S3 URLs.
   * This is the method to call before syncInspection to avoid the race condition
   * where photos: [] is sent because uploads haven't completed yet.
   *
   * Returns an array of S3 URLs (http/https) for all successfully uploaded photos
   * belonging to this vehicle. Local URIs for failed uploads are excluded.
   */
  async flushAndGetUrls(loadId: string, vehicleId: string): Promise<string[]> {
    // First, flush all pending uploads (waits for each to complete)
    await this.flushForVehicle(loadId, vehicleId);

    // Now read back the entries — any that succeeded will have remoteUrl set
    const vehicleEntries = this.entries.filter(
      (e) => e.loadId === loadId && e.vehicleId === vehicleId
    );
    return vehicleEntries
      .map((e) => e.remoteUrl)
      .filter((url): url is string => url != null && url.startsWith("http"));
  }

  /**
   * Sync all pending/failed photos that are ready for upload (respects backoff).
   * Called by the background retry loop and by retryFailed().
   */
  async sync(): Promise<void> {
    if (this.syncing) return;
    await this.load();

    const now = Date.now();
    const ready = this.entries.filter((e) => {
      if (e.status !== "pending" && e.status !== "failed") return false;
      if (e.attempts >= MAX_RETRIES) return false;
      if (!e.lastAttemptAt) return true; // never attempted
      const delay = RETRY_DELAYS_MS[Math.min(e.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      return now - e.lastAttemptAt >= delay;
    });

    if (ready.length === 0) return;

    const online = await isOnline();
    if (!online) return;

    this.syncing = true;
    try {
      for (const entry of ready) {
        await this.uploadEntry(entry);
      }
    } finally {
      this.syncing = false;
    }
  }

  private async uploadEntry(entry: PhotoQueueEntry): Promise<void> {
    this.updateEntry(entry.clientId, { status: "uploading" });

    try {
      // Stamp the photo if stamp metadata is present and not yet stamped
      let sourceUri = entry.localUri;
      if (entry.stampMeta && !entry.stamped) {
        try {
          const { stampPhotoViaServer } = await import("./stamp-photo-client");
          const sm = entry.stampMeta;
          const stampedUri = await stampPhotoViaServer(sourceUri, {
            inspectionType: sm.inspectionType,
            driverCode: sm.driverCode,
            companyName: sm.companyName,
            vin: sm.vin,
            locationLabel: sm.locationLabel,
            coords: sm.lat != null && sm.lng != null
              ? { latitude: sm.lat, longitude: sm.lng }
              : null,
            capturedAt: sm.capturedAt,
          });
          sourceUri = stampedUri;
          this.updateEntry(entry.clientId, { stamped: true, localUri: stampedUri });
        } catch (stampErr) {
          console.warn("[PhotoQueue] Stamp failed, uploading raw:", stampErr);
          this.updateEntry(entry.clientId, { stamped: true });
        }
      }

      // Compress before upload (reduces file size ~10-15x)
      const compressedUri = await compressImage(sourceUri);
      const groupKey = [entry.loadId, entry.vehicleId].filter(Boolean).join("-") || "inspections";
      const apiBase = getUploadApiBase();

      // Step 1: Get a presigned upload URL from our server (tiny request)
      const params = new URLSearchParams({
        ext: "jpg",
        groupKey,
        clientId: entry.clientId,
      });
      const presignRes = await fetch(`${apiBase}/api/photos/upload-url?${params}`);
      if (!presignRes.ok) {
        throw new Error(`Presign failed: HTTP ${presignRes.status}`);
      }
      const { uploadUrl, publicUrl } = await presignRes.json() as {
        uploadUrl: string;
        publicUrl: string;
        key: string;
        clientId: string;
      };

      // Step 2: Upload the photo directly to R2 (bypasses our server entirely)
      let uploadResponse: Response;

      if (Platform.OS === "web") {
        const blobRes = await fetch(compressedUri);
        const blob = await blobRes.blob();
        uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
      } else {
        // React Native: use FileSystem.uploadAsync for efficient binary streaming
        const result = await FileSystem.uploadAsync(uploadUrl, compressedUri, {
          httpMethod: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        });
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`R2 upload failed: HTTP ${result.status}`);
        }
        // Create a synthetic Response for the success path
        uploadResponse = new Response(null, { status: result.status });
      }

      if (Platform.OS === "web" && !uploadResponse.ok) {
        throw new Error(`R2 upload failed: HTTP ${uploadResponse.status}`);
      }

      this.updateEntry(entry.clientId, {
        status: "done",
        remoteUrl: publicUrl,
        lastError: null,
        lastAttemptAt: Date.now(),
        attempts: entry.attempts + 1,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      const attempts = entry.attempts + 1;
      this.updateEntry(entry.clientId, {
        status: attempts >= MAX_RETRIES ? "failed" : "pending",
        lastError: message,
        lastAttemptAt: Date.now(),
        attempts,
      });
    }
  }

  private updateEntry(clientId: string, patch: Partial<PhotoQueueEntry>) {
    this.entries = this.entries.map((e) =>
      e.clientId === clientId ? { ...e, ...patch } : e
    );
    this.persist();
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
    this.entries = this.entries.map((e) =>
      e.status === "failed" ? { ...e, status: "pending" as PhotoStatus, attempts: 0, lastAttemptAt: null } : e
    );
    await this.persist();
    this.emit();
    await this.sync();
  }

  get stats() {
    const pending = this.entries.filter((e) => e.status === "pending").length;
    const uploading = this.entries.filter((e) => e.status === "uploading").length;
    const done = this.entries.filter((e) => e.status === "done").length;
    const failed = this.entries.filter((e) => e.status === "failed").length;
    return { pending, uploading, done, failed, total: this.entries.length };
  }
}
