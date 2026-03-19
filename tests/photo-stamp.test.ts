/**
 * Tests for the photo-stamp utility.
 * Validates that buildStampLines produces correct, tamper-evident stamp text.
 */

import { describe, it, expect, vi } from "vitest";

// Mock expo-location so vitest/rollup doesn't try to parse native Expo source
vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getCurrentPositionAsync: vi.fn(async () => ({
    coords: { latitude: 33.449, longitude: -112.074, accuracy: 5 },
  })),
  Accuracy: { Balanced: 3 },
}));

import { buildStampLines, buildStampText } from "../lib/photo-stamp";

describe("buildStampLines", () => {
  it("returns exactly 3 lines", () => {
    const lines = buildStampLines({});
    expect(lines).toHaveLength(3);
  });

  it("line 1 contains a date and time", () => {
    const lines = buildStampLines({ capturedAt: "2026-02-21T19:42:13.000Z" });
    // Should contain a year
    expect(lines[0]).toMatch(/2026/);
    // Should contain AM or PM
    expect(lines[0]).toMatch(/AM|PM/);
  });

  it("line 2 contains GPS coordinates when provided", () => {
    const lines = buildStampLines({
      coords: { latitude: 33.44900, longitude: -112.07400, accuracy: 5 },
    });
    expect(lines[1]).toContain("33.44900");
    expect(lines[1]).toContain("-112.07400");
    expect(lines[1]).toContain("±5m");
  });

  it("line 2 shows unavailable when no GPS", () => {
    const lines = buildStampLines({ coords: null });
    expect(lines[1]).toContain("unavailable");
  });

  it("line 3 contains driver code when provided", () => {
    const lines = buildStampLines({ driverCode: "DRV-001" });
    expect(lines[2]).toContain("DRV-001");
  });

  it("line 3 contains company name", () => {
    const lines = buildStampLines({ companyName: "AcmeTrans" });
    expect(lines[2]).toContain("AcmeTrans");
  });

  it("line 3 falls back to Puls Dispatch when no company name", () => {
    const lines = buildStampLines({});
    expect(lines[2]).toContain("Puls Dispatch");
  });

  it("coordinates are formatted to 5 decimal places", () => {
    const lines = buildStampLines({
      coords: { latitude: 40.712776, longitude: -74.005974, accuracy: 10 },
    });
    // 5 decimal places
    expect(lines[1]).toMatch(/40\.71278/);
    expect(lines[1]).toMatch(/-74\.00597/);
  });

  it("buildStampText joins lines with newlines", () => {
    const text = buildStampText({
      coords: { latitude: 33.449, longitude: -112.074, accuracy: 3 },
      driverCode: "DRV-999",
    });
    const parts = text.split("\n");
    expect(parts).toHaveLength(3);
  });

  it("handles null accuracy gracefully", () => {
    const lines = buildStampLines({
      coords: { latitude: 33.449, longitude: -112.074, accuracy: null },
    });
    // Should not contain ±
    expect(lines[1]).not.toContain("±");
    expect(lines[1]).toContain("33.44900");
  });
});
