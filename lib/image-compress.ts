/**
 * Image compression utility.
 *
 * Resizes photos to a max dimension and compresses JPEG quality
 * before upload, reducing a typical 8-12MB phone photo to ~300-800KB.
 */

import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

/**
 * Compress a local image URI: resize to MAX_DIMENSION and JPEG quality 0.85.
 * Returns the URI of the compressed image. Falls back to original on failure.
 */
export async function compressImage(uri: string): Promise<string> {
  if (Platform.OS === "web") return uri;
  if (uri.startsWith("http")) return uri;

  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: MAX_DIMENSION } }],
      { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
    );
    return result.uri;
  } catch (err) {
    console.warn("[compressImage] Failed, using original:", err);
    return uri;
  }
}
