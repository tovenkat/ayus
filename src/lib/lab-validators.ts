/**
 * Deterministic post-extraction validators.
 *
 * Runs after the LLM extraction returns structured tests, before we persist
 * them as TestResult rows. Purpose: catch nonsense the LLM confidently
 * emitted (e.g. HbA1c of 180 when the report clearly said 18.0, or an OCR
 * unit-swap like Hemoglobin in mg/dL when it should be g/dL).
 *
 * Design principles:
 *  - Deterministic, not LLM. This layer never calls a model.
 *  - Never destroy data. Out-of-bounds values stay in observedValueRaw for
 *    audit; only confidence/interpretation get adjusted so the dashboard
 *    doesn't treat them as truth.
 *  - Fail loud, not silent. Every adjustment adds a machine-readable
 *    `warnings[]` string so downstream code can surface it.
 */

const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Threshold below which a LOINC assignment is considered too weak to trust
 * without human review. Matches the user's "LOINC confidence < 0.85 → review"
 * rule. Computed by `computeLoincConfidence()` from the biomarker match
 * outcome and unit/specimen agreement.
 */
export const LOINC_CONFIDENCE_THRESHOLD = 0.85;

export type ValidatorInput = {
  observedValueRaw: string;
  observedValueNumeric: number | null;
  observedValueUnit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  confidence: number;
  /**
   * Non-null when the biomarker resolver matched this row to a canonical.
   * `hasLoinc` is true iff the canonical carries a LOINC code.
   */
  canonical: {
    minValue: number | null;
    maxValue: number | null;
    expectedUnit: string | null;
    hasLoinc: boolean;
  } | null;
};

export type ValidatorOutput = {
  /**
   * Set when a deterministic hard-check fires. Higher-severity than a bare
   * warning — implies the row cannot be trusted at face value:
   *   - "out_of_bounds"           value outside canonical min/max
   *   - "expected_numeric_missing" quantitative test has no numeric value
   *   - "reference_range_inverted" ref low >= ref high
   *   - "value_not_in_raw"        numeric doesn't appear in raw string
   *   - "low_loinc_confidence"    LOINC assignment confidence < threshold
   */
  plausibilityFlag:
    | "out_of_bounds"
    | "expected_numeric_missing"
    | "reference_range_inverted"
    | "value_not_in_raw"
    | "low_loinc_confidence"
    | null;
  /** Adjusted confidence — forced to 0 when a hard-check fires. */
  confidence: number;
  /** 0.0–1.0 confidence that the assigned LOINC (if any) is correct. */
  loincConfidence: number;
  /** Machine-readable strings, e.g. `"out_of_bounds: 180 > 20"`. */
  warnings: string[];
  /** True if this row should push its Report into NEEDS_REVIEW. */
  needsReview: boolean;
};

/**
 * Compute a per-row LOINC-assignment confidence score.
 *
 * We don't do fuzzy biomarker matching, so if `canonical` is null the row
 * has no LOINC at all → confidence 0. If it does have a canonical, the
 * confidence depends on whether the canonical carries a LOINC code and
 * whether the observed unit agrees with the canonical's expected unit
 * (a unit mismatch weakens our belief that the same LOINC applies).
 */
export function computeLoincConfidence(
  canonical: ValidatorInput["canonical"],
  observedValueUnit: string | null,
): number {
  if (!canonical) return 0;                    // unresolved biomarker
  if (!canonical.hasLoinc) return 0.5;         // matched but no LOINC on file

  let score = 1.0;
  if (canonical.expectedUnit && observedValueUnit) {
    const expected = normalizeUnit(canonical.expectedUnit);
    const observed = normalizeUnit(observedValueUnit);
    if (expected && observed && expected !== observed) {
      // Unit doesn't match what LOINC expects — halfway between confident
      // and unknown. Common when a Serum vs Whole-Blood variant of the
      // same test slipped through.
      score = 0.6;
    }
  }
  return score;
}

function normalizeUnit(u: string | null): string {
  return (u ?? "")
    .toLowerCase()
    .replace(/[\s.,]/g, "")
    .replace(/μ/g, "µ")     // unify micro sign
    .replace(/^u/, "µ");    // "u" prefix → µ (common OCR/LLM slip)
}

