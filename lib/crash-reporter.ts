/**
 * Client diagnostics for crashes the app cannot see.
 *
 * The ErrorBoundary only catches JavaScript exceptions thrown during render.
 * It never fires for the failure mode drivers actually report — the app
 * vanishing to the home screen — because that is the OS terminating the
 * process (out-of-memory jetsam, or the watchdog killing an app whose JS
 * thread stopped responding). No JS runs at that moment, so nothing can be
 * reported from inside the dying session.
 *
 * The workaround is to write a heartbeat record to disk while running. If a
 * record is still there on the next launch, the previous session never got to
 * shut down, so it was killed. The record carries the state the app was in
 * when it stopped breathing — app state, photo queue depth, memory warnings,
 * recent breadcrumbs — which is what tells us *why* it was killed.
 *
 * Everything here is best-effort and must never throw into a caller: a broken
 * reporter must not be able to break the app it is watching.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import * as Device from "expo-device";
import * as Updates from "expo-updates";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { BUILD_TAG } from "@/components/update-version-banner";

const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

const SESSION_KEY = "@autohaul/diag_session_v1";
const OUTBOX_KEY = "@autohaul/diag_outbox_v1";

const HEARTBEAT_MS = 10_000;
const MAX_BREADCRUMBS = 25;
const MAX_BREADCRUMB_LEN = 180;
const MAX_OUTBOX = 25;
/** A heartbeat gap this large means the app was suspended, not killed mid-use. */
const STALE_HEARTBEAT_MS = 90_000;

export type DiagnosticKind = "abnormal_termination" | "js_error" | "memory_warning";

export interface QueueSnapshot {
  photoQueueTotal?: number;
  photoQueuePending?: number;
  photoQueueUploading?: number;
  photoQueueFailed?: number;
  photoQueueBytes?: number;
  syncQueueDepth?: number;
}

interface DiagnosticReport extends QueueSnapshot {
  kind: DiagnosticKind;
  sessionId: string;
  driverCode?: string;
  buildTag?: string;
  updateId?: string;
  platform?: string;
  osVersion?: string;
  deviceModel?: string;
  totalMemoryBytes?: number;
  message?: string;
  stack?: string;
  appState?: string;
  route?: string;
  memoryWarnings?: number;
  breadcrumbs?: string[];
  sessionStartedAt?: number;
  lastHeartbeatAt?: number;
  silentForMs?: number;
}

interface SessionRecord extends QueueSnapshot {
  sessionId: string;
  startedAt: number;
  lastHeartbeatAt: number;
  appState: string;
  driverCode?: string;
  route?: string;
  buildTag: string;
  updateId?: string;
  platform: string;
  osVersion?: string;
  deviceModel?: string;
  totalMemoryBytes?: number;
  memoryWarnings: number;
  breadcrumbs: string[];
}

let session: SessionRecord | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let subscriptions: { remove: () => void }[] = [];
let queueSnapshotProvider: (() => QueueSnapshot) | null = null;
let convexClient: ConvexHttpClient | null = null;
let started = false;

