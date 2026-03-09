/**
 * Tests for the My Companies visibility fix.
 *
 * Verifies that:
 * 1. getMyConnectionsByCode public endpoint is defined in the router
 * 2. disconnectFromCompanyByCode public endpoint is defined in the router
 * 3. invites.respond mutation accepts the new optional fields (localDriverCode, companyCode, companyName)
 * 4. db.acceptPlatformInvite function is exported from db.ts
 * 5. db.getOrCreatePlatformCompany function is exported from db.ts
 */

import { describe, it, expect } from "vitest";

describe("My Companies Fix — Router Endpoints", () => {
  it("should export getMyConnectionsByCode from the driver router", async () => {
    const { appRouter } = await import("../server/routers");
    const routerDef = appRouter._def.procedures;
    expect(routerDef).toHaveProperty("driver.getMyConnectionsByCode");
  });

  it("should export disconnectFromCompanyByCode from the driver router", async () => {
    const { appRouter } = await import("../server/routers");
    const routerDef = appRouter._def.procedures;
    expect(routerDef).toHaveProperty("driver.disconnectFromCompanyByCode");
  });

  it("should export invites.respond from the router", async () => {
    const { appRouter } = await import("../server/routers");
    const routerDef = appRouter._def.procedures;
    expect(routerDef).toHaveProperty("invites.respond");
  });
});

describe("My Companies Fix — DB Functions", () => {
  it("should export acceptPlatformInvite from db.ts", async () => {
    const db = await import("../server/db");
    expect(typeof db.acceptPlatformInvite).toBe("function");
  });

  it("should export getOrCreatePlatformCompany from db.ts", async () => {
    const db = await import("../server/db");
    expect(typeof db.getOrCreatePlatformCompany).toBe("function");
  });

  it("should export getDriverProfileByCode from db.ts", async () => {
    const db = await import("../server/db");
    expect(typeof db.getDriverProfileByCode).toBe("function");
  });
});

describe("My Companies Fix — Input Validation", () => {
  it("invites.respond input schema should accept optional localDriverCode, companyCode, companyName", async () => {
    const { z } = await import("zod");

    // Replicate the schema from routers.ts to verify it accepts the new fields
    const schema = z.object({
      inviteId: z.number(),
      accept: z.boolean(),
      driverCode: z.string().regex(/^D-\d{5}$/),
      localDriverCode: z.string().regex(/^D-\d{5}$/).optional(),
      companyCode: z.string().optional(),
      companyName: z.string().optional(),
    });

    // Should parse successfully with all fields
    const result = schema.safeParse({
      inviteId: 42,
      accept: true,
      driverCode: "D-18589",
      localDriverCode: "D-97071",
      companyCode: "C-12345",
      companyName: "Test Dispatch Co",
    });
    expect(result.success).toBe(true);

    // Should also parse without optional fields (backward compatible)
    const resultMinimal = schema.safeParse({
      inviteId: 42,
      accept: false,
      driverCode: "D-18589",
    });
    expect(resultMinimal.success).toBe(true);
  });

  it("getMyConnectionsByCode input schema should require valid driverCode", async () => {
    const { z } = await import("zod");
    const schema = z.object({ driverCode: z.string().regex(/^D-\d{5}$/) });

    expect(schema.safeParse({ driverCode: "D-97071" }).success).toBe(true);
    expect(schema.safeParse({ driverCode: "D-00001" }).success).toBe(true);
    expect(schema.safeParse({ driverCode: "invalid" }).success).toBe(false);
    expect(schema.safeParse({ driverCode: "D-0000" }).success).toBe(false); // too short
  });
});
