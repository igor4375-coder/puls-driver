/**
 * Tests for the VIN validator.
 *
 * Covers the ISO 3779 / SAE J853 check-digit algorithm, the
 * North-American-VIN strictness rule, and the OCR-ambiguity-aware
 * candidate picker that powers the camera scanner.
 */

import { describe, it, expect } from "vitest";
import {
  computeVINCheckDigit,
  isValidVINCheckDigit,
  isStructurallyValidVIN,
  isNorthAmericanVIN,
  isAcceptableVIN,
  pickBestVINCandidate,
  pickLabelAnchoredVIN,
  pickBestVINFromOcrResult,
  type OcrResultLike,
} from "../lib/vin-validator";

describe("computeVINCheckDigit", () => {
  // 1HGBH41JXMN109186 — the canonical NHTSA example VIN. Check digit is X.
  it("returns 'X' for the canonical test VIN", () => {
    expect(computeVINCheckDigit("1HGBH41JXMN109186")).toBe("X");
  });

  it("returns null for VINs containing letters outside the VIN alphabet", () => {
    expect(computeVINCheckDigit("1HGBH41JXMN10918I")).toBeNull();
    expect(computeVINCheckDigit("1HGBH41JXMN10918O")).toBeNull();
  });

  it("returns null for wrong-length input", () => {
    expect(computeVINCheckDigit("1HGBH41JXMN10918")).toBeNull();
    expect(computeVINCheckDigit("1HGBH41JXMN1091866")).toBeNull();
  });

  it("computes a numeric check digit when sum mod 11 != 10", () => {
    // A simple synthetic case: '12345678901234567' → position 9 = '9'.
    // Verify the function returns a single digit (0–9 or X), not null.
    const cd = computeVINCheckDigit("12345678901234567");
    expect(cd).not.toBeNull();
    expect(cd).toMatch(/^[0-9X]$/);
  });
});

describe("isValidVINCheckDigit", () => {
  it("passes for valid NA VINs", () => {
    expect(isValidVINCheckDigit("1HGBH41JXMN109186")).toBe(true);
  });

  it("fails for a single-character substitution", () => {
    // Swap last digit 6 → 7.
    expect(isValidVINCheckDigit("1HGBH41JXMN109187")).toBe(false);
  });

  it("fails when the check digit itself is wrong", () => {
    // Swap position 9 X → 0.
    expect(isValidVINCheckDigit("1HGBH41J0MN109186")).toBe(false);
  });
});

describe("isStructurallyValidVIN", () => {
  it("accepts 17-char VIN-alphabet strings", () => {
    expect(isStructurallyValidVIN("1HGBH41JXMN109186")).toBe(true);
  });

  it("rejects strings containing I/O/Q", () => {
    expect(isStructurallyValidVIN("1HGBH41IXMN109186")).toBe(false);
    expect(isStructurallyValidVIN("1HGBH41JXMO109186")).toBe(false);
    expect(isStructurallyValidVIN("1HGBH41JXMQ109186")).toBe(false);
  });

  it("rejects wrong-length input", () => {
    expect(isStructurallyValidVIN("1HGBH41J")).toBe(false);
    expect(isStructurallyValidVIN("1HGBH41JXMN1091860")).toBe(false);
  });
});

describe("isNorthAmericanVIN", () => {
  it("returns true for WMI 1-5", () => {
    expect(isNorthAmericanVIN("1HGBH41JXMN109186")).toBe(true);
    expect(isNorthAmericanVIN("2HGBH41JXMN109186")).toBe(true);
    expect(isNorthAmericanVIN("5HGBH41JXMN109186")).toBe(true);
  });

  it("returns false for non-NA WMI", () => {
    expect(isNorthAmericanVIN("WBABC1234XX123456")).toBe(false);
    expect(isNorthAmericanVIN("JTDBT123456789012")).toBe(false);
  });
});

describe("isAcceptableVIN", () => {
  it("requires a valid check digit for NA VINs", () => {
    expect(isAcceptableVIN("1HGBH41JXMN109186")).toBe(true);
    expect(isAcceptableVIN("1HGBH41JXMN109187")).toBe(false);
  });

  it("accepts non-NA VINs without strict check-digit enforcement", () => {
    // W-prefix (Germany). Even if the check digit fails by chance, this
    // should still be accepted because ISO 3779 doesn't mandate one
    // outside North America.
    expect(isAcceptableVIN("WBA3A5C50DF123456")).toBe(true);
  });
});

