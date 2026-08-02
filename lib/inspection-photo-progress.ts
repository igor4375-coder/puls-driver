/**
 * Live inspection photo progress → company platform.
 *
 * Contract (matches Puls Dispatch Mobile InspectionCaptureModal):
 *   - On each new photo → bump photoExpectedCount (high-water)
 *   - On each successful upload → bump photoUploadedCount + pass storage URL
 *   - On cancel/back → finalize: true (settles expected = uploaded)
 *
 * Never blocks capture/upload. Failures are swallowed.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

export type InspectionProgressType = "pickup" | "delivery";

export interface ProgressSessionKey {
  legId: number | string;
  inspectionType: InspectionProgressType;
  driverCode: string;
  loadNumber?: string;
}

interface SessionState {
  expected: number;
  uploaded: number;
  driverCode: string;
  loadNumber?: string;
  reportedPhotos: Set<string>;
}

let _convexHttp: ConvexHttpClient | null = null;
const sessions = new Map<string, SessionState>();

function getConvexClient(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null;
  if (!_convexHttp) _convexHttp = new ConvexHttpClient(CONVEX_URL);
  return _convexHttp;
}

function sessionKey(legId: number | string, inspectionType: InspectionProgressType): string {
  return `${String(legId)}:${inspectionType}`;
}

function getOrCreate(ctx: ProgressSessionKey): SessionState {
  const key = sessionKey(ctx.legId, ctx.inspectionType);
  let state = sessions.get(key);
  if (!state) {
    state = {
      expected: 0,
      uploaded: 0,
      driverCode: ctx.driverCode,
      loadNumber: ctx.loadNumber,
      reportedPhotos: new Set(),
    };
    sessions.set(key, state);
  } else {
    if (ctx.driverCode) state.driverCode = ctx.driverCode;
    if (ctx.loadNumber) state.loadNumber = ctx.loadNumber;
  }
  return state;
}

async function send(
  ctx: ProgressSessionKey,
  state: SessionState,
  opts?: { photos?: string[]; finalize?: boolean },
): Promise<void> {
  const client = getConvexClient();
  if (!client || !ctx.driverCode) return;

  try {
    await client.action(api.platform.reportInspectionPhotoProgress, {
      legId: ctx.legId,
      driverCode: state.driverCode,
      inspectionType: ctx.inspectionType,
      photoExpectedCount: state.expected,
      photoUploadedCount: state.uploaded,
      photos: opts?.photos,
      finalize: opts?.finalize,
      loadNumber: state.loadNumber,
    });
  } catch (err) {
    console.warn(
      "[PhotoProgress] report failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Call when a photo is captured / enqueued. */
export function reportPhotoCaptured(ctx: ProgressSessionKey): void {
  if (ctx.legId == null || ctx.legId === "" || !ctx.inspectionType || !ctx.driverCode) return;
  const state = getOrCreate(ctx);
  state.expected += 1;
  void send(ctx, state);
}

/** Call when a photo finishes uploading to R2. */
export function reportPhotoUploaded(ctx: ProgressSessionKey, storageId: string): void {
  if (ctx.legId == null || ctx.legId === "" || !ctx.inspectionType || !ctx.driverCode) return;
  if (!storageId) return;
  const state = getOrCreate(ctx);
  state.expected = Math.max(state.expected, state.uploaded + 1);
  state.uploaded += 1;
  const photos = state.reportedPhotos.has(storageId) ? undefined : [storageId];
  if (photos) state.reportedPhotos.add(storageId);
  void send(ctx, state, { photos });
}

/** Call on camera cancel / discard. */
export function finalizePhotoProgress(ctx: ProgressSessionKey): void {
  if (ctx.legId == null || ctx.legId === "" || !ctx.inspectionType || !ctx.driverCode) return;
  const key = sessionKey(ctx.legId, ctx.inspectionType);
  const state = sessions.get(key) ?? getOrCreate(ctx);
  state.expected = state.uploaded;
  void send(ctx, state, { finalize: true }).finally(() => {
    sessions.delete(key);
  });
}

/** Clear in-memory counters without calling the platform (after Confirm). */
export function clearPhotoProgressSession(
  legId: number | string,
  inspectionType: InspectionProgressType,
): void {
  sessions.delete(sessionKey(legId, inspectionType));
}
