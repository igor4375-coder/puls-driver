/**
 * Image compression utility.
 *
 * Resizes photos to a max dimension and compresses JPEG quality
 * before upload, reducing a typical 8-12MB phone photo to ~300-800KB.
 *
 * A semaphore ensures only one compression runs at a time to avoid
 * blowing up memory on devices with limited RAM (the native image
 * decoder loads the full bitmap into memory).
 */

import { manipulateAsync, SaveFormat, FlipType } from "expo-image-manipulator";
import { Platform } from "react-native";
// #region agent log
import { addBreadcrumb } from "./crash-reporter";
// #endregion

export type NetworkProfile = "wifi" | "cellular";

// v66+: network-aware compression targets.
//
// Wi-Fi profile: high-fidelity for dispatcher/insurance review.
// Cellular profile: smaller dimensions + lower JPEG quality so each
// upload fits inside a stable TCP window on weak LTE. 1280 px is
// still well past the resolution needed to see scratches, dents,
// and paint chips. JPEG 0.72 at 1280 px ≈ 120–280 KB.
const WIFI_MAX_DIMENSION = Platform.OS === "android" ? 1600 : 2048;
const WIFI_JPEG_QUALITY = 0.82;
const CELLULAR_MAX_DIMENSION = 1280;
const CELLULAR_JPEG_QUALITY = 0.72;

let compressLock: Promise<void> = Promise.resolve();

// #region agent log
let waiting = 0;
let compressSeq = 0;
// #endregion

/**
 * EXIF Orientation tag -> the transform needed to display the image upright.
 * Values are the eight defined by the EXIF spec; rotation is clockwise.
 */
const EXIF_TRANSFORMS: Record<number, { rotate?: number; flip?: FlipType }> = {
  1: {},
  2: { flip: FlipType.Horizontal },
  3: { rotate: 180 },
  4: { flip: FlipType.Vertical },
  5: { rotate: 90, flip: FlipType.Horizontal },
  6: { rotate: 90 },
  7: { rotate: 270, flip: FlipType.Horizontal },
  8: { rotate: 270 },
};

/**
 * Bakes an EXIF orientation tag into the actual pixels.
 *
 * Most of the camera's output already has rotation baked in and carries no
 * tag, in which case this is a no-op. But when a tag does survive — and
 * roughly 3% of uploaded photos had one — the image is stored sideways and
 * only renders upright in a viewer that reads EXIF. Dispatch's pipeline
 * doesn't, so those arrive rotated and have to be fixed by hand.
 *
 * Doing it here rather than relying on the server means correctness no longer
 * depends on the stamp request completing, and it survives a failed
 * compression (which uploads the original untouched).
 *
 * @param exifOrientation The raw `Orientation` value from `takePictureAsync`.
 * @returns A URI with upright pixels, or the original if nothing was needed.
 */
export async function normalizeOrientation(
  uri: string,
  exifOrientation: unknown,
): Promise<string> {
  if (Platform.OS === "web") return uri;
  if (typeof exifOrientation !== "number") return uri;

  const transform = EXIF_TRANSFORMS[exifOrientation];
  // Unknown value, or 1 (already upright) — leave the file alone. Rotating on
  // a guess would break the 97% of photos that are already correct.
  if (!transform || (transform.rotate === undefined && transform.flip === undefined)) {
    return uri;
  }

  const actions: Parameters<typeof manipulateAsync>[1] = [];
  if (transform.rotate !== undefined) actions.push({ rotate: transform.rotate });
  if (transform.flip !== undefined) actions.push({ flip: transform.flip });

  try {
    // manipulateAsync writes a fresh file without EXIF, so the tag can't be
    // applied a second time by a viewer that does honour it.
    const result = await manipulateAsync(uri, actions, {
      compress: 1,
      format: SaveFormat.JPEG,
    });
    return result.uri;
  } catch (err) {
    console.warn("[normalizeOrientation] Failed, using original:", err);
    return uri;
  }
}

/**
 * Compress a local image URI: resize to MAX_DIMENSION and JPEG quality.
 * Only one compression runs at a time (semaphore) to prevent OOM crashes
 * when drivers take photos rapidly.
 *
 * v66+: pass a `profile` to choose Wi-Fi (default — high fidelity) vs
 * cellular (smaller, fewer bytes on the wire).
 */
export async function compressImage(
  uri: string,
  profile: NetworkProfile = "wifi",
): Promise<string> {
  if (Platform.OS === "web") return uri;
  if (uri.startsWith("http")) return uri;

  const maxDim = profile === "wifi" ? WIFI_MAX_DIMENSION : CELLULAR_MAX_DIMENSION;
  const quality = profile === "wifi" ? WIFI_JPEG_QUALITY : CELLULAR_JPEG_QUALITY;

  let release: () => void;
  const ticket = new Promise<void>((r) => { release = r; });
  const wait = compressLock;
  compressLock = ticket;
  // #region agent log
  // If manipulateAsync ever fails to settle, the semaphore is never released
  // and every later compression waits forever. `waiting` makes that visible.
  waiting += 1;
  const seq = ++compressSeq;
  const queuedAt = Date.now();
  addBreadcrumb(`compress ${seq} queued (waiting=${waiting})`);
  // #endregion
  await wait;
  // #region agent log
  const startedAt = Date.now();
  addBreadcrumb(`compress ${seq} start (waited ${startedAt - queuedAt}ms)`);
  // #endregion

  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: maxDim } }],
      { compress: quality, format: SaveFormat.JPEG },
    );
    // #region agent log
    addBreadcrumb(`compress ${seq} done in ${Date.now() - startedAt}ms`);
    // #endregion
    return result.uri;
  } catch (err) {
    console.warn("[compressImage] Failed, using original:", err);
    // #region agent log
    addBreadcrumb(`compress ${seq} FAILED ${err instanceof Error ? err.message : String(err)}`);
    // #endregion
    return uri;
  } finally {
    // #region agent log
    waiting -= 1;
    // #endregion
    release!();
  }
}