/**
 * Extract every numeric token from a raw observed-value string. Handles
 * comma thousands separators, leading operators (`<`, `>`, `≤`), and
 * scientific notation. Used to verify that `observedValueNumeric` isn't
 * something the LLM invented — the number should be findable in the raw.
 */
function extractNumbersFromRaw(raw: string): number[] {
  const cleaned = raw.replace(/,(\d{3})/g, "$1"); // drop thousands separators
  const matches = cleaned.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  return matches.map(Number).filter((n) => !Number.isNaN(n));
}

/**
 * A canonical is "quantitative" if we have any numeric bound configured.
 * Ratios (e.g. A/G Ratio) count as quantitative even with an empty unit.
 * If no canonical is linked we can't tell — return null (skip the check).
 */
function isQuantitative(canonical: ValidatorInput["canonical"]): boolean | null {
  if (!canonical) return null;
  return canonical.minValue !== null || canonical.maxValue !== null;
}

/**
 * Validate a single extracted test. Never throws — always returns a
 * decision. Callers merge the returned confidence/flag/warnings into the
 * TestResult row being persisted.
 *
 * Checks (in order — first hard-check to fire wins the plausibilityFlag,
 * but all applicable warnings are collected):
 *
 *   1. Quantitative-numeric: a test with numeric bounds must have a numeric
 *      value. Catches "HbA1c: Negative" nonsense the LLM might emit.
 *   2. Value-in-raw: the emitted numeric must appear in observedValueRaw.
 *      Weak provenance check — guards against invented digits.
 *   3. Reference range order: refLow < refHigh.
 *   4. Numeric plausibility: value within canonical min/max.
 *   5. Unit sanity: warn on mismatch (soft, doesn't force review).
 *   6. Confidence gate: below threshold → route to review.
 */