describe("pickBestVINCandidate", () => {
  it("returns the unmodified VIN when the input is already valid", () => {
    const r = pickBestVINCandidate("1HGBH41JXMN109186");
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1HGBH41JXMN109186");
    expect(r!.checkDigitValid).toBe(true);
    expect(r!.substitutions).toBe(0);
  });

  it("hard-corrects I → 1 (illegal VIN char)", () => {
    // The original VIN has '1' at position 12; OCR returned 'I'.
    const r = pickBestVINCandidate("1HGBH41JXMNI09186");
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1HGBH41JXMN109186");
    expect(r!.checkDigitValid).toBe(true);
  });

  it("hard-corrects O → 0 (illegal VIN char)", () => {
    // Position 13 should be '0'; OCR returned 'O'.
    const r = pickBestVINCandidate("1HGBH41JXMN1O9186");
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1HGBH41JXMN109186");
    expect(r!.checkDigitValid).toBe(true);
  });

  it("explores soft ambiguities (B↔8) and picks the candidate whose check digit passes", () => {
    // Real VIN starts with '1HGBH'. Suppose OCR returned '1HG8H' (B→8).
    // The candidate picker should flip the 8 back to B (1 substitution)
    // because that's the only variant that validates.
    const r = pickBestVINCandidate("1HG8H41JXMN109186");
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1HGBH41JXMN109186");
    expect(r!.checkDigitValid).toBe(true);
    expect(r!.substitutions).toBe(1);
  });

  it("returns a structurally-valid NA candidate even when no variant validates", () => {
    // Random NA-prefixed gibberish where no soft-ambiguity variant
    // validates. Caller sees checkDigitValid: false. v68 also requires
    // northAmericanOnly default to be satisfied (this candidate starts
    // with '1' so it passes that gate).
    const r = pickBestVINCandidate("1ACEFHJKLMNPRTUVW");
    expect(r).not.toBeNull();
    expect(r!.isNorthAmerican).toBe(true);
    expect(r!.checkDigitValid).toBe(false);
  });

  it("returns null when input is shorter than 17 chars", () => {
    expect(pickBestVINCandidate("1HGBH41J")).toBeNull();
  });

  it("finds the VIN inside surrounding text/whitespace", () => {
    const r = pickBestVINCandidate("VIN: 1HGBH41JXMN109186  Make: HONDA");
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1HGBH41JXMN109186");
    expect(r!.checkDigitValid).toBe(true);
  });

  it("respects whitespace token boundaries (v68+ — sticker bug fix)", () => {
    // OCR returns: "ANRANA 0971SP0RNBE" — two unrelated chunks of
    // sticker text. v67 would mash them into "ANRANA0971SP0RNBE" which
    // happens to pass the check digit by coincidence. v68 splits on
    // whitespace first, so neither chunk hits 17 contiguous chars and
    // no candidate is returned.
    const r = pickBestVINCandidate("ANRANA 0971SP0RNBE");
    expect(r).toBeNull();
  });

  it("rejects non-NA VINs by default (v68+)", () => {
    // Same gibberish that coincidentally passes the check digit. v67
    // accepted it because the WMI strict gate only applied to NA VINs.
    // v68 hard-rejects non-1-5 WMIs by default.
    const r = pickBestVINCandidate("ANRANA0971SP0RNBE");
    expect(r).toBeNull();
  });

  it("can be opted-out of NA-only mode", () => {
    const r = pickBestVINCandidate("ANRANA0971SP0RNBE", { northAmericanOnly: false });
    expect(r).not.toBeNull();
    expect(r!.isNorthAmerican).toBe(false);
  });
});

// ─── Label-anchored extraction (v68+) ─────────────────────────────────────────

/** Build a minimal OcrResultLike from an array of line-text strings, all in one block. */
function ocrResult(lines: string[]): OcrResultLike {
  return {
    text: lines.join("\n"),
    blocks: [{
      text: lines.join("\n"),
      lines: lines.map((text) => ({ text })),
    }],
  };
}