function getConvexClient(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null;
  if (!convexClient) convexClient = new ConvexHttpClient(CONVEX_URL);
  return convexClient;
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Outbox ──────────────────────────────────────────────────────────────────
// Drivers hit dead zones constantly, and a crash caused by bad connectivity is
// exactly the one we must not lose. Reports are buffered on disk and flushed
// whenever a later send succeeds.

async function readOutbox(): Promise<DiagnosticReport[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as DiagnosticReport[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(reports: DiagnosticReport[]): Promise<void> {
  try {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(reports.slice(-MAX_OUTBOX)));
  } catch {
    // Nothing useful to do — losing a diagnostic is acceptable.
  }
}

async function send(reports: DiagnosticReport[]): Promise<boolean> {
  const client = getConvexClient();
  if (!client || reports.length === 0) return false;
  try {
    await client.mutation(api.diagnostics.reportBatch, { reports });
    return true;
  } catch {
    return false;
  }
}

async function enqueue(report: DiagnosticReport): Promise<void> {
  const pending = await readOutbox();
  const batch = [...pending, report];
  if (await send(batch)) {
    await writeOutbox([]);
  } else {
    await writeOutbox(batch);
  }
}

/** Retry anything stranded by an earlier dead zone. */
export async function flushDiagnostics(): Promise<void> {
  const pending = await readOutbox();
  if (pending.length === 0) return;
  if (await send(pending)) await writeOutbox([]);
}

// ─── Session record ──────────────────────────────────────────────────────────

async function persistSession(): Promise<void> {
  if (!session) return;
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

function applyQueueSnapshot(): void {
  if (!session || !queueSnapshotProvider) return;
  try {
    Object.assign(session, queueSnapshotProvider());
  } catch {
    // A throwing provider must not take down the heartbeat.
  }
}

/**
 * Reports the previous session if it never shut down cleanly. `silentForMs`
 * separates the two reasons a record survives: a short gap means the process
 * was killed while the driver was using it, a long gap means iOS suspended a
 * backgrounded app and reclaimed it later, which is routine.
 */
async function reportPreviousSession(): Promise<void> {
  let previous: SessionRecord | null = null;
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) previous = JSON.parse(raw) as SessionRecord;
  } catch {
    previous = null;
  }
  if (!previous?.sessionId) return;

  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }

  const silentForMs = Math.max(0, Date.now() - (previous.lastHeartbeatAt ?? 0));
  const diedInForeground = previous.appState === "active";

  // A backgrounded app that went quiet a long time ago was almost certainly
  // just suspended. Only keep those if they showed memory pressure first.
  if (!diedInForeground && silentForMs > STALE_HEARTBEAT_MS && !previous.memoryWarnings) {
    return;
  }

  await enqueue({
    kind: "abnormal_termination",
    sessionId: previous.sessionId,
    driverCode: previous.driverCode,
    buildTag: previous.buildTag,
    updateId: previous.updateId,
    platform: previous.platform,
    osVersion: previous.osVersion,
    deviceModel: previous.deviceModel,
    totalMemoryBytes: previous.totalMemoryBytes,
    message: diedInForeground
      ? "Process terminated while in the foreground"
      : "Process terminated in the background",
    appState: previous.appState,
    route: previous.route,
    photoQueueTotal: previous.photoQueueTotal,
    photoQueuePending: previous.photoQueuePending,
    photoQueueUploading: previous.photoQueueUploading,
    photoQueueFailed: previous.photoQueueFailed,
    photoQueueBytes: previous.photoQueueBytes,
    syncQueueDepth: previous.syncQueueDepth,
    memoryWarnings: previous.memoryWarnings,
    breadcrumbs: previous.breadcrumbs,
    sessionStartedAt: previous.startedAt,
    lastHeartbeatAt: previous.lastHeartbeatAt,
    silentForMs,
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Lets the app publish queue depths without this module importing the queues
 * (which would create an import cycle).
 */
export function setQueueSnapshotProvider(provider: (() => QueueSnapshot) | null): void {
  queueSnapshotProvider = provider;
}

export function setDiagnosticContext(ctx: { driverCode?: string | null; route?: string | null }): void {
  if (!session) return;
  if (ctx.driverCode !== undefined) session.driverCode = ctx.driverCode ?? undefined;
  if (ctx.route !== undefined) session.route = ctx.route ?? undefined;
}

/** Short, high-signal trail of what the app was doing before it died. */
export function addBreadcrumb(message: string): void {
  if (!session || !message) return;
  const stamped = `${new Date().toISOString().slice(11, 19)} ${message}`.slice(0, MAX_BREADCRUMB_LEN);
  session.breadcrumbs.push(stamped);
  if (session.breadcrumbs.length > MAX_BREADCRUMBS) session.breadcrumbs.shift();
}

export function reportError(error: unknown, context?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  addBreadcrumb(`error: ${context ?? ""} ${err.message}`);
  if (!session) return;
  applyQueueSnapshot();
  void enqueue({
    kind: "js_error",
    sessionId: session.sessionId,
    driverCode: session.driverCode,
    buildTag: session.buildTag,
    updateId: session.updateId,
    platform: session.platform,
    osVersion: session.osVersion,
    deviceModel: session.deviceModel,
    totalMemoryBytes: session.totalMemoryBytes,
    message: context ? `${context}: ${err.message}` : err.message,
    stack: err.stack?.slice(0, 4000),
    appState: session.appState,
    route: session.route,
    photoQueueTotal: session.photoQueueTotal,
    photoQueuePending: session.photoQueuePending,
    photoQueueUploading: session.photoQueueUploading,
    photoQueueFailed: session.photoQueueFailed,
    photoQueueBytes: session.photoQueueBytes,
    syncQueueDepth: session.syncQueueDepth,
    memoryWarnings: session.memoryWarnings,
    breadcrumbs: [...session.breadcrumbs],
    sessionStartedAt: session.startedAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
  });
}

/**
 * A memory warning is iOS telling us it is about to start killing things, so
 * it is reported the moment it arrives rather than waiting for the next
 * launch — if the app dies seconds later this is the last thing we hear.
 */
function handleMemoryWarning(): void {
  if (!session) return;
  session.memoryWarnings += 1;
  applyQueueSnapshot();
  addBreadcrumb(`memory warning #${session.memoryWarnings}`);
  void persistSession();
  void enqueue({
    kind: "memory_warning",
    sessionId: session.sessionId,
    driverCode: session.driverCode,
    buildTag: session.buildTag,
    updateId: session.updateId,
    platform: session.platform,
    osVersion: session.osVersion,
    deviceModel: session.deviceModel,
    totalMemoryBytes: session.totalMemoryBytes,
    message: `Low memory warning #${session.memoryWarnings}`,
    appState: session.appState,
    route: session.route,
    photoQueueTotal: session.photoQueueTotal,
    photoQueuePending: session.photoQueuePending,
    photoQueueUploading: session.photoQueueUploading,
    photoQueueFailed: session.photoQueueFailed,
    photoQueueBytes: session.photoQueueBytes,
    syncQueueDepth: session.syncQueueDepth,
    memoryWarnings: session.memoryWarnings,
    breadcrumbs: [...session.breadcrumbs],
    sessionStartedAt: session.startedAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
  });
}

function installGlobalErrorHandler(): void {
  const globalAny = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const errorUtils = globalAny.ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      reportError(error, isFatal ? "fatal" : "unhandled");
    } catch {
      // never mask the original error
    }
    previous?.(error, isFatal);
  });
}

