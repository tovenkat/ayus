/**
 * Report ingestion — single service call that turns an LLM extraction result
 * into a persisted Report + TestResult batch.
 *
 * Replaces the ~80-line block that was duplicated across three routes
 * (upload PDF, upload image, extract). Handles:
 *   1. Mapping extraction JSON → TestResult create shape
 *   2. Enriching each row with canonical linkage (biomarker resolver)
 *   3. Deterministic plausibility + unit validation (lab-validators)
 *   4. Persisting Report + TestResults in a single transaction
 *   5. Flipping Upload.status to NEEDS_REVIEW when the batch warrants it
 *
 * Everything in this service is deterministic — no LLM calls. LLM work
 * happens upstream (extraction); this layer is post-processing.
 */

import { prisma } from "@/lib/prisma";
import { enrichTestResults } from "@/lib/enrich-test-results";
import { validateExtractionBatch, LAB_VALIDATOR_CONFIDENCE_THRESHOLD } from "@/lib/lab-validators";
import {
  parseOperator as parseOperatorFromRaw,
  parseReferenceRange as parseRefRangeFromRaw,
  computeInterpretation as computeInterpretationFromValues,
} from "@/lib/extraction-client";
import type { DateSource, Interpretation, ValueOperator } from "@prisma/client";

// ── Extraction shape (loose — LLM output isn't strongly typed) ──────────────
type ExtractedTest = {
  raw_test_name?: string;
  normalized_test_name?: string;
  observed_value_raw?: string | number;
  observed_value_numeric?: number | null;
  observed_value_operator?: string | null;
  observed_value_unit?: string | null;
  reference_interval_raw?: string | null;
  reference_low?: number | null;
  reference_high?: number | null;
  reference_unit?: string | null;
  interpretation?: string;
  confidence?: number;
  /** 1-indexed PDF page the row was extracted from. */
  source_page?: number | null;
};

export type ExtractionResult = {
  tests?: ExtractedTest[];
  report?: {
    report_date?: string | null;
    date_source?: string | null;
    referred_by?: string | null;
    sample_type?: string | null;
    confidence?: number;
  };
};

// ── Small mappers extracted from the old inline `map(t => ({ … }))` ────────
function mapOperator(v: string | null | undefined): ValueOperator | null {
  if (!v) return null;
  if (v === "<" || v === "LT") return "LT";
  if (v === ">" || v === "GT") return "GT";
  if (v === "=" || v === "EQ") return "EQ";
  if (v === "~" || v === "APPROX") return "APPROX";
  return null;
}

function mapInterpretation(v: string | null | undefined): Interpretation {
  const s = (v ?? "").toUpperCase();
  if (s === "LOW") return "LOW";
  if (s === "HIGH") return "HIGH";
  if (s === "NORMAL") return "NORMAL";
  return "UNKNOWN";
}

function mapDateSource(v: string | null | undefined): DateSource {
  if (v === "sample_collected") return "SAMPLE_COLLECTED";
  if (v === "report_date") return "REPORT_DATE";
  return "UNKNOWN";
}

/**
 * When `observed_value_raw` contains BOTH a value AND a trailing reference
 * range, split them so the downstream ref-range parser can work.
 *
 * Strategy: match a leading numeric value + whitespace + REST. Fire only when
 * the REST contains at least one "reference-range signal" — otherwise we'd
 * incorrectly strip trailing units like `"5.0 mg/L"`.
 *
 * Signals accepted:
 *   • Dash range           "200-239"
 *   • Operator range       "<200", ">240", "≤2", "≥5", ">=240", ">/=240"
 *   • Labeled range        "Desirable:", "Normal:", "High:", "Sufficiency:", …
 *
 * Examples that WILL split:
 *   "2.0 1.6-2.6 mg/dL"                 → "2.0" + "1.6-2.6 mg/dL"
 *   "1.49 <6.22 ng/mL U/L"              → "1.49" + "<6.22 ng/mL U/L"
 *   "1973 39-308 U/L IU/L"              → "1973" + "39-308 U/L IU/L"
 *   "229 Desirable: <200 mg/dL Borderline: 200-239 mg/dL High: >/=240 mg/dL"
 *                                       → "229" + "Desirable: <200 mg/dL Borderline: 200-239 mg/dL High: >/=240 mg/dL"
 *   "8.46 Deficiency: < 20 ng/mL Insufficiency: 20 - 30 ng/mL"
 *                                       → "8.46" + "Deficiency: < 20 ng/mL Insufficiency: 20 - 30 ng/mL"
 *
 * Examples that WON'T split (correctly):
 *   "5.0 mg/L"              → null (unit-only trailing, no ref signals)
 *   "27.64 μU/mL"           → null (unit-only)
 *   "<200 mg/dL"            → null (single operator value, no leak)
 *   "13.5"                  → null (plain numeric)
 *   "1 Trace"               → null (qualitative descriptor, no ref)
 */
