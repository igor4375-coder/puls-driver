/**
 * Tests for the offline photo queue logic.
 *
 * We test the PhotoQueue class directly without real device APIs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

const asyncStorageData: Record<string, string> = {};

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageData[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => { asyncStorageData[key] = value; }),
    removeItem: vi.fn(async (key: string) => { delete asyncStorageData[key]; }),
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file://app/documents/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  makeDirectoryAsync: vi.fn(async () => {}),
  copyAsync: vi.fn(async () => {}),
  deleteAsync: vi.fn(async () => {}),
  readAsStringAsync: vi.fn(async () => "base64encodeddata"),
}));

// Network mock — online by default, can be overridden per test
let networkOnline = true;
vi.mock("expo-network", () => ({
  getNetworkStateAsync: vi.fn(async () => ({
    isConnected: networkOnline,
    isInternetReachable: networkOnline,
  })),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ─── Import after mocks ───────────────────────────────────────────────────────

import { PhotoQueue } from "../lib/photo-queue-class";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fresh queue instance (not loaded) for each test */
function makeQueue() {
  const q = new PhotoQueue();
  // Mark as loaded to skip AsyncStorage read
  (q as any).loaded = true;
  return q;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(asyncStorageData).forEach((k) => delete asyncStorageData[k]);
  networkOnline = true;
  vi.clearAllMocks();
  // Default fetch mock: successful upload
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ result: { data: { url: "https://s3.example.com/uploaded.jpg" } } }),
    text: async () => "",
  });
});

// ─── Entry lifecycle ──────────────────────────────────────────────────────────

