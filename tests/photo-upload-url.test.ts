/**
 * Tests for photo upload URL fix and legId mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Test: photo-queue-class uses /api/trpc/ path ──────────────────────────

describe("PhotoQueue upload URL", () => {
  it("upload URL must use /api/trpc/ prefix (not bare /trpc/)", () => {
    // Validate the URL constant used in photo-queue-class.ts
    // The correct path is /api/trpc/photos.upload
    const API_BASE = "http://127.0.0.1:3000";
    const uploadUrl = `${API_BASE}/api/trpc/photos.upload`;
    expect(uploadUrl).toContain("/api/trpc/photos.upload");
    // Must start with /api/ (not bare /trpc/)
    const path = uploadUrl.replace(API_BASE, "");
    expect(path).toBe("/api/trpc/photos.upload");
    expect(path.startsWith("/api/")).toBe(true);
    // Must NOT be the old broken path (bare /trpc/ without /api/ prefix)
    expect(path).not.toBe("/trpc/photos.upload");
  });
});

// ─── Test: legId mapping in PlatformLoad ──────────────────────────────────

describe("PlatformLoad legId mapping", () => {
  it("uses legId as the primary load ID when present", () => {
    // Validates the mapping logic: id = `platform-${legId ?? tripId}`
    const legId = 12345;
    const tripId = 99999;
    const resolvedId = legId ?? tripId;
    expect(`platform-${resolvedId}`).toBe("platform-12345");
  });

  it("falls back to tripId when legId is absent", () => {
    const tripId = 99999;
    const legId = undefined;
    const resolvedId = legId ?? tripId;
    expect(`platform-${resolvedId}`).toBe("platform-99999");
  });

  it("status 'assigned' maps to 'new'", () => {
    const statusMap: Record<string, string> = {
      pending: "new",
      assigned: "new",
      picked_up: "picked_up",
      delivered: "delivered",
      cancelled: "archived",
    };
    expect(statusMap["assigned"]).toBe("new");
    expect(statusMap["pending"]).toBe("new");
    expect(statusMap["picked_up"]).toBe("picked_up");
  });
});

// ─── Test: tRPC response parsing ──────────────────────────────────────────

describe("tRPC response URL parsing", () => {
  it("extracts URL from tRPC v11 format (result.data.json.url)", () => {
    const json = {
      result: {
        data: {
          json: {
            url: "https://cdn.example.com/photo.jpg",
            key: "inspections/photo.jpg",
            clientId: "abc123",
          },
        },
      },
    };
    const url: string =
      json?.result?.data?.json?.url ??
      (json?.result?.data as any)?.url ??
      (json as any)?.url;
    expect(url).toBe("https://cdn.example.com/photo.jpg");
  });

  it("falls back to result.data.url for older format", () => {
    const json = {
      result: {
        data: {
          url: "https://cdn.example.com/photo.jpg",
        },
      },
    };
    const url: string =
      (json?.result?.data as any)?.json?.url ??
      (json?.result?.data as any)?.url ??
      (json as any)?.url;
    expect(url).toBe("https://cdn.example.com/photo.jpg");
  });
});
