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
  createdAt: number;
  stampMeta?: StampMeta;
  stamped?: boolean;
  /** R2 key for async stamping after upload */
  r2Key?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_STORAGE_KEY = "@autohaul/photo_queue_v1";
const PHOTOS_DIR = (FileSystem.documentDirectory ?? "") + "inspection_photos/";
const MAX_RETRIES = 10;
const RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 90_000, 180_000];
const BACKGROUND_INTERVAL_MS = 15_000;
const UPLOAD_CONCURRENCY = 4;
const STALE_UPLOAD_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 30_000;

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

function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = UPLOAD_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Queue Class ──────────────────────────────────────────────────────────────

type Listener = (entries: PhotoQueueEntry[]) => void;

export class PhotoQueue {
  entries: PhotoQueueEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private syncing = false;
  private loaded = false;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private appState: AppStateStatus = AppState.currentState;

  async load() {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
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

  startBackgroundRetry(): void {
    if (this.backgroundTimer) return;
    this.load().then(() => this.sync()).catch((err) => console.warn("[PhotoQueue]", err));
    this.backgroundTimer = setInterval(() => {
      this.sync().catch((err) => console.warn("[PhotoQueue]", err));
    }, BACKGROUND_INTERVAL_MS);

    // Resume uploads immediately when app returns to foreground
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
        if (next === "active" && this.appState !== "active") {
          this.sync().catch(() => {});
        }
        this.appState = next;
      });
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
  }

  async enqueue(
    tempUri: string,
    meta?: { loadId?: string; vehicleId?: string; loadNumber?: string; stampMeta?: StampMeta }
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
      loadNumber: meta?.loadNumber,
      createdAt: Date.now(),
      stampMeta: meta?.stampMeta,
      stamped: !meta?.stampMeta,
    };

    this.entries.push(entry);
    await this.persist();
    this.emit();
    this.uploadEntry(entry).catch(() => {});
    return entry;
  }

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
    for (let i = 0; i < pending.length; i += UPLOAD_CONCURRENCY) {
      const batch = pending.slice(i, i + UPLOAD_CONCURRENCY);
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

  async sync(): Promise<void> {
    if (this.syncing) return;
    await this.load();

    const now = Date.now();

    // Watchdog: reset entries stuck in "uploading" for over 60 s back to
    // "pending" so they get retried instead of hanging forever.
    let rescued = false;
    for (const e of this.entries) {
      if (e.status === "uploading" && e.lastAttemptAt && now - e.lastAttemptAt > STALE_UPLOAD_MS) {
        e.status = "pending";
        rescued = true;
      }
    }
    if (rescued) {
      this.persist();
      this.emit();
    }

    const ready = this.entries.filter((e) => {
      if (e.status !== "pending" && e.status !== "failed") return false;
      if (e.attempts >= MAX_RETRIES) return false;
      if (!e.lastAttemptAt) return true;
      const delay = RETRY_DELAYS_MS[Math.min(e.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      return now - e.lastAttemptAt >= delay;
    });

    if (ready.length === 0) return;

    const online = await isOnline();
    if (!online) return;

    this.syncing = true;
    try {
      for (let i = 0; i < ready.length; i += UPLOAD_CONCURRENCY) {
        const batch = ready.slice(i, i + UPLOAD_CONCURRENCY);
        await Promise.all(batch.map((entry) => this.uploadEntry(entry)));
      }
    } finally {
      this.syncing = false;
    }
  }

  private async uploadEntry(entry: PhotoQueueEntry): Promise<void> {
    this.updateEntry(entry.clientId, { status: "uploading", lastAttemptAt: Date.now() });

    try {
      // Compress before upload (reduces ~8-12MB to ~300-800KB)
      const compressedUri = await compressImage(entry.localUri);
      const vin = entry.stampMeta?.vin;
      const groupKey = entry.loadNumber && vin
        ? `${entry.loadNumber}/${vin}`
        : entry.loadNumber
          ? entry.loadNumber
          : [entry.loadId, entry.vehicleId].filter(Boolean).join("-") || "inspections";
      const apiBase = getUploadApiBase();

      // Step 1: Get a presigned upload URL (with timeout)
      const params = new URLSearchParams({
        ext: "jpg",
        groupKey,
        clientId: entry.clientId,
      });
      const presignRes = await fetchWithTimeout(`${apiBase}/api/photos/upload-url?${params}`);
      if (!presignRes.ok) {
        throw new Error(`Presign failed: HTTP ${presignRes.status}`);
      }
      const { uploadUrl, publicUrl, key } = await presignRes.json() as {
        uploadUrl: string;
        publicUrl: string;
        key: string;
        clientId: string;
      };

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
        const uploadPromise = FileSystem.uploadAsync(uploadUrl, compressedUri, {
          httpMethod: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("R2 upload timed out")), UPLOAD_TIMEOUT_MS)
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

      // Step 3: Fire-and-forget async stamp on the server
      if (entry.stampMeta && !entry.stamped) {
        const sm = entry.stampMeta;
        this.requestAsyncStamp(apiBase, key, sm).then(() => {
          this.updateEntry(entry.clientId, { stamped: true });
        }).catch(() => {});
      }
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