describe("pickLabelAnchoredVIN", () => {
  it("finds the VIN immediately following a 'VIN:' label", () => {
    const r = pickLabelAnchoredVIN(ocrResult([
      "MFD. BY FORD MOTOR CO. IN U.S.A.",
      "DATE: 05/03",
      "VIN: 1FTWW33P03ED48830",
      "TYPE: TRU/CAM",
    ]));
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1FTWW33P03ED48830");
    expect(r!.labelAnchored).toBe(true);
    expect(r!.checkDigitValid).toBe(true);
  });

  it("finds the VIN after a 'V.I.N.' label variant", () => {
    const r = pickLabelAnchoredVIN(ocrResult([
      "V.I.N. 1HGBH41JXMN109186",
    ]));
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1HGBH41JXMN109186");
    expect(r!.labelAnchored).toBe(true);
  });

  it("ignores 'VINTAGE' and other words that start with VIN", () => {
    const r = pickLabelAnchoredVIN(ocrResult([
      "VINTAGE PORSCHE 911",
      "1FTWW33P03ED48830",
    ]));
    // No label match, so the anchored path returns null.
    expect(r).toBeNull();
  });

  it("returns null when no label is present", () => {
    // Windshield-etched case — bare VIN with no surrounding label.
    const r = pickLabelAnchoredVIN(ocrResult(["1FTWW33P03ED48830"]));
    expect(r).toBeNull();
  });

  it("continues onto the next line if the VIN wraps", () => {
    const r = pickLabelAnchoredVIN(ocrResult([
      "VIN:",
      "1FTWW33P03ED48830",
    ]));
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1FTWW33P03ED48830");
    expect(r!.labelAnchored).toBe(true);
  });

  it("collapses OCR-inserted whitespace inside the VIN after the label", () => {
    const r = pickLabelAnchoredVIN(ocrResult([
      "VIN: 1FTWW33P03 ED48830",
    ]));
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1FTWW33P03ED48830");
    expect(r!.labelAnchored).toBe(true);
  });
});

describe("pickBestVINFromOcrResult — sticker bug regression", () => {
  /**
   * Recreates the exact failure mode from the screenshot: the scanner
   * mashed every field on a Ford sticker into one big concatenated
   * string and found "ANRANA0971SP0RNBE" — a 17-char chunk spanning
   * the CANADA seal, body specs, and rim codes that coincidentally
   * passed the check digit.
   *
   * With v68, the label-anchored path runs FIRST and finds the real
   * VIN on the labeled line. Even if it didn't, the whitespace-token
   * split would prevent the cross-field concatenation, AND the
   * northAmericanOnly default would reject 'A'-prefixed candidates.
   */
  it("returns the real VIN from the labeled sticker line, not the cross-field garbage", () => {
    const r = pickBestVINFromOcrResult(ocrResult([
      "MFD. BY FORD MOTOR CO. IN U.S.A.",
      "DATE: 05/03  GVWR/PNBV: 11500LB / 5216KG",
      "CANADA TRANSPORT 977",
      "PNBE AV  PNBE AR  5200LB  8250LB",
      "VIN: 1FTWW33P03ED48830",
      "TYPE: TRU/CAM   COMPLIES: ICES-2",
      "EXT PNT F1  IRC B8",
    ]));
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1FTWW33P03ED48830");
    expect(r!.labelAnchored).toBe(true);
    expect(r!.checkDigitValid).toBe(true);
  });

  it("falls back to whole-text search for unlabeled windshield etchings", () => {
    // Windshield case — a single block, single line, just the bare VIN.
    const r = pickBestVINFromOcrResult(ocrResult(["1FTWW33P03ED48830"]));
    expect(r).not.toBeNull();
    expect(r!.vin).toBe("1FTWW33P03ED48830");
    expect(r!.checkDigitValid).toBe(true);
    // Not anchored — no label was present.
    expect(r!.labelAnchored).toBe(false);
  });

  it("returns null when only non-NA garbage is found and no label present", () => {
    const r = pickBestVINFromOcrResult(ocrResult([
      "RANDOM TEXT WITH ANRANA0971SP0RNBE EMBEDDED",
    ]));
    expect(r).toBeNull();
  });
});
