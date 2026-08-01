/**
 * VIN Validator
 *
 * Implements the ISO 3779 / SAE J853 check-digit algorithm and a small
 * OCR-confusion-aware candidate picker. The scanner uses this to reject
 * "looks-like-a-VIN" strings (17 chars in the VIN alphabet) that don't
 * actually validate, which is the #1 source of wrong-vehicle bugs when
 * the camera misreads a single character (B↔8, S↔5, O↔0, I↔1, etc.).
 *
 * Design notes:
 *
 * - For North American VINs (WMI starts with 1-5) the check digit is
 *   MANDATORY under FMVSS 115 — every legitimate NA vehicle since
 *   1981 has a valid check digit at position 9.
 *
 * - For non-NA VINs (Europe S-Z, Asia J-R, etc.) ISO 3779 does NOT
 *   require a check digit, so we treat it as a best-effort signal:
 *   we'll still PREFER candidates whose check digit passes, but we
 *   won't refuse a structurally-correct non-NA VIN that lacks one.
 *
 * - The Puls Dispatch fleet operates almost entirely in Canada/US so
 *   in practice ~100% of scanned VINs are subject to the strict path.
 */

// ─── Alphabet & weights (ISO 3779 / SAE J853) ─────────────────────────────────

/** VINs use the full alphanumeric set EXCEPT I, O, Q. */
export const VIN_CHAR_RE = /^[A-HJ-NPR-Z0-9]+$/;

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// ─── Core validation ──────────────────────────────────────────────────────────

export function isStructurallyValidVIN(vin: string): boolean {
  const v = vin.trim().toUpperCase();
  return v.length === 17 && VIN_CHAR_RE.test(v);
}

export function isNorthAmericanVIN(vin: string): boolean {
  return /^[1-5]/.test(vin.trim().toUpperCase());
}

/**
 * Compute the expected check-digit character for a structurally-valid
 * VIN. Returns '0'-'9' or 'X', or null if the VIN contains characters
 * outside the VIN alphabet.
 */
export function computeVINCheckDigit(vin: string): string | null {
  const v = vin.trim().toUpperCase();
  if (v.length !== 17) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v.charAt(i);
    const val = TRANSLITERATION[ch];
    if (val === undefined) return null;
    sum += val * WEIGHTS[i];
  }
  const mod = sum % 11;
  return mod === 10 ? "X" : String(mod);
}

export function isValidVINCheckDigit(vin: string): boolean {
  const expected = computeVINCheckDigit(vin);
  if (expected === null) return false;
  return expected === vin.trim().toUpperCase().charAt(8);
}

/**
 * Combined "is this VIN actually acceptable for use" gate.
 *
 * For NA VINs (1-5 WMI) the check digit MUST validate — anything else
 * is almost certainly an OCR misread. For non-NA VINs the alphabet +
 * length check is sufficient because the check digit is optional.
 */
export function isAcceptableVIN(vin: string): boolean {
  const v = vin.trim().toUpperCase();
  if (!isStructurallyValidVIN(v)) return false;
  if (isNorthAmericanVIN(v)) return isValidVINCheckDigit(v);
  return true;
}

// ─── OCR ambiguity correction ─────────────────────────────────────────────────

/**
 * Hard corrections — these characters CANNOT exist in any legitimate
 * VIN (the spec excludes I, O, Q), so OCR seeing them is always a
 * misread of the visually identical digit.
 */
const HARD_CORRECTIONS: Record<string, string> = {
  I: "1",
  O: "0",
  Q: "0",
};

/**
 * Soft ambiguities — these pairs are visually similar in many fonts
 * (especially the VIN-stamping fonts used on door jambs and dashboards),
 * but BOTH forms are valid VIN characters, so we can't blindly
 * substitute. Instead we generate all combinations and pick the one
 * whose check digit validates.
 *
 * The order of the array doesn't matter to correctness, only to the
 * candidate-search ordering (fewer-substitutions-first ranking is
 * applied separately).
 */
const SOFT_AMBIGUITIES: ReadonlyArray<readonly [string, string]> = [
  ["B", "8"],
  ["S", "5"],
  ["Z", "2"],
  ["D", "0"],
  ["G", "6"],
];

/** Build a lookup from each ambiguous char to its sibling. */
const SOFT_SIBLINGS: Record<string, string> = {};
for (const [a, b] of SOFT_AMBIGUITIES) {
  SOFT_SIBLINGS[a] = b;
  SOFT_SIBLINGS[b] = a;
}

/** Hard-correct a raw OCR string by collapsing I/O/Q to their digit twins. */
function hardCorrect(raw: string): string {
  let out = "";
  for (const ch of raw.toUpperCase()) {
    out += HARD_CORRECTIONS[ch] ?? ch;
  }
  return out;
}

/**
 * Cap on total candidates we'll generate when soft ambiguities are
 * abundant. 64 covers up to 6 ambiguous chars (2^6 = 64), which is
 * realistic for typical OCR output. If a string has 7+ ambiguous chars
 * we just try the original — the OCR quality is too poor to be useful
 * anyway and forcing 128+ candidates wastes CPU.
 */