export async function initCrashReporter(): Promise<void> {
  if (started || Platform.OS === "web") return;
  started = true;

  try {
    // Do this first: the record must be consumed before we overwrite it.
    await reportPreviousSession();

    session = {
      sessionId: newSessionId(),
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      appState: AppState.currentState ?? "unknown",
      buildTag: BUILD_TAG,
      updateId: Updates.updateId ?? undefined,
      platform: `${Platform.OS} ${String(Platform.Version)}`,
      osVersion: Device.osVersion ?? undefined,
      deviceModel: Device.modelName ?? undefined,
      totalMemoryBytes: Device.totalMemory ?? undefined,
      memoryWarnings: 0,
      breadcrumbs: [],
    };
    addBreadcrumb(`launch ${BUILD_TAG}`);
    await persistSession();

    heartbeatTimer = setInterval(() => {
      if (!session) return;
      session.lastHeartbeatAt = Date.now();
      applyQueueSnapshot();
      void persistSession();
    }, HEARTBEAT_MS);

    subscriptions.push(
      AppState.addEventListener("change", (state) => {
        if (!session) return;
        session.appState = state;
        session.lastHeartbeatAt = Date.now();
        addBreadcrumb(`appstate ${state}`);
        applyQueueSnapshot();
        void persistSession();
        if (state === "active") void flushDiagnostics();
      }),
    );
    subscriptions.push(AppState.addEventListener("memoryWarning", handleMemoryWarning));

    installGlobalErrorHandler();
    void flushDiagnostics();
  } catch (err) {
    console.warn("[Diagnostics] init failed:", err instanceof Error ? err.message : String(err));
  }
}

export function stopCrashReporter(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  for (const sub of subscriptions) {
    try {
      sub.remove();
    } catch {
      // ignore
    }
  }
  subscriptions = [];
  started = false;
}
