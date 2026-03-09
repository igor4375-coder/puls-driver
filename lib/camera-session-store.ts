/**
 * camera-session-store.ts
 *
 * A lightweight global store that bridges the load-detail screen and the
 * camera-session route. Because the camera must be a top-level route
 * (to avoid iOS nested-modal blocking), we can't pass callbacks via props.
 *
 * NAVIGATION STRATEGY (camera-first inspection flow):
 *   1. Caller sets meta.nextRoute = "/inspection/loadId/vehicleId" and calls router.push("/camera-session")
 *   2. Camera screen captures photos
 *   3. On Done: store photos in _pendingPhotos, then router.replace(meta.nextRoute)
 *      → This replaces the camera screen with the inspection screen directly.
 *      → No router.back() needed, so there is no race condition.
 *   4. Inspection screen on mount calls consumePendingPhotos() to get the photos.
 *
 * LEGACY CALLBACK FLOW (used by add-load screen):
 *   - If no nextRoute is set, the old callback mechanism is used.
 */

type DoneCallback = (uris: string[]) => void;

let _callback: DoneCallback | null = null;
let _meta: { loadId?: string; vehicleId?: string; nextRoute?: string; pickupConfirm?: boolean; inspectionType?: string } = {};
// Pending photos waiting to be consumed by the inspection screen on mount
let _pendingPhotos: string[] = [];

export const cameraSessionStore = {
  /** Register a callback and optional metadata before navigating to camera-session */
  open(callback: DoneCallback | null, meta?: { loadId?: string; vehicleId?: string; nextRoute?: string; pickupConfirm?: boolean; inspectionType?: string }) {
    _callback = callback;
    _meta = meta ?? {};
  },

  /** Called by the camera-session screen when the driver taps Done */
  complete(uris: string[]) {
    _pendingPhotos = uris;
    _callback?.(uris);
    _callback = null;
  },

  /** Called by the camera-session screen when the driver cancels */
  cancel() {
    _callback = null;
    _meta = {};
    _pendingPhotos = [];
  },

  /** Store photos so the inspection screen can pick them up on mount */
  storePendingPhotos(uris: string[]) {
    _pendingPhotos = uris;
  },

  /**
   * Consume pending photos — returns the stored photos and clears the store.
   * Call this once from the inspection screen on mount.
   */
  consumePendingPhotos(): string[] {
    const photos = _pendingPhotos;
    _pendingPhotos = [];
    return photos;
  },

  /** Check if there are pending photos without consuming them */
  hasPendingPhotos(): boolean {
    return _pendingPhotos.length > 0;
  },

  getMeta() {
    return _meta;
  },

  clearMeta() {
    _meta = {};
  },
};
