/**
 * TEMPORARY debug instrumentation for the "app renders but ignores taps"
 * investigation. Remove once the cause is confirmed and fixed.
 *
 * The decisive question is whether the JS thread is blocked or whether touches
 * are reaching JS and being swallowed. A timer that measures its own lateness
 * answers it: a blocked thread cannot fire timers on schedule, so drift spikes.
 * If drift stays near zero while the UI ignores taps, the thread is healthy and
 * the problem is in touch handling instead.
 */
import { addBreadcrumb } from "@/lib/crash-reporter";

const ENDPOINT = "http://127.0.0.1:7268/ingest/b095b2b2-2262-495a-a4a1-1500ce137c1f";
const SESSION_ID = "c282c2";
const TICK_MS = 1000;
/** Drift above this is recorded to Convex too, so a remote device reports it. */
const STALL_BREADCRUMB_MS = 2000;

type Counters = {
  loadsRenders: number;
  photoEmits: number;
  syncPasses: number;
  backfillRuns: number;
  touches: number;
};

const totals: Counters = {
  loadsRenders: 0,
  photoEmits: 0,
  syncPasses: 0,
  backfillRuns: 0,
  touches: 0,
};

let lastTotals: Counters = { ...totals };

export function bump(key: keyof Counters, by = 1): void {
  totals[key] += by;
}

// On a real device the loopback endpoint is unreachable, so stop dialling it
// after a few refusals. The breadcrumb path below still reports remotely.
let httpFailures = 0;
const MAX_HTTP_FAILURES = 3;

export function probe(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  if (httpFailures >= MAX_HTTP_FAILURES) return;
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": SESSION_ID },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      runId: "pre-fix",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  })
    .then(() => {
      httpFailures = 0;
    })
    .catch(() => {
      httpFailures += 1;
    });
}

/**
 * Breadcrumbs are the only channel that reaches a real device, since the
 * loopback endpoint is unreachable there. Everything we need to see has to go
 * through here.
 */
export function crumb(message: string, data?: Record<string, unknown>): void {
  addBreadcrumb(message);
  probe("H6", "lib/debug-probe.ts:crumb", message, data ?? {});
}

let stateProvider: (() => Record<string, unknown>) | null = null;

/** Lets loads-context expose sync-queue composition without an import cycle. */
export function setDebugStateProvider(fn: (() => Record<string, unknown>) | null): void {
  stateProvider = fn;
}

let tickTimer: ReturnType<typeof setInterval> | null = null;

export function startLoopLagProbe(): void {
  if (tickTimer) return;
  let expectedAt = Date.now() + TICK_MS;
  let worstDrift = 0;

  tickTimer = setInterval(() => {
    const now = Date.now();
    const driftMs = now - expectedAt;
    expectedAt = now + TICK_MS;
    if (driftMs > worstDrift) worstDrift = driftMs;

    const delta: Record<string, number> = {};
    for (const key of Object.keys(totals) as (keyof Counters)[]) {
      delta[key] = totals[key] - lastTotals[key];
    }
    lastTotals = { ...totals };

    let extra: Record<string, unknown> = {};
    try {
      extra = stateProvider?.() ?? {};
    } catch {
      extra = { stateProviderThrew: true };
    }

    // #region agent log
    probe("H1,H2,H3,H4,H5", "lib/debug-probe.ts:startLoopLagProbe", "loop tick", {
      driftMs,
      worstDrift,
      perSecond: delta,
      totals: { ...totals },
      ...extra,
    });
    // #endregion

    // #region agent log
    if (driftMs > STALL_BREADCRUMB_MS) {
      addBreadcrumb(
        `stall ${driftMs}ms r=${delta.loadsRenders} e=${delta.photoEmits} s=${delta.syncPasses} b=${delta.backfillRuns} t=${delta.touches}`,
      );
    }
    // #endregion
  }, TICK_MS);
}

export function stopLoopLagProbe(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
