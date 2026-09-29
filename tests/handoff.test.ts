import { describe, it, expect } from "vitest";
import { normalizeHandoff, isPickupBlockedByHandoff, handoffDisplayLabel, handoffDisplayMessage } from "../lib/handoff";

describe("normalizeHandoff", () => {
  it("returns null for missing or invalid payloads", () => {
    expect(normalizeHandoff(null)).toBeNull();
    expect(normalizeHandoff(undefined)).toBeNull();
    expect(normalizeHandoff({ label: "Awaiting Handoff" })).toBeNull();
  });

  it("maps ready_for_pickup and ignores blockingCarrierAssigned", () => {
    const r = normalizeHandoff({
      state: "ready_for_pickup",
      blockingLegNumber: null,
      blockingCarrierName: "Should not show",
      blockingCarrierAssigned: false,
      pickupLocationName: "Winnipeg Terminal",
      label: "Ready for Pickup",
      message: "The vehicle is at Winnipeg Terminal and ready to be collected.",
    });
    expect(r?.state).toBe("ready_for_pickup");
    expect(r?.blockingCarrierAssigned).toBe(false);
    expect(r?.blockingCarrierName).toBeNull();
    expect(r?.label).toBe("Ready for Pickup");
    expect(isPickupBlockedByHandoff(r)).toBe(false);
  });

  it("maps awaiting_handoff with a named previous carrier", () => {
    const r = normalizeHandoff({
      state: "awaiting_handoff",
      blockingLegNumber: 1,
      blockingCarrierName: "Dave Mackenzie",
      blockingCarrierAssigned: true,
      pickupLocationName: "Winnipeg Terminal",
      label: "Awaiting Handoff",
      message: "The vehicle is still with Dave Mackenzie on Leg 1.",
    });
    expect(r?.state).toBe("awaiting_handoff");
    expect(r?.blockingCarrierAssigned).toBe(true);
    expect(r?.blockingCarrierName).toBe("Dave Mackenzie");
    expect(isPickupBlockedByHandoff(r)).toBe(true);
  });

  it("keeps awaiting_handoff when the earlier leg has no carrier", () => {
    const r = normalizeHandoff({
      state: "awaiting_handoff",
      blockingLegNumber: 1,
      blockingCarrierName: null,
      blockingCarrierAssigned: false,
      pickupLocationName: "Brandon Yard",
      label: "Waiting on Leg 1",
      message: "Leg 1 has no carrier yet, so the vehicle has not reached Brandon Yard. Dispatch has to move it first.",
    });
    expect(r?.state).toBe("awaiting_handoff");
    expect(r?.blockingCarrierAssigned).toBe(false);
    expect(r?.blockingCarrierName).toBeNull();
    expect(r?.label).toBe("Waiting on Leg 1");
    expect(handoffDisplayLabel(r!)).toBe("Waiting on dispatch");
    expect(handoffDisplayMessage(r!)).not.toMatch(/leg/i);
    expect(isPickupBlockedByHandoff(r)).toBe(true);
  });

  it("force-nulls blockingCarrierName when blockingCarrierAssigned is false", () => {
    const r = normalizeHandoff({
      state: "awaiting_handoff",
      blockingLegNumber: 1,
      blockingCarrierName: "Stale Name",
      blockingCarrierAssigned: false,
      pickupLocationName: "Brandon Yard",
      label: "Waiting on Leg 1",
      message: "Dispatch has to move it first.",
    });
    expect(r?.state).toBe("awaiting_handoff");
    expect(r?.blockingCarrierName).toBeNull();
  });

  it("strips leg numbering from driver-facing copy", () => {
    const r = normalizeHandoff({
      state: "awaiting_handoff",
      blockingLegNumber: 1,
      blockingCarrierName: "Dave Mackenzie",
      blockingCarrierAssigned: true,
      pickupLocationName: "Winnipeg Terminal",
      label: "Awaiting Handoff",
      message: "The vehicle is still with Dave Mackenzie on Leg 1. It has not been dropped at Winnipeg Terminal yet — check with dispatch before you drive out.",
    });
    expect(handoffDisplayLabel(r!)).toBe("Awaiting Handoff");
    expect(handoffDisplayMessage(r!)).toBe(
      "The vehicle is still with Dave Mackenzie. It has not been dropped at Winnipeg Terminal yet — check with dispatch before you drive out.",
    );
    expect(handoffDisplayMessage(r!)).not.toMatch(/leg/i);
  });
});
