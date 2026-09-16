/**
 * Background location tracker — reports the driver's position to dispatch.
 *
 * Dual-write architecture:
 *   1. Convex action → platform.reportLocation → company platform tRPC
 *      (powers the real-time tracking map via Convex subscriptions)
 *   2. REST → MySQL (local audit trail / offline queue fallback)
 *
 * Both writes are queued and retried independently, so a ping is never lost
 * just because the device was offline when it was captured.
 *
 * Android notes: `ACCESS_BACKGROUND_LOCATION` cannot be granted from a runtime
 * dialog on Android 11+, so we never gate tracking on it. A foreground service
 * with `foregroundServiceType=location` keeps delivering updates under the
 * ordinary while-in-use grant, which is what drivers actually have.
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Network from "expo-network";
import * as Battery from "expo-battery";
import { Alert, AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const TASK_NAME = "autohaul-background-location";
const STORAGE_KEY = "@autohaul/location_queue_v1";
const STATUS_KEY = "@autohaul/location_status_v1";

const IS_ANDROID = Platform.OS === "android";

// Android batches location delivery hard in Doze, so we ask for a much tighter
// cadence than we need and let the OS stretch it. iOS honours the interval
// closely and its 15-minute cadence already works, so leave it alone.
const REPORT_INTERVAL_MS = IS_ANDROID ? 2 * 60 * 1000 : 15 * 60 * 1000;
const DISTANCE_INTERVAL_M = IS_ANDROID ? 150 : 500;

// Supplemental poll that runs only while the app is in the foreground. This is
// what guarantees dispatch sees movement within a couple of minutes of the
// driver opening the app, instead of waiting on the OS batch.
const FOREGROUND_POLL_MS = IS_ANDROID ? 2 * 60 * 1000 : 5 * 60 * 1000;

// Don't report twice in quick succession when the native task and the
// foreground poll happen to fire together.
const MIN_PING_GAP_MS = 45 * 1000;

const MAX_QUEUE = 100;
// Cap how many backlogged pings we push to the platform in one pass so a long
// offline stretch doesn't stall the flush.
const PLATFORM_FLUSH_BATCH = 12;

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
  /** Delivered to the company platform (the dispatch tracking map) */
  platformSent?: boolean;
  /** Delivered to the REST/MySQL audit trail */
  restSent?: boolean;
}

export type TrackingMode = "off" | "background-service" | "foreground-only";

export interface TrackingStatus {
  mode: TrackingMode;
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  servicesEnabled: boolean;
  lastPingAt: number | null;
  lastPlatformOkAt: number | null;
  lastError: string | null;
  pendingCount: number;
}

let _driverCode: string | null = null;
let _getApiBase: (() => string) | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _started = false;
let _convexHttp: ConvexHttpClient | null = null;
let _lastPingAt = 0;
let _inFlight = false;

let _status: TrackingStatus = {
  mode: "off",
  foregroundGranted: false,
  backgroundGranted: false,
  servicesEnabled: true,
  lastPingAt: null,
  lastPlatformOkAt: null,
  lastError: null,
  pendingCount: 0,
};

const _statusListeners = new Set<(s: TrackingStatus) => void>();

function setStatus(patch: Partial<TrackingStatus>): void {
  _status = { ..._status, ...patch };
  for (const fn of _statusListeners) {
    try {
      fn(_status);
    } catch {}
  }
  void AsyncStorage.setItem(STATUS_KEY, JSON.stringify(_status)).catch(() => {});
}

export function getTrackingStatus(): TrackingStatus {
  return _status;
}

export function subscribeTrackingStatus(fn: (s: TrackingStatus) => void): () => void {
  _statusListeners.add(fn);
  fn(_status);
  return () => _statusListeners.delete(fn);
}

/** Rehydrate the last known status so the UI isn't blank on a cold start. */
export async function loadTrackingStatus(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STATUS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<TrackingStatus>;
    _status = {
      ..._status,
      lastPingAt: saved.lastPingAt ?? null,
      lastPlatformOkAt: saved.lastPlatformOkAt ?? null,
    };
  } catch {}
}

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

