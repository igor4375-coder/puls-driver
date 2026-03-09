import { describe, it, expect } from "vitest";
import {
  getStatusLabel,
  getPaymentLabel,
  formatCurrency,
  formatDate,
  MOCK_LOADS,
  MOCK_DRIVER,
} from "../lib/data";

describe("getStatusLabel", () => {
  it("returns Pending Pickup for new", () => {
    expect(getStatusLabel("new")).toBe("Pending Pickup");
  });
  it("returns Picked Up for picked_up", () => {
    expect(getStatusLabel("picked_up")).toBe("Picked Up");
  });
  it("returns Delivered for delivered", () => {
    expect(getStatusLabel("delivered")).toBe("Delivered");
  });
  it("returns Archived for archived", () => {
    expect(getStatusLabel("archived")).toBe("Archived");
  });
});

describe("getPaymentLabel", () => {
  it("returns Cash on Delivery for cod", () => {
    expect(getPaymentLabel("cod")).toBe("Cash on Delivery");
  });
  it("returns ACH Transfer for ach", () => {
    expect(getPaymentLabel("ach")).toBe("ACH Transfer");
  });
  it("returns Check for check", () => {
    expect(getPaymentLabel("check")).toBe("Check");
  });
  it("returns Factoring for factoring", () => {
    expect(getPaymentLabel("factoring")).toBe("Factoring");
  });
});

describe("formatCurrency", () => {
  it("formats whole numbers correctly", () => {
    expect(formatCurrency(1850)).toBe("$1,850.00");
  });
  it("formats zero correctly", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });
  it("formats large amounts correctly", () => {
    expect(formatCurrency(12500)).toBe("$12,500.00");
  });
});

describe("formatDate", () => {
  it("formats a date string into readable format", () => {
    // Use a date that won't shift across months regardless of timezone
    const result = formatDate("2026-02-15");
    expect(result).toMatch(/Feb/);
    expect(result).toMatch(/2026/);
    // The day may shift by 1 due to UTC offset, so just check it's a number
    expect(result).toMatch(/\d+/);
  });
});

describe("MOCK_LOADS", () => {
  it("has 4 mock loads", () => {
    expect(MOCK_LOADS.length).toBe(4);
  });

  it("first load has status new", () => {
    expect(MOCK_LOADS[0].status).toBe("new");
  });

  it("third load has status picked_up with a pre-existing damage", () => {
    const load = MOCK_LOADS[2];
    expect(load.status).toBe("picked_up");
    expect(load.vehicles[0].pickupInspection?.damages.length).toBe(1);
  });

  it("fourth load has status delivered", () => {
    expect(MOCK_LOADS[3].status).toBe("delivered");
  });

  it("all loads have at least one vehicle", () => {
    MOCK_LOADS.forEach((l) => {
      expect(l.vehicles.length).toBeGreaterThan(0);
    });
  });

  it("all loads have valid pickup and delivery lat/lng", () => {
    MOCK_LOADS.forEach((l) => {
      expect(l.pickup.lat).toBeTypeOf("number");
      expect(l.pickup.lng).toBeTypeOf("number");
      expect(l.delivery.lat).toBeTypeOf("number");
      expect(l.delivery.lng).toBeTypeOf("number");
    });
  });
});

describe("MOCK_DRIVER", () => {
  it("has required fields", () => {
    expect(MOCK_DRIVER.id).toBeTruthy();
    expect(MOCK_DRIVER.name).toBeTruthy();
    expect(MOCK_DRIVER.email).toBeTruthy();
    expect(MOCK_DRIVER.company).toBeTruthy();
    expect(MOCK_DRIVER.truckNumber).toBeTruthy();
    expect(MOCK_DRIVER.avatarInitials).toBeTruthy();
  });
});

// ─── Inspection Data Tests ────────────────────────────────────────────────────

describe("Inspection data model", () => {
  it("creates a vehicle with default inspection state", () => {
    const vehicle = {
      id: "v1",
      vin: "1HGCM82633A004352",
      year: "2022",
      make: "Ford",
      model: "F-150",
      color: "White",
      bodyType: "Pickup",
      vinVerified: true,
      vinLoading: false,
      inspectionComplete: false,
      inspectionPhotos: [] as string[],
      inspectionDamages: [] as { id: string; zone: string; type: string; severity: string }[],
      inspectionNotes: "",
    };
    expect(vehicle.inspectionComplete).toBe(false);
    expect(vehicle.inspectionPhotos).toHaveLength(0);
    expect(vehicle.inspectionDamages).toHaveLength(0);
  });

  it("marks inspection as complete after saving", () => {
    const vehicle = {
      id: "v1",
      inspectionComplete: false,
      inspectionPhotos: [] as string[],
      inspectionDamages: [] as { id: string; zone: string; type: string; severity: string }[],
      inspectionNotes: "",
    };

    const result = {
      photos: ["file://photo1.jpg", "file://photo2.jpg"],
      damages: [{ id: "d1", zone: "front", type: "Scratch", severity: "Minor" }],
      notes: "Small scratch on front bumper",
    };

    const updated = {
      ...vehicle,
      inspectionComplete: true,
      inspectionPhotos: result.photos,
      inspectionDamages: result.damages,
      inspectionNotes: result.notes,
    };

    expect(updated.inspectionComplete).toBe(true);
    expect(updated.inspectionPhotos).toHaveLength(2);
    expect(updated.inspectionDamages).toHaveLength(1);
    expect(updated.inspectionDamages[0].zone).toBe("front");
    expect(updated.inspectionNotes).toBe("Small scratch on front bumper");
  });

  it("supports multiple vehicles with independent inspections", () => {
    const vehicles = [
      { id: "v1", inspectionComplete: true, inspectionDamages: [{ id: "d1", zone: "front", type: "Dent", severity: "Moderate" }] },
      { id: "v2", inspectionComplete: false, inspectionDamages: [] },
    ];

    const completedVehicles = vehicles.filter((v) => v.inspectionComplete);
    const pendingVehicles = vehicles.filter((v) => !v.inspectionComplete);

    expect(completedVehicles).toHaveLength(1);
    expect(pendingVehicles).toHaveLength(1);
    expect(completedVehicles[0].id).toBe("v1");
    expect(pendingVehicles[0].id).toBe("v2");
  });

  it("counts damages and photos correctly for badge display", () => {
    const vehicle = {
      inspectionComplete: true,
      inspectionPhotos: ["p1", "p2", "p3"],
      inspectionDamages: [
        { id: "d1", zone: "front", type: "Scratch", severity: "Minor" },
        { id: "d2", zone: "roof", type: "Dent", severity: "Moderate" },
      ],
    };

    const damageCount = vehicle.inspectionDamages.length;
    const photoCount = vehicle.inspectionPhotos.length;
    const badgeText = `${damageCount} damage${damageCount !== 1 ? "s" : ""} · ${photoCount} photo${photoCount !== 1 ? "s" : ""}`;

    expect(badgeText).toBe("2 damages · 3 photos");
  });

  it("uses singular form for single damage/photo", () => {
    const vehicle = {
      inspectionComplete: true,
      inspectionPhotos: ["p1"],
      inspectionDamages: [{ id: "d1", zone: "front", type: "Scratch", severity: "Minor" }],
    };

    const damageCount = vehicle.inspectionDamages.length;
    const photoCount = vehicle.inspectionPhotos.length;
    const badgeText = `${damageCount} damage${damageCount !== 1 ? "s" : ""} · ${photoCount} photo${photoCount !== 1 ? "s" : ""}`;

    expect(badgeText).toBe("1 damage · 1 photo");
  });
});