function splitLeakedRange(rawValue: string): { cleanValue: string; extractedRef: string } | null {
  if (!rawValue || !rawValue.trim()) return null;

  // Split on: leading value (optional operator prefix) + whitespace + rest.
  // Use `[\s\S]+` instead of `.+` so newlines in the tail (multi-line categorical
  // ranges) are captured — no dotAll flag needed (ES2015-safe).
  const m = rawValue.match(/^([<>]?\s*\d+(?:\.\d+)?)\s+([\s\S]+)$/);
  if (!m) return null;
  const cleanValue = m[1].trim();
  const tail = m[2].trim();

  // Tail must have a reference-range signal to justify treating it as leaked.
  const hasRefSignal =
    /\d+(?:\.\d+)?\s*[-–—]\s*\d+/.test(tail)                       // dash range: "200-239"
    || /[<>]=?\s*\d/.test(tail)                                     // operator: "<200", ">/=240", ">="
    || /[≤≥]\s*\d/.test(tail)                                       // unicode operators
    || />\s*\/\s*=\s*\d/.test(tail)                                 // ">/=240" (bare-slash form)
    || /\b(?:desirable|borderline|normal|high|low|optim(?:um|al)|pre.?diabetic|diabetic|deficien(?:t|cy)|sufficien(?:t|cy)|insufficien(?:t|cy)|toxicity|acceptable|excellent|good|fair|poor|non.?diabetic)\s*:/i
      .test(tail);

  if (!hasRefSignal) return null;
  return { cleanValue, extractedRef: tail };
}

// ── Service ────────────────────────────────────────────────────────────────
export type CreateReportResult = {
  reportId: string;
  testCount: number;
  needsReview: boolean;
  warningCount: number;
};

