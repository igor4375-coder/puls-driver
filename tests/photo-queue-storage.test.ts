/**
 * Regression tests for the v133 photo-storage reclamation.
 *
 * Background: nothing ever deleted a photo after it uploaded. Originals were
 * copied into documentDirectory, compression wrote a fresh file on every
 * attempt, and a file was only ever deleted while the queue still held the
 * entry pointing at it — so an account switch, a corrupt queue file or an
 * emergency trim stranded its files permanently. One driver's install reached
 * 102 GB.
 *
 * The dangerous failure mode of the fix is deleting an inspection photo that
 * never made it to the cloud, so most of what's pinned here is what must
 * survive: pending entries, recent captures, and other drivers' scopes.
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
    getAllKeys: vi.fn(async () => Object.keys(asyncStorageData)),
  },
}));

const PHOTOS_DIR = "file://app/documents/inspection_photos/";

/** Virtual disk: uri -> file. modificationTime is in seconds, as expo reports. */
let disk: Record<string, { size: number; modificationTime: number }> = {};

const deleteAsync = vi.fn(async (uri: string) => {
  delete disk[uri];
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file://app/documents/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  FileSystemUploadType: { BINARY_CONTENT: "binary" },
  FileSystemSessionType: { BACKGROUND: "background" },
  getInfoAsync: vi.fn(async (uri: string) => {
    if (uri === PHOTOS_DIR) return { exists: true, isDirectory: true, uri };
    const f = disk[uri];
    return f ? { exists: true, isDirectory: false, uri, ...f } : { exists: false, uri };
  }),
  readDirectoryAsync: vi.fn(async (dir: string) =>
    Object.keys(disk)
      .filter((u) => u.startsWith(dir))
      .map((u) => u.slice(dir.length)),
  ),
  makeDirectoryAsync: vi.fn(async () => {}),
  copyAsync: vi.fn(async () => {}),
  deleteAsync: (...args: unknown[]) => deleteAsync(...(args as [string])),
  readAsStringAsync: vi.fn(async () => "base64encodeddata"),
  uploadAsync: vi.fn(async () => ({ status: 200 })),
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

vi.mock("../lib/image-compress", () => ({
  compressImage: vi.fn(async (uri: string) => uri),
}));

vi.mock("../lib/inspection-photo-progress", () => ({
  reportPhotoCaptured: vi.fn(),
  reportPhotoUploaded: vi.fn(),
}));

vi.mock("../lib/crash-reporter", () => ({
  addBreadcrumb: vi.fn(),
}));

import { PhotoQueue, type PhotoQueueEntry } from "../lib/photo-queue-class";

const QUEUE_KEY = "@autohaul/photo_queue_v1";
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

/** A file on disk, aged so the orphan grace period has elapsed. */
function putFile(name: string, { ageMs = 3 * DAY, size = MB } = {}) {
  disk[`${PHOTOS_DIR}${name}`] = {
    size,
    modificationTime: Math.floor((Date.now() - ageMs) / 1000),
  };
}

function entry(
  name: string,
  opts: { status?: PhotoQueueEntry["status"]; ageMs?: number; remoteUrl?: string | null } = {},
): PhotoQueueEntry {
  const { status = "done", ageMs = 3 * HOUR } = opts;
  return {
    clientId: name,
    localUri: `${PHOTOS_DIR}${name}`,
    remoteUrl:
      opts.remoteUrl !== undefined
        ? opts.remoteUrl
        : status === "done"
          ? `https://cdn.test/${name}`
          : null,
    status,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: Date.now() - ageMs,
  };
}

function seed(entries: PhotoQueueEntry[], key = QUEUE_KEY) {
  asyncStorageData[key] = JSON.stringify(entries);
}

beforeEach(() => {
  for (const k of Object.keys(asyncStorageData)) delete asyncStorageData[k];
  disk = {};
  vi.clearAllMocks();
});

describe("reclaiming uploaded photos", () => {
  it("deletes the local file once the photo is in the cloud, keeping the entry", async () => {
    putFile("uploaded.jpg");
    seed([entry("uploaded.jpg")]);

    const q = new PhotoQueue();
    const result = await q.reclaimUploadedFiles();

    expect(result.reclaimed).toBe(1);
    expect(result.bytesFreed).toBe(MB);
    expect(disk[`${PHOTOS_DIR}uploaded.jpg`]).toBeUndefined();

    // The entry survives — history, dedup and the URL backfill resolve
    // through it, and remoteUrl is what readers prefer anyway.
    const kept = q.getEntries().find((e) => e.clientId === "uploaded.jpg");
    expect(kept?.remoteUrl).toBe("https://cdn.test/uploaded.jpg");
    expect(kept?.localDeleted).toBe(true);
  });

  it("never touches a photo that has not uploaded", async () => {
    putFile("pending.jpg");
    putFile("failed.jpg");
    seed([entry("pending.jpg", { status: "pending" }), entry("failed.jpg", { status: "failed" })]);

    const result = await new PhotoQueue().reclaimUploadedFiles();

    expect(result.reclaimed).toBe(0);
    expect(disk[`${PHOTOS_DIR}pending.jpg`]).toBeDefined();
    expect(disk[`${PHOTOS_DIR}failed.jpg`]).toBeDefined();
  });

  it("leaves a just-uploaded photo alone until the URL backfill window passes", async () => {
    putFile("fresh.jpg");
    seed([entry("fresh.jpg", { ageMs: 5 * 60_000 })]);

    const result = await new PhotoQueue().reclaimUploadedFiles();

    expect(result.reclaimed).toBe(0);
    expect(disk[`${PHOTOS_DIR}fresh.jpg`]).toBeDefined();
  });

  it("skips an entry marked done without a real remote URL", async () => {
    putFile("nourl.jpg");
    seed([entry("nourl.jpg", { remoteUrl: null })]);

    expect((await new PhotoQueue().reclaimUploadedFiles()).reclaimed).toBe(0);
    expect(disk[`${PHOTOS_DIR}nourl.jpg`]).toBeDefined();
  });

  it("does not re-delete on a second pass", async () => {
    putFile("once.jpg");
    seed([entry("once.jpg")]);

    const q = new PhotoQueue();
    expect((await q.reclaimUploadedFiles()).reclaimed).toBe(1);
    expect((await q.reclaimUploadedFiles()).reclaimed).toBe(0);
  });
});

describe("sweeping orphaned files", () => {
  it("deletes a file no queue entry points at", async () => {
    putFile("orphan.jpg", { size: 3 * MB });
    seed([]);

    const result = await new PhotoQueue().sweepOrphanFiles();

    expect(result.deleted).toBe(1);
    expect(result.bytesFreed).toBe(3 * MB);
    expect(disk[`${PHOTOS_DIR}orphan.jpg`]).toBeUndefined();
  });

  it("keeps a file that is still referenced", async () => {
    putFile("live.jpg");
    seed([entry("live.jpg", { status: "pending" })]);

    expect((await new PhotoQueue().sweepOrphanFiles()).deleted).toBe(0);
    expect(disk[`${PHOTOS_DIR}live.jpg`]).toBeDefined();
  });

  it("keeps another driver's un-uploaded photo on a shared phone", async () => {
    // The sweep runs under one driver's scope; the file belongs to another
    // account's queue. Deleting it would destroy that driver's inspection.
    putFile("other-driver.jpg");
    seed([], `${QUEUE_KEY}:DRIVER_A`);
    seed([entry("other-driver.jpg", { status: "pending" })], `${QUEUE_KEY}:DRIVER_B`);

    const q = new PhotoQueue();
    q.setActiveDriver("DRIVER_A");

    expect((await q.sweepOrphanFiles()).deleted).toBe(0);
    expect(disk[`${PHOTOS_DIR}other-driver.jpg`]).toBeDefined();
  });

  it("keeps quarantined overflow from an emergency trim", async () => {
    putFile("quarantined.jpg");
    seed([]);
    seed([entry("quarantined.jpg", { status: "pending" })], `${QUEUE_KEY}:quarantine`);

    expect((await new PhotoQueue().sweepOrphanFiles()).deleted).toBe(0);
    expect(disk[`${PHOTOS_DIR}quarantined.jpg`]).toBeDefined();
  });

  it("recovers paths textually when a queue file is unparseable", async () => {
    // load() stashes a corrupt payload under :corrupt. It can't be parsed, so
    // the sweep must still recognise the paths inside it rather than treating
    // those photos as orphans.
    putFile("in-corrupt.jpg");
    seed([]);
    asyncStorageData[`${QUEUE_KEY}:corrupt`] =
      `[{"clientId":"x","localUri":"${PHOTOS_DIR}in-corrupt.jpg"`;

    expect((await new PhotoQueue().sweepOrphanFiles()).deleted).toBe(0);
    expect(disk[`${PHOTOS_DIR}in-corrupt.jpg`]).toBeDefined();
  });

  it("spares a file written moments ago", async () => {
    // A capture or compression output mid-flight is unreferenced for a moment.
    putFile("in-flight.jpg", { ageMs: 30_000 });
    seed([]);

    expect((await new PhotoQueue().sweepOrphanFiles()).deleted).toBe(0);
    expect(disk[`${PHOTOS_DIR}in-flight.jpg`]).toBeDefined();
  });

  it("deletes nothing if the other scopes cannot be read", async () => {
    // Without the full picture of what's referenced, deleting risks taking out
    // evidence, so the sweep must do nothing at all.
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    putFile("orphan.jpg");
    seed([]);
    const q = new PhotoQueue();
    await q.load();
    vi.mocked(AsyncStorage.getAllKeys).mockRejectedValueOnce(new Error("storage down"));

    expect((await q.sweepOrphanFiles()).deleted).toBe(0);
    expect(disk[`${PHOTOS_DIR}orphan.jpg`]).toBeDefined();
  });

  it("caps deletions per pass so a huge backlog can't block the JS thread", async () => {
    for (let i = 0; i < 1000; i++) putFile(`orphan${i}.jpg`);
    seed([]);

    const q = new PhotoQueue();
    expect((await q.sweepOrphanFiles()).deleted).toBe(400);
    // Repeated passes finish the job.
    expect((await q.sweepOrphanFiles()).deleted).toBe(400);
    expect((await q.sweepOrphanFiles()).deleted).toBe(200);
    expect((await q.sweepOrphanFiles()).deleted).toBe(0);
    expect(Object.keys(disk)).toHaveLength(0);
  });
});

describe("compressed temp files", () => {
  it("deletes the compressed copy after an upload attempt", async () => {
    const { compressImage } = await import("../lib/image-compress");
    putFile("original.jpg", { ageMs: 0 });
    disk[`${PHOTOS_DIR}compressed.jpg`] = { size: MB, modificationTime: Date.now() / 1000 };
    vi.mocked(compressImage).mockResolvedValueOnce(`${PHOTOS_DIR}compressed.jpg`);
    seed([entry("original.jpg", { status: "pending", ageMs: 0 })]);

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ uploadUrl: "https://upload.test/x", key: "k", publicUrl: "https://cdn.test/x.jpg" }),
      text: async () => "",
    })) as unknown as typeof fetch;

    const q = new PhotoQueue();
    await q.sync();

    // The compressed copy is gone; the original is still the queue's reference.
    expect(disk[`${PHOTOS_DIR}compressed.jpg`]).toBeUndefined();
    expect(deleteAsync).toHaveBeenCalledWith(`${PHOTOS_DIR}compressed.jpg`, { idempotent: true });
  });
});
