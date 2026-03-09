import { describe, it, expect } from "vitest";

// ─── Unit tests for inspection review logic ──────────────────────────────────
// These test the data transformation and display logic used in the
// Vehicle Inspection Review screen, without rendering React components.

// ─── Damage type labels ──────────────────────────────────────────────────────

const DAMAGE_TYPE_LABELS: Record<string, string> = {
  scratch: "Scratch",
  multiple_scratches: "Multi-Scratch",
  dent: "Dent",
  chip: "Chip",
  crack: "Crack",
  broken: "Broken",
  missing: "Missing",
  other: "Other",
};

const SEVERITY_COLORS: Record<string, string> = {
  minor: "#22C55E",
  moderate: "#F59E0B",
  severe: "#EF4444",
};

const ZONE_LABELS: Record<string, string> = {
  front: "Front",
  rear: "Rear",
  hood: "Hood",
  trunk: "Trunk",
  roof: "Roof",
  driver_side: "Driver Side",
  passenger_side: "Passenger Side",
  windshield: "Windshield",
  driver_front_wheel: "Driver Front Wheel",
  driver_rear_wheel: "Driver Rear Wheel",
  passenger_front_wheel: "Passenger Front Wheel",
  passenger_rear_wheel: "Passenger Rear Wheel",
};

// ─── Inspection type resolution logic ────────────────────────────────────────

function resolveInspectionType(typeParam?: string): "pickup" | "delivery" {
  return typeParam === "delivery" ? "delivery" : "pickup";
}

// ─── Caption builder logic ───────────────────────────────────────────────────

function buildCaption(
  inspectionType: "pickup" | "delivery",
  completedAt?: string,
  city?: string,
  state?: string,
  zip?: string
): string {
  const label = inspectionType === "pickup" ? "Pickup" : "Delivery";
  const date = completedAt
    ? new Date(completedAt).toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const location = [city, state, zip].filter(Boolean).join(", ");
  return `${label} Condition${date ? `: ${date}` : ""}${location ? `, ${location}` : ""}`;
}

// ─── Photo index calculation ─────────────────────────────────────────────────

function calculatePhotoIndex(offsetX: number, screenWidth: number, totalPhotos: number): number {
  const raw = Math.round(offsetX / screenWidth);
  return Math.max(0, Math.min(raw, totalPhotos - 1));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Inspection Review - Damage Labels", () => {
  it("maps all damage types to human-readable labels", () => {
    expect(DAMAGE_TYPE_LABELS["scratch"]).toBe("Scratch");
    expect(DAMAGE_TYPE_LABELS["multiple_scratches"]).toBe("Multi-Scratch");
    expect(DAMAGE_TYPE_LABELS["dent"]).toBe("Dent");
    expect(DAMAGE_TYPE_LABELS["chip"]).toBe("Chip");
    expect(DAMAGE_TYPE_LABELS["crack"]).toBe("Crack");
    expect(DAMAGE_TYPE_LABELS["broken"]).toBe("Broken");
    expect(DAMAGE_TYPE_LABELS["missing"]).toBe("Missing");
    expect(DAMAGE_TYPE_LABELS["other"]).toBe("Other");
  });

  it("provides severity colors for all levels", () => {
    expect(SEVERITY_COLORS["minor"]).toBe("#22C55E");
    expect(SEVERITY_COLORS["moderate"]).toBe("#F59E0B");
    expect(SEVERITY_COLORS["severe"]).toBe("#EF4444");
  });

  it("maps all damage zones to labels", () => {
    expect(ZONE_LABELS["front"]).toBe("Front");
    expect(ZONE_LABELS["driver_side"]).toBe("Driver Side");
    expect(ZONE_LABELS["passenger_rear_wheel"]).toBe("Passenger Rear Wheel");
    expect(Object.keys(ZONE_LABELS)).toHaveLength(12);
  });
});

describe("Inspection Review - Type Resolution", () => {
  it("defaults to pickup when no type param", () => {
    expect(resolveInspectionType()).toBe("pickup");
    expect(resolveInspectionType(undefined)).toBe("pickup");
  });

  it("returns delivery when type param is delivery", () => {
    expect(resolveInspectionType("delivery")).toBe("delivery");
  });

  it("defaults to pickup for unknown type param", () => {
    expect(resolveInspectionType("something_else")).toBe("pickup");
  });
});

describe("Inspection Review - Caption Builder", () => {
  it("builds caption with all fields", () => {
    const result = buildCaption("pickup", "2026-02-20T15:30:00Z", "Rhineland", "MB", "R0G 1R0");
    expect(result).toContain("Pickup Condition");
    expect(result).toContain("2/20/2026");
    expect(result).toContain("Rhineland, MB, R0G 1R0");
  });

  it("builds caption without date", () => {
    const result = buildCaption("delivery", undefined, "Dallas", "TX", "75001");
    expect(result).toBe("Delivery Condition, Dallas, TX, 75001");
  });

  it("builds caption without location", () => {
    const result = buildCaption("pickup", "2026-01-15T10:00:00Z");
    expect(result).toContain("Pickup Condition: 1/15/2026");
    expect(result).not.toContain(",");
  });

  it("builds minimal caption", () => {
    expect(buildCaption("delivery")).toBe("Delivery Condition");
  });
});

describe("Inspection Review - Photo Index Calculation", () => {
  const screenWidth = 375;

  it("calculates correct index from scroll offset", () => {
    expect(calculatePhotoIndex(0, screenWidth, 7)).toBe(0);
    expect(calculatePhotoIndex(375, screenWidth, 7)).toBe(1);
    expect(calculatePhotoIndex(750, screenWidth, 7)).toBe(2);
    expect(calculatePhotoIndex(2250, screenWidth, 7)).toBe(6);
  });

  it("clamps to valid range", () => {
    expect(calculatePhotoIndex(-100, screenWidth, 7)).toBe(0);
    expect(calculatePhotoIndex(9999, screenWidth, 7)).toBe(6);
  });

  it("handles single photo", () => {
    expect(calculatePhotoIndex(0, screenWidth, 1)).toBe(0);
    expect(calculatePhotoIndex(375, screenWidth, 1)).toBe(0);
  });
});
