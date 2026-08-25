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

import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

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
  await wait;

  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: maxDim } }],
      { compress: quality, format: SaveFormat.JPEG },
    );
    return result.uri;
  } catch (err) {
    console.warn("[compressImage] Failed, using original:", err);
    return uri;
  } finally {
    release!();
  }
}
