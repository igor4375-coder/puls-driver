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

// v83+: hard ceilings so a wedged native decoder can never stall the
// upload pipeline. `manipulateAsync` is a native call that, on rare
// occasions (low memory, module detached while backgrounded), neither
// resolves nor rejects. Without these two timeouts, one such call used
// to poison the semaphore chain below and permanently prevent every
// future photo on the device from being compressed — which in turn
// wedged the whole upload queue.
const COMPRESS_TIMEOUT_MS = 25_000;
const LOCK_WAIT_TIMEOUT_MS = 40_000;

let compressLock: Promise<void> = Promise.resolve();

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
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

  // Bounded wait: if the predecessor in the chain never releases, proceed
  // anyway rather than blocking forever. Two concurrent compressions is a
  // memory risk worth taking over a permanently dead upload queue.
  const lockResult = await Promise.race([wait, timeout(LOCK_WAIT_TIMEOUT_MS)]);
  if (lockResult === "timeout") {
    console.warn("[compressImage] Lock wait timed out — proceeding without it");
  }

  try {
    const result = await Promise.race([
      manipulateAsync(uri, [{ resize: { width: maxDim } }], {
        compress: quality,
        format: SaveFormat.JPEG,
      }),
      timeout(COMPRESS_TIMEOUT_MS),
    ]);
    if (result === "timeout") {
      console.warn("[compressImage] Timed out, using original");
      return uri;
    }
    return result.uri;
  } catch (err) {
    console.warn("[compressImage] Failed, using original:", err);
    return uri;
  } finally {
    release!();
  }
}