async function reportToPlatform(ping: LocationPing): Promise<boolean> {
  if (!_driverCode) return false;
  const client = getConvexClient();
  if (!client) return false;

  try {
    const ok = await client.action(api.platform.reportLocation, {
      driverCode: _driverCode,
      latitude: ping.lat,
      longitude: ping.lng,
      accuracy: ping.accuracy ?? undefined,
      speed: ping.speed ?? undefined,
      heading: ping.heading ?? undefined,
      batteryLevel: ping.batteryLevel ?? undefined,
    });
    // The action returns false when the platform rejected the write — treat
    // that as a failure so the ping is retried instead of silently dropped.
    if (ok === false) {
      setStatus({ lastError: "Dispatch rejected the location report" });
      return false;
    }
    setStatus({ lastPlatformOkAt: Date.now(), lastError: null });
    return true;
  } catch (err) {
    console.warn("[LocationTracker] platform report failed:", err);
    setStatus({ lastError: err instanceof Error ? err.message : "Location report failed" });
    return false;
  }
}

// ─── REST / MySQL reporting (local audit trail + offline queue) ──────────────

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    // `isInternetReachable` is frequently undefined on Android; only treat an
    // explicit `false` as offline so we don't skip perfectly good uploads.
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

async function reportToServer(pings: LocationPing[]): Promise<boolean> {
  if (!_driverCode || !_getApiBase || pings.length === 0) return false;

  try {
    const baseUrl = _getApiBase().replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/api/driver-location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driverCode: _driverCode,
        pings: pings.map(({ platformSent, restSent, ...p }) => p),
      }),
    });
    return response.ok;
  } catch (err) {
    console.warn("[LocationTracker] REST report failed:", err);
    return false;
  }
}

async function flushQueue(): Promise<void> {
  if (_inFlight) return;
  _inFlight = true;
  try {
    const queue = await loadQueue();
    if (queue.length === 0) {
      setStatus({ pendingCount: 0 });
      return;
    }
    if (!(await isOnline())) {
      setStatus({ pendingCount: queue.length });
      return;
    }

    // 1. Dispatch tracking map — the write that actually matters. Oldest
    //    first so the map draws a coherent trail, and stop at the first
    //    failure so we don't hammer a down endpoint.
    const platformPending = queue.filter((p) => !p.platformSent).slice(0, PLATFORM_FLUSH_BATCH);
    for (const ping of platformPending) {
      if (!(await reportToPlatform(ping))) break;
      ping.platformSent = true;
    }

    // 2. REST audit trail — batched, all-or-nothing.
    const restPending = queue.filter((p) => !p.restSent);
    if (restPending.length > 0 && (await reportToServer(restPending))) {
      for (const ping of restPending) ping.restSent = true;
    }

    const remaining = queue.filter((p) => !(p.platformSent && p.restSent)).slice(-MAX_QUEUE);
    await saveQueue(remaining);
    setStatus({ pendingCount: remaining.filter((p) => !p.platformSent).length });
  } finally {
    _inFlight = false;
  }
}

async function enqueueAndFlush(ping: LocationPing): Promise<void> {
  _lastPingAt = ping.timestamp || Date.now();
  setStatus({ lastPingAt: _lastPingAt });

  const queue = await loadQueue();
  queue.push(ping);
  await saveQueue(queue.slice(-MAX_QUEUE));
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
    timestamp: loc.timestamp || Date.now(),
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

// ─── Foreground polling ──────────────────────────────────────────────────────

async function foregroundPoll(force = false): Promise<void> {
  try {
    if (!_driverCode) return;
    if (!force && Date.now() - _lastPingAt < MIN_PING_GAP_MS) return;
    if (AppState.currentState !== "active" && !force) {
      // The native service owns tracking while backgrounded; a JS timer here
      // would be suspended by the OS anyway.
      return;
    }

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

function startForegroundSupplement(): void {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => {
    void ensureNativeTaskAlive();
    void foregroundPoll();
  }, FOREGROUND_POLL_MS);
}

// ─── Native updates ──────────────────────────────────────────────────────────

async function startNativeUpdates(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
  if (isRunning) return;

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: REPORT_INTERVAL_MS,
    distanceInterval: DISTANCE_INTERVAL_M,
    // Deferred updates tell the OS it may sit on results for this long. On
    // Android that stacks on top of Doze batching and was the main reason
    // dispatch saw nothing for 10+ minutes, so only iOS gets it.
    ...(IS_ANDROID ? {} : { deferredUpdatesInterval: REPORT_INTERVAL_MS }),
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Puls Driver — sharing location",
      notificationBody: "Dispatch can see your position while you are on duty.",
      notificationColor: "#2563EB",
      // Keep reporting if Android destroys the app task (swipe-away, low
      // memory). Without this the service dies with the activity.
      killServiceOnDestroy: false,
    },
  });
}