const MAX_CANDIDATES = 64;

// ─── Label-anchored extraction (v68+) ────────────────────────────────────────

/**
 * Matches "VIN" used as a label (followed by `:`, `.`, `#`, `/`, or
 * whitespace, OR at the very end of a token). Case-insensitive.
 *
 * Examples that match: "VIN:", "VIN.", "VIN ", "V.I.N.", "VIN #".
 *
 * Examples that DON'T match (to avoid false positives in body text):
 * "VINTAGE", "VINYL", "REVINDICATED" — because they continue with
 * other letters after VIN.
 */
const VIN_LABEL_RE = /\b(?:V\.?\s?I\.?\s?N\.?)(?=[:.\s#/]|$)/i;

/**
 * Given a 17-char string (already hard-corrected), enumerate all soft-
 * ambiguity variants. Returns candidates ordered by ascending number of
 * substitutions (so the unchanged original comes first).
 */
function enumerateSoftVariants(base: string): { vin: string; subs: number }[] {
  const ambiguousIndices: number[] = [];
  for (let i = 0; i < base.length; i++) {
    if (SOFT_SIBLINGS[base.charAt(i)]) ambiguousIndices.push(i);
  }

  // Too many ambiguities — fall back to original only.
  if (ambiguousIndices.length > 6) {
    return [{ vin: base, subs: 0 }];
  }

  const total = 1 << ambiguousIndices.length; // 2^N
  const results: { vin: string; subs: number }[] = [];
  for (let mask = 0; mask < total && results.length < MAX_CANDIDATES; mask++) {
    const chars = base.split("");
    let subs = 0;
    for (let bit = 0; bit < ambiguousIndices.length; bit++) {
      if ((mask >> bit) & 1) {
        const idx = ambiguousIndices[bit];
        chars[idx] = SOFT_SIBLINGS[chars[idx]];
        subs++;
      }
    }
    results.push({ vin: chars.join(""), subs });
  }
  results.sort((a, b) => a.subs - b.subs);
  return results;
}

export interface VINCandidate {
  vin: string;
  checkDigitValid: boolean;
  substitutions: number;
  isNorthAmerican: boolean;
  /**
   * v68+: true when this candidate was extracted from text immediately
   * following a "VIN:" label. Label-anchored candidates are far more
   * trustworthy than blind window slides, so we surface this so the
   * scanner UI can accept them on a single frame.
   */
  labelAnchored: boolean;
}

export interface PickOptions {
  /**
   * v68+: when true (the default), candidates whose first character
   * isn't 1-5 (North American WMI) are rejected outright. Set to false
   * if you genuinely need to accept European / Asian / etc. VINs.
   *
   * The Puls Dispatch fleet is virtually all NA, and this guard kills
   * the dominant remaining false-positive class — sticker text where
   * a random 17-char window starts with a letter and happens to pass
   * the check digit by coincidence (~9.1% rate).
   */
  northAmericanOnly?: boolean;
}

const DEFAULT_PICK_OPTIONS: Required<PickOptions> = {
  northAmericanOnly: true,
};

/**
 * Extract the best-validated VIN from a single contiguous string.
 *
 * Pipeline (v68+):
 *  1. Uppercase and split on whitespace to get token list. A real VIN is
 *     always one contiguous 17-character token — never split across
 *     words. Sliding the window across joined whitespace was the root
 *     cause of the "ANRANA…" sticker bug.
 *  2. For each token, slide a 17-char window across it.
 *  3. For each window, hard-correct I/O/Q, validate VIN alphabet,
 *     enumerate soft-ambiguity variants.
 *  4. Score candidates: check-digit-pass beats length-only; fewer
 *     substitutions beats more.
 *  5. If `northAmericanOnly` is on (default), reject candidates whose
 *     WMI isn't 1-5.
 *
 * Returned `vin` is the corrected string — what the caller should USE.
 * The boolean `checkDigitValid` lets the caller decide whether to
 * accept immediately (true) or wait for a confirming read (false).
 */
export function pickBestVINCandidate(
  rawText: string,
  options?: PickOptions,
): VINCandidate | null {
  const opts = { ...DEFAULT_PICK_OPTIONS, ...options };
  const tokens = rawText.toUpperCase().split(/\s+/).filter((t) => t.length >= 17);
  if (tokens.length === 0) return null;

  let best: VINCandidate | null = null;

  for (const token of tokens) {
    // Slide a 17-char window across this token only. The whitespace
    // split above guarantees the window can never span two unrelated
    // fields on a label.
    for (let i = 0; i + 17 <= token.length; i++) {
      const window = token.slice(i, i + 17);
      const corrected = hardCorrect(window);
      if (!VIN_CHAR_RE.test(corrected)) continue;

      const variants = enumerateSoftVariants(corrected);
      for (const variant of variants) {
        const isNA = isNorthAmericanVIN(variant.vin);
        if (opts.northAmericanOnly && !isNA) continue;
        const checkDigitValid = isValidVINCheckDigit(variant.vin);
        const candidate: VINCandidate = {
          vin: variant.vin,
          checkDigitValid,
          substitutions: variant.subs,
          isNorthAmerican: isNA,
          labelAnchored: false,
        };
        if (isBetter(candidate, best)) best = candidate;
        if (best && best.checkDigitValid && best.substitutions === 0) return best;
      }
    }
  }

  return best;
}

// ─── Label-anchored extraction from OCR blocks (v68+) ─────────────────────────

/**
 * Subset of the rn-mlkit-ocr OcrResult shape that we actually use.
 *
 * We type just what we need so the validator stays runtime-independent
 * (testable in pure Node without RN) and so future MLKit API changes
 * don't break the validator.
 */
export interface OcrLineLike {
  text: string;
}
export interface OcrBlockLike {
  text: string;
  lines: OcrLineLike[];
}
export interface OcrResultLike {
  text: string;
  blocks: OcrBlockLike[];
}

/**
 * Try the label-anchored path first: walk every OCR line looking for a
 * "VIN:" / "V.I.N." label, then extract the 17-char VIN that follows
 * it (possibly continuing onto the next line if the current line ends
 * mid-VIN).
 *
 * Returns a candidate with `labelAnchored: true` when a label is found.
 * Returns null otherwise — the caller should fall back to whole-text
 * search via {@link pickBestVINCandidate} for windshield-etched VINs
 * that have no surrounding label.
 */
export function pickLabelAnchoredVIN(
  result: OcrResultLike,
  options?: PickOptions,
): VINCandidate | null {
  const opts = { ...DEFAULT_PICK_OPTIONS, ...options };
  let best: VINCandidate | null = null;

  for (const block of result.blocks) {
    const lines = block.lines;
    for (let li = 0; li < lines.length; li++) {
      const labelLine = lines[li].text;
      const match = labelLine.match(VIN_LABEL_RE);
      if (!match) continue;

      // Take everything after the label on this line, plus the next
      // line in full (handles cases where the VIN wraps).
      const afterLabel = labelLine.slice(match.index! + match[0].length);
      const nextLine = lines[li + 1]?.text ?? "";
      const haystack = `${afterLabel} ${nextLine}`;

      // Now collapse whitespace within the haystack — once we're
      // already anchored on a label, the VIN itself might still have
      // OCR-inserted spaces inside it (e.g. "1FTWW33P03 ED48830").
      // We DON'T do this for the non-anchored pickBestVINCandidate
      // path because that's where the sticker-bug cross-field
      // concatenation comes from.
      const collapsed = haystack.replace(/\s+/g, "").toUpperCase();
      if (collapsed.length < 17) continue;

      for (let i = 0; i + 17 <= collapsed.length; i++) {
        const window = collapsed.slice(i, i + 17);
        const corrected = hardCorrect(window);
        if (!VIN_CHAR_RE.test(corrected)) continue;

        const variants = enumerateSoftVariants(corrected);
        for (const variant of variants) {
          const isNA = isNorthAmericanVIN(variant.vin);
          if (opts.northAmericanOnly && !isNA) continue;
          const checkDigitValid = isValidVINCheckDigit(variant.vin);
          const candidate: VINCandidate = {
            vin: variant.vin,
            checkDigitValid,
            substitutions: variant.subs,
            isNorthAmerican: isNA,
            labelAnchored: true,
          };
          if (isBetter(candidate, best)) best = candidate;
          // The label gave us a precise location — first
          // check-digit-valid candidate in this window is the answer.
          if (best && best.checkDigitValid && best.substitutions === 0) {
            return best;
          }
        }
        // Only try the FIRST window after the label — VIN should
        // start immediately. If the first window doesn't yield a
        // validated candidate, we can still try later windows in
        // case the OCR injected garbage chars between label and VIN.
      }
    }
  }

  return best;
}

/**
 * High-level entry point used by the scanner.
 *
 * Tries the label-anchored extraction first (precise, robust against
 * cross-field concatenation on stickers and labels). Falls back to
 * the whole-text candidate picker for windshield etchings and dash
 * plates where there's no surrounding label.
 */
export function pickBestVINFromOcrResult(
  result: OcrResultLike,
  options?: PickOptions,
): VINCandidate | null {
  const anchored = pickLabelAnchoredVIN(result, options);
  if (anchored && anchored.checkDigitValid) return anchored;

  const blind = pickBestVINCandidate(result.text, options);

  // If we have both, prefer the anchored one (even non-validated) over
  // a blind candidate that didn't validate either. Anchored beats blind
  // when both are weak signals.
  if (anchored && (!blind || !blind.checkDigitValid)) return anchored;
  return blind;
}

function isBetter(a: VINCandidate, b: VINCandidate | null): boolean {
  if (!b) return true;
  // Check digit pass beats fail.
  if (a.checkDigitValid !== b.checkDigitValid) return a.checkDigitValid;
  // Fewer substitutions wins.
  return a.substitutions < b.substitutions;
}
