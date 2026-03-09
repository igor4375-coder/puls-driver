import { describe, it, expect } from "vitest";

/**
 * Tests the core location merging and filtering logic used in the
 * alternate delivery screen. We extract the pure logic here so we can
 * validate it without rendering React components.
 */

interface LocationItem {
  id: string;
  name: string;
  address?: string;
  city?: string;
  province?: string;
  lat?: number;
  lng?: number;
  source: "platform" | "load";
}

const MAX_VISIBLE = 5;

/** Mirrors the allLocations useMemo in alternate-delivery/[loadId].tsx */
function mergeLocations(
  platformLocations: Array<{
    id: number;
    name: string;
    address?: string;
    city?: string;
    province?: string;
    lat?: number;
    lng?: number;
  }>,
  loads: Array<{
    delivery: { contact: { company?: string; name?: string; city?: string; state?: string } };
    pickup: { contact: { company?: string; name?: string; city?: string; state?: string } };
  }>,
  createdLocations: LocationItem[]
): LocationItem[] {
  const map = new Map<string, LocationItem>();

  // Platform locations first (higher priority)
  for (const pl of platformLocations) {
    const key = pl.name.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, {
        id: `platform-${pl.id}`,
        name: pl.name,
        address: pl.address,
        city: pl.city,
        province: pl.province,
        lat: pl.lat,
        lng: pl.lng,
        source: "platform",
      });
    }
  }

  // Locally created locations
  for (const cl of createdLocations) {
    const key = cl.name.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, cl);
    }
  }

  // Load-derived locations as fallback
  for (const l of loads) {
    const deliveryName = l.delivery.contact.company || l.delivery.contact.name;
    if (deliveryName) {
      const key = deliveryName.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, {
          id: `load-del-${key}`,
          name: deliveryName,
          city: l.delivery.contact.city,
          province: l.delivery.contact.state,
          source: "load",
        });
      }
    }
    const pickupName = l.pickup.contact.company || l.pickup.contact.name;
    if (pickupName) {
      const key = pickupName.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, {
          id: `load-pu-${key}`,
          name: pickupName,
          city: l.pickup.contact.city,
          province: l.pickup.contact.state,
          source: "load",
        });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Mirrors the filteredLocations useMemo in alternate-delivery/[loadId].tsx */
function filterLocations(
  allLocations: LocationItem[],
  searchQuery: string,
  selectedLocation: LocationItem | null
): LocationItem[] {
  let list: LocationItem[];
  if (!searchQuery.trim()) {
    list = allLocations.slice(0, MAX_VISIBLE);
  } else {
    const q = searchQuery.toLowerCase().trim();
    list = allLocations.filter(
      (loc) =>
        loc.name.toLowerCase().includes(q) ||
        (loc.city && loc.city.toLowerCase().includes(q)) ||
        (loc.province && loc.province.toLowerCase().includes(q)) ||
        (loc.address && loc.address.toLowerCase().includes(q))
    );
  }
  // Ensure the selected location always appears in the visible list
  if (selectedLocation && !list.some((l) => l.id === selectedLocation.id)) {
    list = [selectedLocation, ...list];
  }
  return list;
}

// ── Test data ──────────────────────────────────────────────────────────────────

const platformLocs = [
  { id: 1, name: "Winnipeg Terminal", city: "Winnipeg", province: "MB" },
  { id: 2, name: "Calgary Terminal", city: "Calgary", province: "AB" },
];

