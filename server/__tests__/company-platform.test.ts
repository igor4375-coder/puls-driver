import { describe, it, expect } from "vitest";
import { verifyApiKey, getAssignedLoads } from "../company-platform-client";

/**
 * Integration test — validates that the COMPANY_PLATFORM_API_KEY secret
 * is correctly configured and the company platform API is reachable.
 *
 * These tests make real HTTP calls to the company platform.
 * They will be skipped in CI if the env var is not set.
 */

const hasApiKey = !!process.env.COMPANY_PLATFORM_API_KEY;

describe("Company Platform API Client", () => {
  it("should have COMPANY_PLATFORM_API_KEY configured", () => {
    expect(process.env.COMPANY_PLATFORM_API_KEY).toBeTruthy();
    expect(process.env.COMPANY_PLATFORM_API_KEY).toMatch(/^pk_/);
  });

  it.skipIf(!hasApiKey)("verifyApiKey returns true with valid key", async () => {
    const result = await verifyApiKey();
    expect(result).toBe(true);
  }, 15000);

  it.skipIf(!hasApiKey)("getAssignedLoads returns array for demo driver", async () => {
    const loads = await getAssignedLoads("D-00001");
    expect(Array.isArray(loads)).toBe(true);
    // Each load should have required fields
    for (const load of loads) {
      expect(load).toHaveProperty("tripId");
      expect(load).toHaveProperty("loadNumber");
      expect(load).toHaveProperty("pickupLocation");
      expect(load).toHaveProperty("deliveryLocation");
      expect(load).toHaveProperty("vehicle");
    }
  }, 15000);
});
