/**
 * stamp-photo-client.ts
 *
 * Client-side helper that sends a local photo URI to the server's
 * photos.stampPhoto endpoint, which uses Sharp to burn the GPS/timestamp
 * evidence banner at full resolution, then saves the stamped image locally.
 *
 * This replaces the broken ViewShot offscreen approach which could not
 * render at full resolution because the component was off-screen.
 */

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { buildStampLines, type StampOptions } from "./photo-stamp";

function getStampApiBase(): string {
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

const PHOTOS_DIR = (FileSystem.documentDirectory ?? "") + "inspection_photos/";

/**
 * Stamp a local photo with GPS/timestamp evidence banner via server-side Sharp.
 * Returns the URI of the stamped photo saved locally.
 * Falls back to the original URI if anything fails.
 */
export async function stampPhotoViaServer(
  localUri: string,
  opts: StampOptions
): Promise<string> {
  try {
    // Build stamp text lines
    const [line1, line2] = buildStampLines(opts);

    // Read photo as base64
    let base64: string;
    if (Platform.OS === "web") {
      const resp = await fetch(localUri);
      const blob = await resp.blob();
      base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] ?? result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } else {
      base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    const ext = localUri.split(".").pop()?.toLowerCase() ?? "jpg";
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";

    // Call server stampPhoto endpoint
    const body = JSON.stringify({
      "0": {
        json: { base64, mimeType, line1: line1 ?? "", line2: line2 ?? "" },
      },
    });

    const apiBase = getStampApiBase();
    const response = await fetch(`${apiBase}/api/trpc/photos.stampPhoto?batch=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      throw new Error(`Stamp server error: HTTP ${response.status}`);
    }

    const jsonArr = await response.json();
    const json = Array.isArray(jsonArr) ? jsonArr[0] : jsonArr;
    const stampedBase64: string =
      json?.result?.data?.json?.base64 ??
      json?.result?.data?.base64 ??
      json?.base64;

    if (!stampedBase64) {
      throw new Error("Server returned no stamped image");
    }

    // Save stamped image to local file
    if (Platform.OS !== "web") {
      // Ensure directory exists
      const dirInfo = await FileSystem.getInfoAsync(PHOTOS_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
      }
      const suffix = Math.random().toString(36).slice(2, 10);
      const stampedPath = `${PHOTOS_DIR}stamped_${suffix}.jpg`;
      await FileSystem.writeAsStringAsync(stampedPath, stampedBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return stampedPath;
    } else {
      // Web: return as data URI
      return `data:image/jpeg;base64,${stampedBase64}`;
    }
  } catch (err) {
    // Stamping failed — return original photo so inspection is not blocked
    console.warn("[stampPhotoViaServer] Failed, using original:", err);
    return localUri;
  }
}