const loads = [
  {
    delivery: { contact: { company: "Toronto Yard", name: "John", city: "Toronto", state: "ON" } },
    pickup: { contact: { company: "Vancouver Depot", name: "Jane", city: "Vancouver", state: "BC" } },
  },
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Alternate Delivery - Location Merging", () => {
  it("merges platform and load-derived locations", () => {
    const result = mergeLocations(platformLocs, loads, []);
    const names = result.map((l) => l.name);
    expect(names).toContain("Winnipeg Terminal");
    expect(names).toContain("Calgary Terminal");
    expect(names).toContain("Toronto Yard");
    expect(names).toContain("Vancouver Depot");
  });

  it("includes newly created locations in the merged list", () => {
    const newLoc: LocationItem = {
      id: "new-12345",
      name: "Edmonton Lot",
      city: "Edmonton",
      province: "AB",
      lat: 53.5,
      lng: -113.5,
      source: "load",
    };
    const result = mergeLocations(platformLocs, loads, [newLoc]);
    const names = result.map((l) => l.name);
    expect(names).toContain("Edmonton Lot");
  });

  it("does not duplicate if created location has same name as platform location", () => {
    const duplicate: LocationItem = {
      id: "new-dup",
      name: "Winnipeg Terminal",
      city: "Winnipeg",
      province: "MB",
      source: "load",
    };
    const result = mergeLocations(platformLocs, loads, [duplicate]);
    const winnipegEntries = result.filter(
      (l) => l.name.toLowerCase() === "winnipeg terminal"
    );
    expect(winnipegEntries).toHaveLength(1);
    // Platform version should win (it's added first)
    expect(winnipegEntries[0].id).toBe("platform-1");
  });

  it("sorts locations alphabetically", () => {
    const result = mergeLocations(platformLocs, loads, []);
    const names = result.map((l) => l.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describe("Alternate Delivery - Location Filtering", () => {
  const allLocs = mergeLocations(platformLocs, loads, []);

  it("limits to MAX_VISIBLE when no search query", () => {
    // We have 4 locations from test data, all should show (< MAX_VISIBLE)
    const result = filterLocations(allLocs, "", null);
    expect(result.length).toBeLessThanOrEqual(MAX_VISIBLE);
    expect(result.length).toBe(allLocs.length); // 4 < 5
  });

  it("limits to MAX_VISIBLE when there are more locations", () => {
    // Create 10 locations
    const manyLocs: LocationItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `loc-${i}`,
      name: `Location ${String.fromCharCode(65 + i)}`,
      source: "load" as const,
    }));
    const result = filterLocations(manyLocs, "", null);
    expect(result.length).toBe(MAX_VISIBLE);
  });

  it("filters by name", () => {
    const result = filterLocations(allLocs, "Winnipeg", null);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Winnipeg Terminal");
  });

  it("filters by city", () => {
    const result = filterLocations(allLocs, "Toronto", null);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Toronto Yard");
  });

  it("filters by province", () => {
    const result = filterLocations(allLocs, "AB", null);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Calgary Terminal");
  });

  it("ensures selected location is always visible even when truncated", () => {
    // Create 10 locations, select the last one (which would be cut off by MAX_VISIBLE)
    const manyLocs: LocationItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `loc-${i}`,
      name: `Location ${String.fromCharCode(65 + i)}`,
      source: "load" as const,
    }));
    const lastLoc = manyLocs[9]; // "Location J" - beyond MAX_VISIBLE
    const result = filterLocations(manyLocs, "", lastLoc);
    expect(result.some((l) => l.id === lastLoc.id)).toBe(true);
    // Should be prepended
    expect(result[0].id).toBe(lastLoc.id);
  });

  it("does not duplicate selected location if already in visible list", () => {
    const firstLoc = allLocs[0];
    const result = filterLocations(allLocs, "", firstLoc);
    const matches = result.filter((l) => l.id === firstLoc.id);
    expect(matches.length).toBe(1);
  });
});

describe("Alternate Delivery - Create Location Flow", () => {
  it("newly created location appears in merged list and can be selected", () => {
    // Simulate: user creates a new location
    const newLoc: LocationItem = {
      id: `platform-999`,
      name: "Saskatoon Yard",
      address: "123 Main St",
      city: "Saskatoon",
      province: "SK",
      lat: 52.13,
      lng: -106.67,
      source: "platform",
    };

    // Step 1: Before creation, location doesn't exist
    const before = mergeLocations(platformLocs, loads, []);
    expect(before.some((l) => l.name === "Saskatoon Yard")).toBe(false);

    // Step 2: After creation, add to createdLocations
    const after = mergeLocations(platformLocs, loads, [newLoc]);
    expect(after.some((l) => l.name === "Saskatoon Yard")).toBe(true);

    // Step 3: The location is visible and selectable in filtered list
    const filtered = filterLocations(after, "", newLoc);
    expect(filtered.some((l) => l.id === newLoc.id)).toBe(true);
  });

  it("newly created location is visible even with empty search and many locations", () => {
    // 10 existing locations + 1 newly created
    const existingLocs: LocationItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `existing-${i}`,
      name: `AAA Location ${i}`,
      source: "load" as const,
    }));

    const newLoc: LocationItem = {
      id: "new-created",
      name: "ZZZ New Place",
      source: "platform",
    };

    // ZZZ sorts last, so it would be beyond MAX_VISIBLE
    const allLocs = [...existingLocs, newLoc].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Without selection, it's cut off
    const withoutSelection = filterLocations(allLocs, "", null);
    expect(withoutSelection.some((l) => l.id === "new-created")).toBe(false);

    // With selection (as happens after creation), it's prepended
    const withSelection = filterLocations(allLocs, "", newLoc);
    expect(withSelection.some((l) => l.id === "new-created")).toBe(true);
    expect(withSelection[0].id).toBe("new-created");
  });

  it("search query is cleared after creation so location is visible", () => {
    // Simulate: user had a search query, creates location, search is cleared
    const newLoc: LocationItem = {
      id: "new-abc",
      name: "Regina Terminal",
      city: "Regina",
      province: "SK",
      source: "platform",
    };
    const allLocs = mergeLocations(platformLocs, loads, [newLoc]);

    // With cleared search (empty string) and selected location
    const result = filterLocations(allLocs, "", newLoc);
    expect(result.some((l) => l.id === "new-abc")).toBe(true);
  });
});
