/**
 * photo-stamp.ts
 *
 * Burns a tamper-evident evidence stamp onto a photo.
 * The stamp is a dark banner at the bottom of the image containing:
 *   - Inspection type + date (left side, like SuperDispatch)
 *   - City, State PostalCode (reverse geocoded from GPS)
 *   - Driver code + brand (right side)
 *
 * Strategy: we render an offscreen React Native view (photo + overlay),
 * capture it with react-native-view-shot, and return the new URI.
 *
 * This module exports:
 *   - buildStampLines(opts) → string[]
 *   - buildStampText(opts)  → string
 *   - getCurrentGPS()       → Promise<GPSCoords | null>
 *   - reverseGeocodeCoords() → Promise<string | null>
 */

import * as Location from "expo-location";

export interface GPSCoords {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface StampOptions {
  driverCode?: string;
  companyName?: string;
  coords?: GPSCoords | null;
  /** Human-readable location string (e.g. "Dallas, TX 75201"). If provided, shown instead of raw coords. */
  locationLabel?: string | null;
  /** Override timestamp (ISO string). Defaults to now. */
  capturedAt?: string;
  /** Inspection type label, e.g. "Pickup Condition" or "Delivery Condition" */
  inspectionType?: string;
}

/**
 * Request foreground location permission and get current GPS coords.
 * Returns null if permission denied or unavailable.
 */
export async function getCurrentGPS(): Promise<GPSCoords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  } catch {
    return null;
  }
}

/**
 * Reverse geocode GPS coordinates to a human-readable location string.
 * Returns a string like "Dallas, TX 75201" or null on failure.
 */
export async function reverseGeocodeCoords(coords: GPSCoords): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    if (!results || results.length === 0) return null;
    const r = results[0];
    const parts: string[] = [];
    if (r.city) parts.push(r.city);
    if (r.region) parts.push(r.region);
    if (r.postalCode) parts.push(r.postalCode);
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

/**
 * Build the stamp text lines that will be burned onto the photo.
 * Layout matches SuperDispatch style:
 *   Line 1 (bold): "Pickup Condition: 2/24/2026, Dallas, TX 75201"
 *   Line 2: "Driver: D-11903  ·  Puls Dispatch"
 */
export function buildStampLines(opts: StampOptions): string[] {
  const now = opts.capturedAt ? new Date(opts.capturedAt) : new Date();

  // Format: "2/24/2026" (M/D/YYYY like SuperDispatch)
  const dateStr = now.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const lines: string[] = [];

  // Line 1: inspection type + date + location (SuperDispatch style)
  const inspType = opts.inspectionType ?? "Inspection";
  let locationPart = "";
  if (opts.locationLabel) {
    locationPart = opts.locationLabel;
  } else if (opts.coords) {
    // Fallback to raw coords if no label provided
    const lat = opts.coords.latitude.toFixed(4);
    const lon = opts.coords.longitude.toFixed(4);
    locationPart = `${lat}, ${lon}`;
  }
  const line1 = locationPart
    ? `${inspType}: ${dateStr}  ${timeStr}, ${locationPart}`
    : `${inspType}: ${dateStr}  ${timeStr}`;
  lines.push(line1);

  // Line 2: driver code + brand
  const driverPart = opts.driverCode ? `Driver: ${opts.driverCode}` : "";
  const brandPart = opts.companyName ?? "Puls Dispatch";
  lines.push([driverPart, brandPart].filter(Boolean).join("  ·  "));

  return lines;
}

/**
 * Returns the stamp text as a single formatted string (for display / testing).
 */
export function buildStampText(opts: StampOptions): string {
  return buildStampLines(opts).join("\n");
}
