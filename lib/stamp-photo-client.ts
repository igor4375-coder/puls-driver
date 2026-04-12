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
import type { StampOptions } from "./photo-stamp";

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
const STAMP_MAX_RETRIES = 3;
const STAMP_RETRY_DELAY_MS = 1500;

async function callStampServer(base64: string, mimeType: string, opts: StampOptions): Promise<string> {
  const body = JSON.stringify({
    "0": {
      json: {
        base64,
        mimeType,
        inspectionType: opts.inspectionType,
        driverCode: opts.driverCode,
        companyName: opts.companyName,
        vin: opts.vin ?? undefined,
        locationLabel: opts.locationLabel ?? undefined,
        lat: opts.coords?.latitude,
        lng: opts.coords?.longitude,
      },
    },
  });

  const apiBase = getStampApiBase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(`${apiBase}/api/trpc/photos.stampPhoto?batch=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
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
    return stampedBase64;
  } finally {
    clearTimeout(timeout);
  }
}

export async function stampPhotoViaServer(
  localUri: string,
  opts: StampOptions
): Promise<string> {
  let base64: string;
  try {
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
  } catch (err) {
    console.warn("[stampPhoto] Failed to read source photo:", err);
    return localUri;
  }

  const ext = localUri.split(".").pop()?.toLowerCase() ?? "jpg";
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";

  let lastErr: unknown;
  for (let attempt = 0; attempt < STAMP_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, STAMP_RETRY_DELAY_MS));
        console.log(`[stampPhoto] Retry attempt ${attempt + 1}/${STAMP_MAX_RETRIES}`);
      }
      const stampedBase64 = await callStampServer(base64, mimeType, opts);

      if (Platform.OS !== "web") {
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
        return `data:image/jpeg;base64,${stampedBase64}`;
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[stampPhoto] Attempt ${attempt + 1} failed:`, err);
    }
  }

  console.warn("[stampPhoto] All retries exhausted, using original photo:", lastErr);
  return localUri;
}