describe("Photo Queue — entry lifecycle", () => {
  it("generates a unique clientId for each enqueued photo", async () => {
    const q = makeQueue();
    const e1 = await q.enqueue("file://temp/photo1.jpg");
    const e2 = await q.enqueue("file://temp/photo2.jpg");
    expect(e1.clientId).toBeTruthy();
    expect(e2.clientId).toBeTruthy();
    expect(e1.clientId).not.toBe(e2.clientId);
  });

  it("sets initial status to pending", async () => {
    const q = makeQueue();
    const entry = await q.enqueue("file://temp/photo.jpg");
    expect(entry.status).toBe("pending");
  });

  it("copies photo to permanent storage and updates localUri", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const q = makeQueue();
    const entry = await q.enqueue("file://temp/camera-shot.jpg");
    expect(FileSystem.copyAsync).toHaveBeenCalled();
    expect(entry.localUri).toContain("inspection_photos");
  });

  it("stores metadata on the entry", async () => {
    const q = makeQueue();
    const entry = await q.enqueue("file://temp/photo.jpg", {
      loadId: "load-123",
      vehicleId: "1HGBH41JXMN109186",
    });
    expect(entry.loadId).toBe("load-123");
    expect(entry.vehicleId).toBe("1HGBH41JXMN109186");
  });

  it("persists queue to AsyncStorage after enqueue", async () => {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    const q = makeQueue();
    await q.enqueue("file://temp/photo.jpg");
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  it("removes entry and deletes local file on remove()", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const q = makeQueue();
    const entry = await q.enqueue("file://temp/photo.jpg");
    await q.remove(entry.clientId);
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
    expect(q.getEntries()).toHaveLength(0);
  });

  it("resolvedUri returns remoteUrl when available", async () => {
    const q = makeQueue();
    const entry = await q.enqueue("file://temp/photo.jpg");
    q.entries = q.entries.map((e) =>
      e.clientId === entry.clientId
        ? { ...e, remoteUrl: "https://s3.example.com/photo.jpg", status: "done" as const }
        : e
    );
    expect(q.resolvedUri(entry.clientId)).toBe("https://s3.example.com/photo.jpg");
  });

  it("resolvedUri falls back to localUri when no remoteUrl", async () => {
    const q = makeQueue();
    const entry = await q.enqueue("file://temp/photo.jpg");
    const resolved = q.resolvedUri(entry.clientId);
    expect(resolved).toBe(entry.localUri);
  });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

describe("Photo Queue — stats", () => {
  it("counts pending, done, and failed entries correctly", async () => {
    const q = makeQueue();
    await q.enqueue("file://temp/p1.jpg");
    await q.enqueue("file://temp/p2.jpg");
    q.entries[0].status = "done";
    q.entries[0].remoteUrl = "https://s3.example.com/p1.jpg";
    q.entries[1].status = "failed";

    const stats = q.stats;
    expect(stats.done).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.total).toBe(2);
  });

  it("retryFailed resets failed entries back to pending", async () => {
    // Offline so sync() won't immediately change status back
    networkOnline = false;
    const q = makeQueue();
    await q.enqueue("file://temp/p1.jpg");
    q.entries[0].status = "failed";
    q.entries[0].attempts = 3;

    await q.retryFailed();
    expect(q.getEntries()[0].status).toBe("pending");
    expect(q.getEntries()[0].attempts).toBe(0);
  });
});

// ─── Upload ───────────────────────────────────────────────────────────────────

describe("Photo Queue — upload", () => {
  it("marks entry as done after successful upload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { data: { url: "https://s3.example.com/uploaded.jpg" } } }),
      text: async () => "",
    });

    const q = makeQueue();
    // Add entry directly (skip background sync from enqueue)
    q.entries.push({
      clientId: "test-client-1",
      localUri: "file://app/documents/inspection_photos/test-client-1.jpg",
      remoteUrl: null,
      status: "pending",
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      createdAt: Date.now(),
    });

    await q.sync();

    const updated = q.getEntries().find((e) => e.clientId === "test-client-1");
    expect(updated?.status).toBe("done");
    expect(updated?.remoteUrl).toBe("https://s3.example.com/uploaded.jpg");
  });

  it("marks entry as pending (retry) after failed upload when under max retries", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
      json: async () => ({}),
    });

    const q = makeQueue();
    q.entries.push({
      clientId: "test-client-2",
      localUri: "file://app/documents/inspection_photos/test-client-2.jpg",
      remoteUrl: null,
      status: "pending",
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      createdAt: Date.now(),
    });

    await q.sync();

    const updated = q.getEntries().find((e) => e.clientId === "test-client-2");
    expect(updated?.status).toBe("pending");
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBeTruthy();
  });

  it("marks entry as failed after max retries exceeded", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Server Error",
      json: async () => ({}),
    });

    const q = makeQueue();
    q.entries.push({
      clientId: "test-client-3",
      localUri: "file://app/documents/inspection_photos/test-client-3.jpg",
      remoteUrl: null,
      status: "pending",
      attempts: 9, // one more attempt will reach MAX_RETRIES (10)
      lastAttemptAt: null,
      lastError: null,
      createdAt: Date.now(),
    });

    await q.sync();

    const updated = q.getEntries().find((e) => e.clientId === "test-client-3");
    expect(updated?.status).toBe("failed");
  });

  it("skips upload when offline", async () => {
    networkOnline = false;

    const q = makeQueue();
    q.entries.push({
      clientId: "test-client-4",
      localUri: "file://app/documents/inspection_photos/test-client-4.jpg",
      remoteUrl: null,
      status: "pending",
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      createdAt: Date.now(),
    });

    await q.sync();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(q.getEntries()[0].status).toBe("pending");
  });
});

// ─── flushAndGetUrls ─────────────────────────────────────────────────────────

