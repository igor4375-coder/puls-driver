/**
 * Regression tests for the v85 photo-queue memory fixes.
 *
 * Background: a driver whose queue could not drain accumulated pending
 * entries without bound. Every sync pass walked the entire backlog, and every
 * per-entry status change copied the whole entries array out to listeners, so
 * the work grew with the square of the queue length. The pass that starts
 * immediately at launch exhausted the Hermes heap in ~13 seconds and the
 * process aborted (SIGABRT via GCBase::oom), which in turn meant photos never
 * uploaded and statuses never reached dispatch.
 *
 * These tests pin the three properties that make that impossible:
 *   1. a sync pass touches a bounded number of entries
 *   2. listener notifications coalesce instead of firing per entry
 *   3. the queue has an absolute size ceiling, and overflow that was never
 *      uploaded is quarantined rather than destroyed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const asyncStorageData: Record<string, string> = {};

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageData[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageData[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete asyncStorageData[key];
    }),
  },
}));

const uploadAsync = vi.fn(async () => ({ status: 200 }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file://app/documents/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  FileSystemUploadType: { BINARY_CONTENT: "binary" },
  FileSystemSessionType: { BACKGROUND: "background" },
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  makeDirectoryAsync: vi.fn(async () => {}),
  copyAsync: vi.fn(async () => {}),
  deleteAsync: vi.fn(async () => {}),
  readAsStringAsync: vi.fn(async () => "base64encodeddata"),
  uploadAsync: (...args: unknown[]) => uploadAsync(...(args as [])),
}));

vi.mock("expo-network", () => ({
  NetworkStateType: { WIFI: "WIFI", CELLULAR: "CELLULAR" },
  getNetworkStateAsync: vi.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
    type: "CELLULAR",
  })),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

// Mocked so the real modules don't pull expo-modules-core / convex into a
// plain node test environment.
vi.mock("../lib/image-compress", () => ({
  compressImage: vi.fn(async (uri: string) => uri),
}));

vi.mock("../lib/inspection-photo-progress", () => ({
  reportPhotoCaptured: vi.fn(),
  reportPhotoUploaded: vi.fn(),
}));

import { PhotoQueue, type PhotoQueueEntry } from "../lib/photo-queue-class";

const MAX_ENTRIES_PER_SYNC = 12;
const HARD_MAX_ENTRIES = 1500;
const QUEUE_KEY = "@autohaul/photo_queue_v1";

function entry(i: number, status: PhotoQueueEntry["status"] = "pending"): PhotoQueueEntry {
  return {
    clientId: `c${i}`,
    localUri: `file://app/documents/inspection_photos/p${i}.jpg`,
    remoteUrl: status === "done" ? `https://cdn.test/p${i}.jpg` : null,
    status,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: 1_000 + i,
  };
}

beforeEach(() => {
  for (const k of Object.keys(asyncStorageData)) delete asyncStorageData[k];
  vi.clearAllMocks();
  uploadAsync.mockResolvedValue({ status: 200 });
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      uploadUrl: "https://r2.test/put",
      publicUrl: "https://cdn.test/p.jpg",
      key: "k",
      clientId: "c",
    }),
  })) as unknown as typeof fetch;
});

describe("sync pass is bounded", () => {
  it("uploads at most MAX_ENTRIES_PER_SYNC entries even with a large backlog", async () => {
    const q = new PhotoQueue();
    (q as any).loaded = true;
    q.entries = Array.from({ length: 50 }, (_, i) => entry(i));

    await q.sync();

    expect(uploadAsync.mock.calls.length).toBeLessThanOrEqual(MAX_ENTRIES_PER_SYNC);
    expect(uploadAsync.mock.calls.length).toBeGreaterThan(0);
  });

  it("drains oldest-first so early photos are not starved", async () => {
    const q = new PhotoQueue();
    (q as any).loaded = true;
    // Newest first in the array — the pass should still take the oldest.
    q.entries = Array.from({ length: 40 }, (_, i) => entry(40 - i));

    await q.sync();

    const uploaded = q.entries.filter((e) => e.status === "done").map((e) => e.createdAt);
    const untouched = q.entries.filter((e) => e.status === "pending").map((e) => e.createdAt);
    expect(Math.max(...uploaded)).toBeLessThan(Math.min(...untouched));
  });
});

describe("listener notifications coalesce", () => {
  it("does not notify once per entry during a burst of updates", async () => {
    const q = new PhotoQueue();
    (q as any).loaded = true;
    q.entries = Array.from({ length: 30 }, (_, i) => entry(i));

    const listener = vi.fn();
    q.subscribe(listener);
    listener.mockClear();

    for (let i = 0; i < 30; i++) {
      (q as any).updateEntry(`c${i}`, { attempts: 1 });
    }

    // One leading notification; the other 29 collapse into a trailing one.
    expect(listener.mock.calls.length).toBeLessThan(5);
  });
});

describe("queue size ceiling", () => {
  it("trims an oversized queue of completed entries down to the cap", async () => {
    const oversized = Array.from({ length: HARD_MAX_ENTRIES + 100 }, (_, i) => entry(i, "done"));
    asyncStorageData[QUEUE_KEY] = JSON.stringify(oversized);

    const q = new PhotoQueue();
    await q.load();

    expect(q.entries.length).toBe(HARD_MAX_ENTRIES);
    expect(q.lastTrim).not.toBeNull();
    expect(q.lastTrim?.from).toBe(HARD_MAX_ENTRIES + 100);
  });

  it("quarantines un-uploaded overflow instead of destroying it", async () => {
    const oversized = Array.from({ length: HARD_MAX_ENTRIES + 60 }, (_, i) => entry(i, "pending"));
    asyncStorageData[QUEUE_KEY] = JSON.stringify(oversized);

    const q = new PhotoQueue();
    await q.load();

    expect(q.entries.length).toBe(HARD_MAX_ENTRIES);
    expect(q.lastTrim?.quarantined).toBe(60);

    const quarantined = JSON.parse(asyncStorageData[`${QUEUE_KEY}:quarantine`]);
    expect(quarantined).toHaveLength(60);
    // The oldest entries are the ones set aside; newest stay in the live queue.
    expect(quarantined.every((e: PhotoQueueEntry) => e.createdAt <= 1_060)).toBe(true);
  });

  it("leaves a normal-sized queue untouched", async () => {
    asyncStorageData[QUEUE_KEY] = JSON.stringify(Array.from({ length: 40 }, (_, i) => entry(i)));

    const q = new PhotoQueue();
    await q.load();

    expect(q.entries.length).toBe(40);
    expect(q.lastTrim).toBeNull();
  });

  it("records the persisted payload size for diagnostics", async () => {
    const payload = JSON.stringify(Array.from({ length: 10 }, (_, i) => entry(i)));
    asyncStorageData[QUEUE_KEY] = payload;

    const q = new PhotoQueue();
    await q.load();

    expect(q.payloadBytes).toBe(payload.length);
  });
});
