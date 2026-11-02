/**
 * Regression tests for v134 EXIF orientation normalization.
 *
 * An audit of the photo bucket found ~3% of uploads carried an EXIF
 * Orientation tag instead of having rotation baked into the pixels (e.g.
 * 1920x886 pixels tagged Orientation=6, meaning it should display as
 * 886x1920). Dispatch's viewer ignores EXIF, so those arrived sideways.
 *
 * The risk of the fix is rotating photos that were already upright, which
 * would break the 97% that are fine today. These tests pin that an absent,
 * unknown, or "already upright" tag results in no work at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const manipulateAsync = vi.fn(async (uri: string) => ({ uri: `${uri}.rotated` }));

vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...a: unknown[]) => manipulateAsync(...(a as [string])),
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
  FlipType: { Horizontal: "horizontal", Vertical: "vertical" },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("../lib/crash-reporter", () => ({ addBreadcrumb: vi.fn() }));

import { normalizeOrientation } from "../lib/image-compress";

const URI = "file://photo.jpg";

/** The actions passed to manipulateAsync on the most recent call. */
function lastActions() {
  return (manipulateAsync.mock.calls.at(-1) as unknown[])?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("leaving already-upright photos alone", () => {
  it("does nothing when there is no EXIF orientation tag", async () => {
    expect(await normalizeOrientation(URI, undefined)).toBe(URI);
    expect(manipulateAsync).not.toHaveBeenCalled();
  });

  it("does nothing for Orientation=1, which already displays upright", async () => {
    expect(await normalizeOrientation(URI, 1)).toBe(URI);
    expect(manipulateAsync).not.toHaveBeenCalled();
  });

  it("does nothing for a non-numeric or unknown tag rather than guessing", async () => {
    expect(await normalizeOrientation(URI, "6")).toBe(URI);
    expect(await normalizeOrientation(URI, 99)).toBe(URI);
    expect(await normalizeOrientation(URI, null)).toBe(URI);
    expect(manipulateAsync).not.toHaveBeenCalled();
  });
});

describe("baking rotation into pixels", () => {
  // v139: manipulateAsync applies the EXIF tag itself on decode. v134 also
  // passed an explicit rotate, which turned every iPhone portrait shot
  // (always tagged 6 by expo-camera) sideways and landscape-left shots
  // (tagged 3) upside down.
  it.each([2, 3, 4, 5, 6, 7, 8])(
    "re-encodes Orientation=%i with no extra rotate or flip",
    async (tag) => {
      const out = await normalizeOrientation(URI, tag);
      expect(out).toBe(`${URI}.rotated`);
      expect(lastActions()).toEqual([]);
    },
  );

  it("re-encodes without compressing, so normalizing costs no quality", async () => {
    await normalizeOrientation(URI, 6);
    expect((manipulateAsync.mock.calls.at(-1) as unknown[])?.[2]).toEqual({
      compress: 1,
      format: "jpeg",
    });
  });
});

describe("failure handling", () => {
  it("falls back to the original photo rather than losing the capture", async () => {
    manipulateAsync.mockRejectedValueOnce(new Error("decoder failed"));
    expect(await normalizeOrientation(URI, 6)).toBe(URI);
  });
});