describe("Photo Queue — flushAndGetUrls", () => {
  it("uploads pending photos and returns S3 URLs", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ result: { data: { json: { url: "https://s3.example.com/photo-a.jpg" } } } }],
      text: async () => "",
    });

    const q = makeQueue();
    q.entries.push(
      {
        clientId: "flush-1",
        localUri: "file://app/documents/inspection_photos/flush-1.jpg",
        remoteUrl: null,
        status: "pending" as const,
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        loadId: "load-A",
        vehicleId: "vin-A",
        createdAt: Date.now(),
      },
      {
        clientId: "flush-2",
        localUri: "file://app/documents/inspection_photos/flush-2.jpg",
        remoteUrl: null,
        status: "pending" as const,
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        loadId: "load-A",
        vehicleId: "vin-A",
        createdAt: Date.now(),
      }
    );

    const urls = await q.flushAndGetUrls("load-A", "vin-A");

    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^https?:\/\//);
    expect(urls[1]).toMatch(/^https?:\/\//);
    // All entries should be done
    expect(q.getEntries().every((e) => e.status === "done")).toBe(true);
  });

  it("includes already-uploaded entries in the returned URLs", async () => {
    const q = makeQueue();
    q.entries.push({
      clientId: "already-done",
      localUri: "file://app/documents/inspection_photos/already-done.jpg",
      remoteUrl: "https://s3.example.com/already-done.jpg",
      status: "done" as const,
      attempts: 1,
      lastAttemptAt: Date.now(),
      lastError: null,
      loadId: "load-B",
      vehicleId: "vin-B",
      createdAt: Date.now(),
    });

    const urls = await q.flushAndGetUrls("load-B", "vin-B");

    expect(urls).toEqual(["https://s3.example.com/already-done.jpg"]);
    // fetch should NOT have been called — nothing pending
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("excludes failed entries (no remoteUrl) from returned URLs", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Server Error",
      json: async () => ({}),
    });

    const q = makeQueue();
    q.entries.push({
      clientId: "will-fail",
      localUri: "file://app/documents/inspection_photos/will-fail.jpg",
      remoteUrl: null,
      status: "pending" as const,
      attempts: 9, // At max retries — next attempt will mark as failed
      lastAttemptAt: null,
      lastError: null,
      loadId: "load-C",
      vehicleId: "vin-C",
      createdAt: Date.now(),
    });

    const urls = await q.flushAndGetUrls("load-C", "vin-C");

    expect(urls).toHaveLength(0);
    expect(q.getEntries()[0].status).toBe("failed");
  });

  it("only returns URLs for the specified vehicle, not other vehicles", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ result: { data: { json: { url: "https://s3.example.com/v1-photo.jpg" } } } }],
      text: async () => "",
    });

    const q = makeQueue();
    q.entries.push(
      {
        clientId: "v1-photo",
        localUri: "file://app/documents/inspection_photos/v1-photo.jpg",
        remoteUrl: null,
        status: "pending" as const,
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        loadId: "load-D",
        vehicleId: "vin-D1",
        createdAt: Date.now(),
      },
      {
        clientId: "v2-photo",
        localUri: "file://app/documents/inspection_photos/v2-photo.jpg",
        remoteUrl: "https://s3.example.com/v2-photo.jpg",
        status: "done" as const,
        attempts: 1,
        lastAttemptAt: Date.now(),
        lastError: null,
        loadId: "load-D",
        vehicleId: "vin-D2",
        createdAt: Date.now(),
      }
    );

    const urls = await q.flushAndGetUrls("load-D", "vin-D1");

    // Should only contain the v1 photo, not v2
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("v1-photo");
  });

  it("returns empty array when offline and no photos were previously uploaded", async () => {
    networkOnline = false;

    const q = makeQueue();
    q.entries.push({
      clientId: "offline-photo",
      localUri: "file://app/documents/inspection_photos/offline-photo.jpg",
      remoteUrl: null,
      status: "pending" as const,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      loadId: "load-E",
      vehicleId: "vin-E",
      createdAt: Date.now(),
    });

    const urls = await q.flushAndGetUrls("load-E", "vin-E");

    // Offline — upload didn't happen, no remoteUrl
    expect(urls).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
