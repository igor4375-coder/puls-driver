/**
 * Background location tracker — reports the driver's position every ~15 minutes.
 *
 * Dual-write architecture:
 *   1. Convex action → platform.reportLocation → company platform tRPC
 *      (powers the real-time tracking map via Convex subscriptions)
 *   2. REST → MySQL (local audit trail / offline queue fallback)
 *
 * The Convex write is fire-and-forget; if it fails the REST write still persists.
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Network from "expo-network";
import * as Battery from "expo-battery";
import { Alert, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const TASK_NAME = "autohaul-background-location";
const STORAGE_KEY = "@autohaul/location_queue_v1";
const REPORT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const FALLBACK_INTERVAL_MS = 15 * 60 * 1000;

// Driver app's own Convex deployment — actions here proxy to the company platform
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

interface LocationPing {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number; // epoch ms
  batteryLevel?: number | null;
}

let _driverCode: string | null = null;
let _getApiBase: (() => string) | null = null;
let _fallbackTimer: ReturnType<typeof setInterval> | null = null;
let _started = false;
let _convexHttp: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null;
  if (!_convexHttp) _convexHttp = new ConvexHttpClient(CONVEX_URL);
  return _convexHttp;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function loadQueue(): Promise<LocationPing[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: LocationPing[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {}
}

// ─── Platform reporting via Convex action ────────────────────────────────────

async function reportToPlatform(ping: LocationPing): Promise<void> {
  if (!_driverCode) return;
  const client = getConvexClient();
  if (!client) return;

  try {
    await client.action(api.platform.reportLocation, {
      driverCode: _driverCode,
      latitude: ping.lat,
      longitude: ping.lng,
      accuracy: ping.accuracy ?? undefined,
      speed: ping.speed ?? undefined,
      heading: ping.heading ?? undefined,
      batteryLevel: ping.batteryLevel ?? undefined,
    });
  } catch (err) {
    console.warn("[LocationTracker] platform report failed:", err);
  }
}

// ─── REST / MySQL reporting (local audit trail + offline queue) ──────────────

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return !!(state.isConnected && state.isInternetReachable);
  } catch {
    return false;
  }
}

async function reportToServer(pings: LocationPing[]): Promise<boolean> {
  if (!_driverCode || !_getApiBase || pings.length === 0) return false;

  const online = await isOnline();
  if (!online) return false;

  try {
    const baseUrl = _getApiBase().replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/api/driver-location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driverCode: _driverCode,
        pings,
      }),
    });
    return response.ok;
  } catch (err) {
    console.warn("[LocationTracker] REST report failed:", err);
    return false;
  }
}

async function flushQueue(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const success = await reportToServer(queue);
  if (success) {
    await saveQueue([]);
  }
}

async function enqueueAndFlush(ping: LocationPing): Promise<void> {
  // Fire-and-forget to company platform for real-time tracking map
  reportToPlatform(ping);

  // Queue for REST/MySQL (reliable local persistence)
  const queue = await loadQueue();
  queue.push(ping);
  const trimmed = queue.slice(-100);
  await saveQueue(trimmed);
  await flushQueue();
}

async function getBatteryPercent(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}

async function locationToPing(loc: Location.LocationObject): Promise<LocationPing> {
  const batteryLevel = await getBatteryPercent();
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    speed: loc.coords.speed,
    heading: loc.coords.heading,
    timestamp: loc.timestamp,
    batteryLevel,
  };
}

// ─── Background task (native builds) ────────────────────────────────────────

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn("[LocationTracker] background task error:", error);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  if (!locations || locations.length === 0) return;

  const latest = locations[locations.length - 1];
  await enqueueAndFlush(await locationToPing(latest));
});

// ─── Fallback foreground polling (Expo Go / dev) ─────────────────────────────

async function foregroundPoll(): Promise<void> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await enqueueAndFlush(await locationToPing(loc));
  } catch (err) {
    console.warn("[LocationTracker] foreground poll error:", err);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function startLocationTracking(
  driverCode: string,
  getApiBase: () => string,
): Promise<boolean> {
  if (_started && _driverCode === driverCode) return true;

  _driverCode = driverCode;
  _getApiBase = getApiBase;

  // Request background permission
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    console.warn("[LocationTracker] foreground permission denied");
    return false;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

  if (bgStatus === "granted") {
    // Native background tracking
    const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
    if (!isRunning) {
      await Location.startLocationUpdatesAsync(TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: REPORT_INTERVAL_MS,
        distanceInterval: 500, // also trigger if driver moves 500m
        deferredUpdatesInterval: REPORT_INTERVAL_MS,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Puls Driver",
          notificationBody: "Sharing your location with dispatch",
          notificationColor: "#2563EB",
        },
      });
    }
    _started = true;
    // Fire one immediate ping
    foregroundPoll();
    return true;
  }

  // Fallback: foreground-only polling (Expo Go, or user denied background)
  console.warn("[LocationTracker] background permission denied — using foreground polling");
  if (!_fallbackTimer) {
    foregroundPoll();
    _fallbackTimer = setInterval(foregroundPoll, FALLBACK_INTERVAL_MS);
  }
  _started = true;
  return true;
}

export async function stopLocationTracking(): Promise<void> {
  _started = false;
  _driverCode = null;

  if (_fallbackTimer) {
    clearInterval(_fallbackTimer);
    _fallbackTimer = null;
  }

  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch (err) {
    console.warn("[LocationTracker] stop error:", err);
  }
}

export function isTrackingActive(): boolean {
  return _started;
}

/** Flush any queued pings (call on app foreground resume) */
export async function flushLocationQueue(): Promise<void> {
  await flushQueue();
}

/** Send an immediate GPS ping to the platform (e.g. in response to a dispatcher request) */
export async function sendImmediateLocationPing(): Promise<boolean> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();

    if (status !== "granted") {
      const result = await Location.requestForegroundPermissionsAsync();
      status = result.status;
    }

    if (status !== "granted") {
      Alert.alert(
        "Location Permission Required",
        "Dispatch has requested your location. Please enable location access in Settings so your position can be shared.",
        [
          { text: "Not Now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
      return false;
    }

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const ping = await locationToPing(loc);
    await enqueueAndFlush(ping);
    return true;
  } catch (err) {
    console.warn("[LocationTracker] immediate ping failed:", err);
    return false;
  }
}
