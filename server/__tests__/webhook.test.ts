/**
 * Tests for the /api/webhooks/load-assigned endpoint.
 * Uses the live dev server running at http://127.0.0.1:3000.
 */
import { describe, it, expect } from "vitest";

const BASE_URL = "http://127.0.0.1:3000";
// The WEBHOOK_SECRET is set via webdev_request_secrets and injected at runtime.
// In tests, we use the known value that was set.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "765d78189af6150f718b7f60bea7695c871015597eb18daaa358c2599d0fe1da";

describe("POST /api/webhooks/load-assigned", () => {
  it("returns 401 when no webhook secret is provided", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/load-assigned`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverCode: "D-11903", loadNumber: "TEST-001" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid webhook secret");
  });

  it("returns 401 when wrong webhook secret is provided", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/load-assigned`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": "wrong-secret",
      },
      body: JSON.stringify({ driverCode: "D-11903", loadNumber: "TEST-001" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when driverCode is missing", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/load-assigned`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": WEBHOOK_SECRET,
      },
      body: JSON.stringify({ loadNumber: "TEST-001" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("driverCode is required");
  });

  it("accepts valid request with correct secret and returns success", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/load-assigned`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        driverCode: "D-11903",
        loadNumber: "PAT-2026-00001",
        vehicleDescription: "2021 Toyota Camry",
        pickupLocation: "Toronto, ON",
        deliveryLocation: "Winnipeg, MB",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; notified: boolean; reason?: string };
    expect(body.success).toBe(true);
    // Either notified (if push token exists) or not (if no token yet) — both are valid
    expect(typeof body.notified).toBe("boolean");
  });
});