export function validateExtractedTest(input: ValidatorInput): ValidatorOutput {
  const warnings: string[] = [];
  let plausibilityFlag: ValidatorOutput["plausibilityFlag"] = null;
  let confidence = input.confidence;
  let needsReview = false;

  const {
    canonical, observedValueRaw, observedValueNumeric, observedValueUnit,
    referenceLow, referenceHigh,
  } = input;

  const loincConfidence = computeLoincConfidence(canonical, observedValueUnit);

  const setFlag = (flag: NonNullable<ValidatorOutput["plausibilityFlag"]>) => {
    // First hard-fail wins so the UI has one dominant reason to surface.
    if (plausibilityFlag === null) plausibilityFlag = flag;
  };

  // 1. Quantitative-numeric — if this test is supposed to produce a number,
  //    it MUST have one. Skips when we have no canonical or bounds.
  const quant = isQuantitative(canonical);
  if (quant === true && observedValueNumeric === null) {
    setFlag("expected_numeric_missing");
    warnings.push(
      `expected_numeric_missing: raw="${observedValueRaw}" for a quantitative test`,
    );
  }

  // 2. Value-in-raw — the numeric the LLM emitted should appear in the
  //    string it (allegedly) parsed from. Weak provenance check that
  //    catches invented digits and decimal-point moves ("135" → "13.5").
  if (observedValueNumeric !== null && observedValueRaw.trim() !== "") {
    const rawNumbers = extractNumbersFromRaw(observedValueRaw);
    const found = rawNumbers.some((n) => Math.abs(n - observedValueNumeric) < 1e-6);
    if (!found && rawNumbers.length > 0) {
      setFlag("value_not_in_raw");
      warnings.push(
        `value_not_in_raw: numeric=${observedValueNumeric} not in raw="${observedValueRaw}" (found: ${rawNumbers.join(",")})`,
      );
    }
  }

  // 3. Reference range order — inverted ranges usually mean the LLM
  //    swapped low/high or misread a hyphen.
  if (referenceLow !== null && referenceHigh !== null && referenceLow >= referenceHigh) {
    setFlag("reference_range_inverted");
    warnings.push(`reference_range_inverted: low=${referenceLow} >= high=${referenceHigh}`);
  }

  // 4. Numeric plausibility — reject nonsense values while keeping the raw
  //    for audit. Skipped when we don't have bounds (canonical unknown or
  //    no bounds configured) or the value is non-numeric.
  if (canonical && observedValueNumeric !== null) {
    const { minValue, maxValue } = canonical;
    if (minValue !== null && observedValueNumeric < minValue) {
      setFlag("out_of_bounds");
      warnings.push(`out_of_bounds: ${observedValueNumeric} < ${minValue}`);
    } else if (maxValue !== null && observedValueNumeric > maxValue) {
      setFlag("out_of_bounds");
      warnings.push(`out_of_bounds: ${observedValueNumeric} > ${maxValue}`);
    }
  }

  // 5. Unit sanity — warn but don't reject. Different labs use different
  //    units for the same test (Creatinine in mg/dL vs µmol/L); the LLM
  //    should preserve whatever was printed. A mismatch is a signal, not
  //    proof of an error.
  if (canonical?.expectedUnit && observedValueUnit) {
    const expected = normalizeUnit(canonical.expectedUnit);
    const observed = normalizeUnit(observedValueUnit);
    if (expected && observed && expected !== observed) {
      warnings.push(`unit_mismatch: got "${observedValueUnit}", expected "${canonical.expectedUnit}"`);
    }
  }

  // 6. LOINC confidence gate — a weak LOINC assignment means the row has
  //    no stable external identifier we can trust for cross-report joins.
  //    User rule: "LOINC confidence < 0.85 → send to review".
  if (loincConfidence < LOINC_CONFIDENCE_THRESHOLD) {
    setFlag("low_loinc_confidence");
    warnings.push(
      `low_loinc_confidence: ${loincConfidence.toFixed(2)} < ${LOINC_CONFIDENCE_THRESHOLD} ` +
      `(${canonical ? (canonical.hasLoinc ? "unit_mismatch_weakens_loinc" : "canonical_has_no_loinc") : "unresolved_biomarker"})`,
    );
  }

  // 7. Any hard-check fired → force confidence to 0 and route to review.
  //    We can't trust a value that failed a deterministic sanity check.
  //    Exception: low_loinc_confidence is a "route to review" signal, not a
  //    "the number is nonsense" one — leave confidence intact.
  const forcesConfidenceZero = plausibilityFlag !== null && plausibilityFlag !== "low_loinc_confidence";
  if (forcesConfidenceZero) {
    confidence = 0;
    needsReview = true;
  } else if (plausibilityFlag === "low_loinc_confidence") {
    needsReview = true;
  }

  // 8. Low-confidence gate — even if plausibility passed, a genuinely
  //    uncertain extraction should route through review.
  if (confidence < CONFIDENCE_THRESHOLD) {
    needsReview = true;
  }

  return { plausibilityFlag, confidence, loincConfidence, warnings, needsReview };
}

/**
 * Apply validation across a full batch of extracted rows. Also computes the
 * aggregate `needsReview` flag for the Report, which flips true when any
 * test needs review OR the overall report confidence is below threshold.
 */
export function validateExtractionBatch<
  T extends {
    canonicalTestId?: string | null;
    observedValueRaw: string;
    observedValueNumeric: number | null;
    observedValueUnit: string | null;
    referenceLow: number | null;
    referenceHigh: number | null;
    confidence: number;
  },
>(
  rows: T[],
  canonicals: Map<string, ValidatorInput["canonical"]>,
  reportConfidence: number,
): {
  validated: Array<T & { plausibilityFlag: string | null; warnings: string[] }>;
  reportNeedsReview: boolean;
} {
  let reportNeedsReview = reportConfidence < CONFIDENCE_THRESHOLD;

  const validated = rows.map((row) => {
    const canonical = row.canonicalTestId ? canonicals.get(row.canonicalTestId) ?? null : null;
    const v = validateExtractedTest({
      observedValueRaw: row.observedValueRaw,
      observedValueNumeric: row.observedValueNumeric,
      observedValueUnit: row.observedValueUnit,
      referenceLow: row.referenceLow,
      referenceHigh: row.referenceHigh,
      confidence: row.confidence,
      canonical,
    });
    if (v.needsReview) reportNeedsReview = true;
    return {
      ...row,
      confidence: v.confidence,
      plausibilityFlag: v.plausibilityFlag,
      warnings: v.warnings,
    };
  });

  return { validated, reportNeedsReview };
}

export const LAB_VALIDATOR_CONFIDENCE_THRESHOLD = CONFIDENCE_THRESHOLD;