/**
 * Re-arm the native task if the OS killed it out from under us. Android will
 * tear down the service on some OEM battery savers, and the only way to notice
 * is to ask.
 */
async function ensureNativeTaskAlive(): Promise<void> {
  if (!_started || _status.mode !== "background-service") return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
    if (!isRunning) {
      console.warn("[LocationTracker] native task was killed — restarting");
      await startNativeUpdates();
    }
  } catch (err) {
    console.warn("[LocationTracker] task revive failed:", err);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function startLocationTracking(
  driverCode: string,
  getApiBase: () => string,
): Promise<boolean> {
  _getApiBase = getApiBase;

  if (_started && _driverCode === driverCode) {
    void ensureNativeTaskAlive();
    void foregroundPoll();
    return true;
  }

  _driverCode = driverCode;

  let servicesEnabled = true;
  try {
    servicesEnabled = await Location.hasServicesEnabledAsync();
  } catch {}

  if (!servicesEnabled && IS_ANDROID) {
    // Shows the Google Play "improve location accuracy" dialog, which is the
    // one-tap way to turn device location back on.
    try {
      await Location.enableNetworkProviderAsync();
      servicesEnabled = true;
    } catch {}
  }

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    console.warn("[LocationTracker] foreground permission denied");
    setStatus({ mode: "off", foregroundGranted: false, servicesEnabled, lastError: "Location permission denied" });
    return false;
  }

  // Android 11+ never grants this from a runtime dialog — the driver has to
  // pick "Allow all the time" in system settings. Ask anyway (harmless), but
  // never gate tracking on the answer.
  let bgGranted = false;
  try {
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    bgGranted = bgStatus === "granted";
  } catch {}

  // iOS genuinely requires the "Always" grant to run a background task.
  // Android only needs the foreground service, which works under while-in-use.
  const canUseNativeTask = IS_ANDROID || bgGranted;

  let mode: TrackingMode = "foreground-only";
  if (canUseNativeTask) {
    try {
      await startNativeUpdates();
      mode = "background-service";
    } catch (err) {
      console.warn("[LocationTracker] startLocationUpdatesAsync failed:", err);
      setStatus({ lastError: err instanceof Error ? err.message : "Background tracking unavailable" });
    }
  }

  setStatus({
    mode,
    foregroundGranted: true,
    backgroundGranted: bgGranted,
    servicesEnabled,
  });

  // Always run the foreground supplement: it costs nothing while the app is
  // backgrounded and guarantees fresh pings while the driver has it open.
  startForegroundSupplement();

  _started = true;
  void foregroundPoll(true);
  return true;
}

export async function stopLocationTracking(): Promise<void> {
  _started = false;
  _driverCode = null;

  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }

  setStatus({ mode: "off" });

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

/** Flush queued pings and re-arm a killed service (call on app foreground resume) */
export async function flushLocationQueue(): Promise<void> {
  await ensureNativeTaskAlive();
  await flushQueue();
  await foregroundPoll();
}

/**
 * Walk an Android driver to the "Allow all the time" screen. Android will not
 * show a dialog for background location, so a deep link into settings is the
 * only path.
 */
export function promptForAlwaysAllow(): void {
  Alert.alert(
    "Keep Dispatch Updated",
    IS_ANDROID
      ? 'Android only shares your location while the app is open unless you set location access to "Allow all the time".\n\nOpen Settings → Permissions → Location → Allow all the time.'
      : 'Set location access to "Always" so dispatch can see your position while the app is in the background.',
    [
      { text: "Not Now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings() },
    ],
  );
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
