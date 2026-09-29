import type { LoadHandoff, HandoffState } from "@/lib/data";

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize platform `handoff`. Branch on `state` first — `blockingCarrierAssigned`
 * is only meaningful inside `awaiting_handoff` (it is also false on ready_for_pickup).
 */
export function normalizeHandoff(raw: unknown): LoadHandoff | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const state: HandoffState | null =
    o.state === "ready_for_pickup"
      ? "ready_for_pickup"
      : o.state === "awaiting_handoff"
        ? "awaiting_handoff"
        : null;
  if (!state) return null;

  const blockingCarrierAssigned = o.blockingCarrierAssigned === true;
  const blockingCarrierName =
    state === "awaiting_handoff" && blockingCarrierAssigned
      ? trimOrNull(o.blockingCarrierName)
      : null;

  const label =
    trimOrNull(o.label) ??
    (state === "ready_for_pickup" ? "Ready for Pickup" : "Awaiting Handoff");
  const message = trimOrNull(o.message) ?? "";

  return {
    state,
    blockingLegNumber: typeof o.blockingLegNumber === "number" ? o.blockingLegNumber : null,
    blockingCarrierName,
    blockingCarrierAssigned: state === "awaiting_handoff" ? blockingCarrierAssigned : false,
    pickupLocationName: trimOrNull(o.pickupLocationName),
    label,
    message,
  };
}

export function normalizeLegNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return n > 0 ? n : null;
  }
  return null;
}

export function isPickupBlockedByHandoff(handoff: LoadHandoff | null | undefined): boolean {
  return handoff?.state === "awaiting_handoff";
}

/** Driver-facing copy: drop "Leg N" wording. Drivers don't need the relay numbering. */
export function stripLegMentions(text: string): string {
  return text
    .replace(/\bWaiting on Leg \d+\b/gi, "Waiting on dispatch")
    .replace(/\bLeg \d+ has no carrier yet/gi, "The previous carrier has not been assigned yet")
    .replace(/\s+on Leg \d+\b/gi, "")
    .replace(/\bLeg \d+\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

export function handoffDisplayLabel(handoff: LoadHandoff): string {
  if (handoff.state === "ready_for_pickup") return "Ready for Pickup";
  return "Awaiting Handoff";
}

export function handoffDisplayMessage(handoff: LoadHandoff): string {
  return stripLegMentions(handoff.message);
}

/** Driver-facing explanation with no previous-driver names and no leg numbers. */
export function handoffAnonymousExplanation(handoff: LoadHandoff): string {
  const loc = handoff.pickupLocationName || "the pickup location";
  if (handoff.state === "ready_for_pickup") {
    return `The vehicle is at ${loc} and ready to be picked up.`;
  }
  if (handoff.blockingCarrierAssigned) {
    return `The vehicle is still with the previous driver. It has not been dropped at ${loc} yet.`;
  }
  return `The previous driver has not been assigned yet, so the vehicle has not reached ${loc}.`;
}

export type HandoffWatchSnapshot = {
  id: string;
  loadNumber: string;
  vehicleLabel: string;
  handoffState: HandoffState | null;
  pickupLocationName: string | null;
};

export function snapshotHandoffWatch(load: {
  id: string;
  loadNumber: string;
  vehicles?: Array<{ year?: string | null; make?: string | null; model?: string | null }>;
  handoff?: { state: HandoffState; pickupLocationName: string | null } | null;
  pickup?: { contact?: { company?: string | null } };
}): HandoffWatchSnapshot {
  const v = load.vehicles?.[0];
  const parts = [v?.year, v?.make, v?.model].filter(Boolean);
  return {
    id: load.id,
    loadNumber: load.loadNumber,
    vehicleLabel: parts.length > 0 ? parts.join(" ") : `Load ${load.loadNumber}`,
    handoffState: load.handoff?.state ?? null,
    pickupLocationName: load.handoff?.pickupLocationName || load.pickup?.contact?.company || null,
  };
}

/** Loads that just flipped from awaiting handoff to ready at the yard. */
export function detectHandoffReadyTransitions(
  previous: HandoffWatchSnapshot[],
  next: HandoffWatchSnapshot[],
): HandoffWatchSnapshot[] {
  const prevById = new Map(previous.map((s) => [s.id, s]));
  const ready: HandoffWatchSnapshot[] = [];
  for (const n of next) {
    const p = prevById.get(n.id);
    if (!p) continue;
    if (p.handoffState === "awaiting_handoff" && n.handoffState === "ready_for_pickup") {
      ready.push(n);
    }
  }
  return ready;
}

export function handoffReadyNotificationCopy(s: HandoffWatchSnapshot): { title: string; body: string } {
  const who = s.vehicleLabel || `Load ${s.loadNumber}`;
  const loc = s.pickupLocationName;
  return {
    title: "Ready for Pickup",
    body: loc
      ? `${who} is at ${loc} now.`
      : `${who} is at the terminal and ready to pick up.`,
  };
}
