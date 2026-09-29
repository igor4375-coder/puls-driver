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