export async function createReportFromExtraction(
  userId: string,
  uploadId: string,
  extraction: ExtractionResult,
): Promise<CreateReportResult | null> {
  const tests = extraction.tests ?? [];
  if (tests.length === 0) return null;

  // 1. Shape rows the way TestResult wants them.
  //
  // For each field where a regex/logic can derive the answer as reliably as
  // (or more reliably than) the LLM, we prefer the deterministic path.
  // Small local models are especially bad at reference-range parsing and
  // interpretation — offloading these to code brings local extraction
  // meaningfully closer to cloud quality. The LLM's own value is used only
  // as a fallback when the deterministic path can't decide.
  let overriddenNumeric = 0;
  let overriddenRange = 0;
  let overriddenInterp = 0;
  let leakedRangeSplits = 0;

  const rows = tests.map((t) => {
    let rawValueStr = String(t.observed_value_raw ?? "");
    let rawRefStr = String(t.reference_interval_raw ?? "");

    // ── Leaked-range guard ──────────────────────────────────────────────
    // Small local models sometimes stuff both the value AND the reference
    // range into `observed_value_raw`. Example from a real report:
    //   observed_value_raw:      "2.0 1.6-2.6 mg/dL"    ← Magnesium row
    //   reference_interval_raw:  "" (or wrong)
    // The splitter is conservative — only fires when the raw clearly has
    // a "<num> <num>-<num> <unit>" shape — so it's safe to run always,
    // not just when reference_interval_raw is empty.
    const leaked = splitLeakedRange(rawValueStr);
    if (leaked) {
      rawValueStr = leaked.cleanValue;
      // Only overwrite reference_interval_raw when the LLM didn't provide one.
      // If the LLM DID emit a reference, trust it — the leaked-value case is
      // often that BOTH fields have the range (redundant, not conflicting).
      if (!rawRefStr.trim()) {
        rawRefStr = leaked.extractedRef;
      }
      leakedRangeSplits++;
    }

    // ── observed value: numeric + operator ───────────────────────────────
    // Deterministic regex first (handles "<200", ">1.5", "≤40", plain numbers).
    // Fall back to LLM output only if the raw string can't be parsed.
    const detOpParse = parseOperatorFromRaw(rawValueStr);
    const numeric = detOpParse.numeric ?? t.observed_value_numeric ?? null;
    const derivedOperator =
      detOpParse.operator ?? mapOperator(t.observed_value_operator);
    if (
      detOpParse.numeric !== null
      && t.observed_value_numeric != null
      && Math.abs(detOpParse.numeric - t.observed_value_numeric) > 1e-6
    ) {
      overriddenNumeric++;
    }

    // ── reference range: low + high ──────────────────────────────────────
    // parseRefRangeFromRaw handles categorical ranges ("Normal:<5.7 |
    // Prediabetes:5.7-6.4"), simple ranges ("13.0–17.0"), operator forms
    // ("<200"), and multi-line specs. Prefer it over LLM output.
    const detRange = parseRefRangeFromRaw(rawRefStr);
    const low = detRange.low ?? t.reference_low ?? null;
    const high = detRange.high ?? t.reference_high ?? null;
    if (
      (detRange.low !== null && t.reference_low != null && Math.abs(detRange.low - t.reference_low) > 1e-6)
      || (detRange.high !== null && t.reference_high != null && Math.abs(detRange.high - t.reference_high) > 1e-6)
    ) {
      overriddenRange++;
    }

    // ── interpretation + isOutOfRange ────────────────────────────────────
    // Computed deterministically from (numeric, operator, low, high, raw
    // strings). Handles qualitative matching (Negative/Negative → NORMAL).
    // Falls back to LLM interpretation only if deterministic returns
    // UNKNOWN.
    const detInterp = computeInterpretationFromValues(
      numeric,
      derivedOperator,
      low,
      high,
      null, // lab flag not carried in extraction JSON
      rawValueStr,
      rawRefStr,
    );

    let interpretation: Interpretation;
    let isOutOfRange: boolean;
    if (detInterp.interpretation !== "UNKNOWN") {
      interpretation = detInterp.interpretation as Interpretation;
      isOutOfRange = detInterp.isOutOfRange;
      const llmInterp = mapInterpretation(t.interpretation);
      if (llmInterp !== "UNKNOWN" && llmInterp !== interpretation) overriddenInterp++;
    } else {
      interpretation = mapInterpretation(t.interpretation);
      isOutOfRange = numeric !== null && (
        (low !== null && numeric < low) || (high !== null && numeric > high)
      );
    }

    return {
      userId,
      rawTestName: t.raw_test_name ?? t.normalized_test_name ?? "Unknown",
      normalizedName: t.normalized_test_name ?? t.raw_test_name ?? "Unknown",
      observedValueRaw: rawValueStr,
      observedValueNumeric: numeric,
      observedValueOperator: derivedOperator,
      observedValueUnit: t.observed_value_unit ?? null,
      // Use the LOCAL rawRefStr (possibly updated by the leaked-range splitter)
      // rather than the raw LLM value — otherwise the persisted field stays
      // stale even after we successfully split the range out.
      referenceIntervalRaw: rawRefStr || null,
      referenceLow: low,
      referenceHigh: high,
      referenceUnit: t.reference_unit ?? null,
      interpretation,
      confidence: t.confidence ?? 0.5,
      isOutOfRange,
      // Preserve extractor-provided provenance. Layout path fills this from
      // Docling's page number; LLM path leaves it null (Zod schema optional).
      sourcePage: typeof t.source_page === "number" && t.source_page > 0 ? t.source_page : null,
    };
  });

  if (overriddenNumeric + overriddenRange + overriddenInterp + leakedRangeSplits > 0) {
    console.log(
      `[ingest] deterministic overrides — numeric=${overriddenNumeric}, range=${overriddenRange}, interpretation=${overriddenInterp}, leaked_range_split=${leakedRangeSplits}`,
    );
  }

  // 2. Attach canonical + LOINC links, log misses to UnresolvedTestName.
  const enriched = await enrichTestResults(rows, { userId });

  // 3. Look up plausibility bounds + LOINC assignment for the canonicals we
  //    matched. `hasLoinc` feeds LOINC-confidence calc; `expectedUnit`
  //    doubles as the deterministic unit-fill source below.
  const canonicalIds = Array.from(
    new Set(enriched.map((r) => r.canonicalTestId).filter((v): v is string => !!v)),
  );
  const canonicalRows = canonicalIds.length === 0
    ? []
    : await prisma.testCanonical.findMany({
        where: { id: { in: canonicalIds } },
        select: { id: true, minValue: true, maxValue: true, expectedUnit: true, loincNum: true },
      });
  const canonicalMap = new Map(
    canonicalRows.map((c) => [c.id, {
      minValue: c.minValue,
      maxValue: c.maxValue,
      expectedUnit: c.expectedUnit,
      hasLoinc: c.loincNum !== null,
    }]),
  );
  // Kept separate from canonicalMap (which is typed for the validator) so we
  // can denormalize the LOINC code onto each TestResult at create time.
  const loincByCanonical = new Map(canonicalRows.map((c) => [c.id, c.loincNum]));

  // 3b. Deterministic unit fill — for rows where the LLM couldn't recover
  //     the unit but we know the canonical unit, inject it and log
  //     `unit_inferred_from_canonical` so the review UI can surface it.
  //     Aligned with "prefer deterministic over LLM guessing".
  let unitsFilled = 0;
  const filledRows = enriched.map((r) => {
    const hasUnit = r.observedValueUnit && r.observedValueUnit.trim() !== "";
    if (hasUnit) return r;
    const canonical = r.canonicalTestId ? canonicalMap.get(r.canonicalTestId) : null;
    if (!canonical?.expectedUnit) return r;
    unitsFilled++;
    return {
      ...r,
      observedValueUnit: canonical.expectedUnit,
      _unitInferred: true as const,
    };
  });

  // 4. Deterministic validation — plausibility + unit + confidence + LOINC.
  const reportConfidence = extraction.report?.confidence ?? 0.5;
  const { validated, reportNeedsReview } = validateExtractionBatch(
    filledRows,
    canonicalMap,
    reportConfidence,
  );

  // Append the unit-inferred warning where applicable (kept out of the
  // validator so the validator stays pure — it can't tell a filled unit
  // from an original one otherwise).
  for (let i = 0; i < validated.length; i++) {
    if ((filledRows[i] as { _unitInferred?: boolean })._unitInferred) {
      validated[i].warnings = [
        ...validated[i].warnings,
        `unit_inferred_from_canonical: filled "${validated[i].observedValueUnit}"`,
      ];
    }
  }

  // Denormalize the LOINC code onto each row (from the resolved canonical).
  // Strip the transient `_unitInferred` marker — it's used above to append a
  // warning but is not a TestResult column, so Prisma rejects it on create.
  const validatedWithLoinc = validated.map((v) => {
    const { _unitInferred, ...row } = v as typeof v & { _unitInferred?: boolean };
    void _unitInferred;
    return {
      ...row,
      loincNum: row.canonicalTestId ? (loincByCanonical.get(row.canonicalTestId) ?? null) : null,
    };
  });

  const totalWarnings = validated.reduce((n, r) => n + r.warnings.length, 0);

  // Carry org attribution from the upload (set on upload-on-behalf-of) onto
  // the report, so the lab dashboard can scope its queue/analytics by org.
  const uploadRow = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: { organizationId: true },
  });

  // 5. Persist Report + TestResults, and flip Upload.status atomically.
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        userId,
        uploadId,
        organizationId: uploadRow?.organizationId ?? null,
        sampleCollectedOn: extraction.report?.report_date ? new Date(extraction.report.report_date) : null,
        dateSource: mapDateSource(extraction.report?.date_source),
        referredBy: extraction.report?.referred_by ?? null,
        sampleType: extraction.report?.sample_type ?? null,
        rawJson: JSON.parse(JSON.stringify(extraction)),
        confidence: reportConfidence,
        needsReview: reportNeedsReview,
        testResults: { create: validatedWithLoinc },
      },
      include: { _count: { select: { testResults: true } } },
    });

    await tx.upload.update({
      where: { id: uploadId },
      data: { status: reportNeedsReview ? "NEEDS_REVIEW" : "READY" },
    });

    return created;
  });

  console.log(
    `[ingest] report ${report.id} · tests=${report._count.testResults}` +
    ` · needsReview=${reportNeedsReview} · warnings=${totalWarnings}` +
    ` · unitsFilled=${unitsFilled}` +
    ` · reportConfidence=${reportConfidence.toFixed(2)} (threshold=${LAB_VALIDATOR_CONFIDENCE_THRESHOLD})`,
  );

  return {
    reportId: report.id,
    testCount: report._count.testResults,
    needsReview: reportNeedsReview,
    warningCount: totalWarnings,
  };
}
