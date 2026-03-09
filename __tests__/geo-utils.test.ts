/**
 * Unit tests for geo-utils: Haversine distance calculation
 * and the DELIVERY_PROXIMITY_THRESHOLD_MILES constant.
 */
import { describe, it, expect } from "vitest";
import {
  haversineDistanceMiles,
  DELIVERY_PROXIMITY_THRESHOLD_MILES,
} from "../lib/geo-utils";

describe("haversineDistanceMiles", () => {
  it("returns 0 for the same point", () => {
    const d = haversineDistanceMiles(40.7128, -74.006, 40.7128, -74.006);
    expect(d).toBe(0);
  });

  it("calculates NYC to LA as roughly 2,451 miles", () => {
    // NYC: 40.7128, -74.0060
    // LA: 34.0522, -118.2437
    const d = haversineDistanceMiles(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });

  it("calculates short distance (same city) as < 1 mile", () => {
    // Two points in Manhattan ~0.5 miles apart
    const d = haversineDistanceMiles(40.7580, -73.9855, 40.7527, -73.9772);
    expect(d).toBeLessThan(1);
    expect(d).toBeGreaterThan(0);
  });

  it("calculates a known ~60 mile distance", () => {
    // NYC to Philadelphia is roughly 80 miles
    const d = haversineDistanceMiles(40.7128, -74.006, 39.9526, -75.1652);
    expect(d).toBeGreaterThan(70);
    expect(d).toBeLessThan(100);
  });

  it("handles negative latitudes (Southern Hemisphere)", () => {
    // Sydney to Melbourne ~440 miles
    const d = haversineDistanceMiles(-33.8688, 151.2093, -37.8136, 144.9631);
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(500);
  });

  it("handles crossing the equator", () => {
    // Bogota (4.7110, -74.0721) to Lima (-12.0464, -77.0428) ~1,180 miles
    const d = haversineDistanceMiles(4.711, -74.0721, -12.0464, -77.0428);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1250);
  });

  it("handles crossing the prime meridian", () => {
    // London to Paris ~213 miles
    const d = haversineDistanceMiles(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(230);
  });
});

describe("DELIVERY_PROXIMITY_THRESHOLD_MILES", () => {
  it("is set to 20 miles", () => {
    expect(DELIVERY_PROXIMITY_THRESHOLD_MILES).toBe(20);
  });

  it("correctly classifies a 5-mile distance as within range", () => {
    // Two points ~5 miles apart in NJ
    const d = haversineDistanceMiles(40.7128, -74.006, 40.7828, -74.006);
    expect(d).toBeLessThan(DELIVERY_PROXIMITY_THRESHOLD_MILES);
  });

  it("correctly classifies a 50-mile distance as out of range", () => {
    // NYC to Trenton ~57 miles
    const d = haversineDistanceMiles(40.7128, -74.006, 40.2171, -74.7429);
    expect(d).toBeGreaterThan(DELIVERY_PROXIMITY_THRESHOLD_MILES);
  });
});
