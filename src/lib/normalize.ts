import { prisma } from "@/lib/prisma";
import {
  parseOperator,
  parseReferenceRange,
  computeInterpretation,
} from "@/lib/extraction-client";
import { standardizeTestName, registerSynonym, aiStandardizeUnmatched } from "@/lib/standardize";
import { detectTestNegation } from "@/lib/negation";
import { findLoincForTestName, isLoincAvailable } from "@/lib/loinc";
import { mapValueToSnomedConcept } from "@/lib/snomed";
import { validateTestResult, type ValidationStatus, type ValidationIssue } from "@/lib/validation";
import type { ChatProvider } from "@/lib/ai/types";

// ─── Numeric parsing with edge-case handling ────────────────────────────────

/**
 * Parse a raw value string into a number, handling commas as thousands
 * separators, whitespace, and operator prefixes.
 */
export function parseNumericValue(raw: string): number | null {
  if (!raw || !raw.trim()) return null;

  // Strip operator prefix if present
  let cleaned = raw.trim();
  if (/^[<>~≈=]/.test(cleaned)) {
    cleaned = cleaned.slice(1).trim();
  }

  // Remove commas and spaces used as thousands separators (e.g. "1,200" or "1 200")
  cleaned = cleaned.replace(/,/g, "").replace(/\s/g, "");

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Synonym map loader ─────────────────────────────────────────────────────

export async function loadSynonymMap(): Promise<Map<string, string>> {
  // phr2 doesn't have TestNameMap — return empty map
  return new Map<string, string>();
}

// ─── LLM response types (matches the extraction prompt schema) ──────────────

export type LlmRawReport = {
  report_date?: string | null;
  date_source?: string | null;
  referred_by?: string | null;
  sample_type?: string | null;
  confidence?: number;
};

export type LlmRawTest = {
  raw_test_name?: string;
  normalized_test_name?: string;
  observed_value_raw?: string;
  observed_value_numeric?: number | null;
  observed_value_operator?: string | null;
  observed_value_unit?: string | null;
  reference_interval_raw?: string | null;
  reference_low?: number | null;
  reference_high?: number | null;
  reference_unit?: string | null;
  interpretation?: string;
  confidence?: number;
  /** 1-indexed source PDF page. Populated by layout path; nullable when unknown. */
  source_page?: number | null;
};

export type LlmExtractionResult = {
  report?: LlmRawReport;
  tests?: LlmRawTest[];
  warnings?: string[];
};

// ─── Normalized output types ────────────────────────────────────────────────

export type NormalizedTestResult = {
  rawTestName: string;
  normalizedName: string;
  observedValueRaw: string;
  observedValueNumeric: number | null;
  observedValueOperator: "LT" | "GT" | "EQ" | "APPROX" | null;
  observedValueUnit: string;
  referenceIntervalRaw: string;
  referenceLow: number | null;
  referenceHigh: number | null;
  referenceUnit: string;
  interpretation: "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";
  isOutOfRange: boolean;
  confidence: number;
  /** Clinical negation — true when the finding is explicitly absent/denied */
  isNegated: boolean;
  /** LOINC code resolved for this test (e.g. "2345-7") */
  loincCode: string | null;
  /** SNOMED CT concept ID for qualitative result value */
  snomedValueCode: string | null;
  /** Stage 6 validation status */
  validationStatus: ValidationStatus;
  /** Stage 6 validation issues */
  validationIssues: ValidationIssue[];
};

export type NormalizedReport = {
  sampleCollectedOn: string;
  dateSource: "SAMPLE_COLLECTED" | "REPORT_DATE" | "UNKNOWN";
  referredBy: string;
  sampleType: string;
  confidence: number;
  tests: NormalizedTestResult[];
  warnings: string[];
};

// ─── Operator mapping ───────────────────────────────────────────────────────

const OPERATOR_MAP: Record<string, "LT" | "GT" | "EQ" | "APPROX"> = {
  "<": "LT",
  ">": "GT",
  "=": "EQ",
  "~": "APPROX",
};

const DATE_SOURCE_MAP: Record<string, "SAMPLE_COLLECTED" | "REPORT_DATE" | "UNKNOWN"> = {
  sample_collected: "SAMPLE_COLLECTED",
  report_date: "REPORT_DATE",
  unknown: "UNKNOWN",
};

// ─── Normalization ──────────────────────────────────────────────────────────

// Cached flag so we only check LOINC availability once per normalize call
let _loincAvailableCache: boolean | null = null;
async function checkLoincAvailable(): Promise<boolean> {
  if (_loincAvailableCache !== null) return _loincAvailableCache;
  _loincAvailableCache = await isLoincAvailable();
  return _loincAvailableCache;
}

export async function normalizeTests(
  rawTests: LlmRawTest[],
  synonymMap: Map<string, string>
): Promise<NormalizedTestResult[]> {
  const loincEnabled = await checkLoincAvailable();

  return Promise.all(rawTests.map(async (t) => {
    const rawName = t.raw_test_name ?? "";
    const llmNormalized = t.normalized_test_name ?? rawName;

    // Fast path: exact synonym lookup (preserves current behavior)
    let normalizedName =
      synonymMap.get(llmNormalized.toLowerCase()) ??
      synonymMap.get(rawName.toLowerCase());

    // Fuzzy fallback: use standardization module when no exact match
    if (!normalizedName) {
      const result = await standardizeTestName(rawName, llmNormalized);
      normalizedName = result.canonicalName;
      // Auto-learn: register high-confidence fuzzy matches as synonyms
      if (result.confidence >= 0.85 && result.matchType.startsWith("fuzzy")) {
        registerSynonym(rawName, result.canonicalName).catch(() => {});
      }
    }

    // Parse operator and numeric from the raw value string
    const rawValue = t.observed_value_raw ?? "";
    const { operator: parsedOp, numeric: parsedNum } = parseOperator(rawValue);

    // Use our parsed numeric, fall back to LLM-provided numeric
    const finalNumeric = parsedNum ?? t.observed_value_numeric ?? null;

    // Map operator: prefer our parsed operator, fall back to LLM's
    const finalOperator =
      parsedOp ??
      (t.observed_value_operator
        ? OPERATOR_MAP[t.observed_value_operator] ?? null
        : null);

    // Parse reference range
    const refRaw = t.reference_interval_raw ?? "";
    const { low: parsedLow, high: parsedHigh } = parseReferenceRange(refRaw);
    const finalLow = parsedLow ?? t.reference_low ?? null;
    const finalHigh = parsedHigh ?? t.reference_high ?? null;

    // Recompute interpretation from numeric data (lab flag = null in this path)
    const { interpretation, isOutOfRange } = computeInterpretation(
      finalNumeric,
      finalOperator,
      finalLow,
      finalHigh,
      null,
      rawValue,
      refRaw
    );

    // ── Clinical negation detection ──────────────────────────────────────────
    const { isNegated } = detectTestNegation({
      testName: normalizedName,
      observedValue: rawValue,
      referenceInterval: refRaw,
    });

    // ── LOINC enrichment (non-blocking, best-effort) ─────────────────────────
    let loincCode: string | null = null;
    if (loincEnabled) {
      try {
        const loincMatch = await findLoincForTestName(normalizedName);
        if (loincMatch) loincCode = loincMatch.loincNum;
      } catch {
        // LOINC lookup is optional — silently skip on error
      }
    }

    // ── SNOMED CT value code (for qualitative results) ───────────────────────
    let snomedValueCode: string | null = null;
    if (finalNumeric === null && rawValue.trim()) {
      try {
        snomedValueCode = await mapValueToSnomedConcept(rawValue.trim());
      } catch {
        // SNOMED lookup is optional — silently skip on error
      }
    }

    // ── Stage 6: Validation engine ───────────────────────────────────────────
    const confidence = t.confidence ?? 0.5;
    const validationResult = validateTestResult({
      normalizedName,
      observedValueRaw: rawValue,
      observedValueNumeric: finalNumeric,
      observedValueUnit: t.observed_value_unit ?? "",
      referenceIntervalRaw: refRaw,
      referenceLow: finalLow,
      referenceHigh: finalHigh,
      interpretation,
      isOutOfRange,
      confidence,
    });

    return {
      rawTestName: rawName,
      normalizedName,
      observedValueRaw: rawValue,
      observedValueNumeric: finalNumeric,
      observedValueOperator: finalOperator,
      observedValueUnit: t.observed_value_unit ?? "",
      referenceIntervalRaw: refRaw,
      referenceLow: finalLow,
      referenceHigh: finalHigh,
      referenceUnit: t.reference_unit ?? "",
      interpretation,
      isOutOfRange,
      confidence,
      isNegated,
      loincCode,
      snomedValueCode,
      validationStatus: validationResult.status,
      validationIssues: validationResult.issues,
    };
  }));
}

// ─── AI re-interpretation for UNKNOWN status ────────────────────────────────

export async function aiReinterpretUnknowns(
  tests: NormalizedTestResult[],
  provider: ChatProvider
): Promise<void> {
  const unknowns = tests
    .map((t, i) => ({ ...t, index: i }))
    .filter((t) => t.interpretation === "UNKNOWN" && t.observedValueRaw.trim() !== "");

  if (unknowns.length === 0) return;

  const testList = unknowns
    .map((t) =>
      `- test: "${t.normalizedName}", value: "${t.observedValueRaw}" ${t.observedValueUnit}, reference: "${t.referenceIntervalRaw}"`
    )
    .join("\n");

  const prompt = `You are a clinical lab result interpreter.

For each test below, determine the interpretation status based on the observed value and reference range.

Rules:
- If the value matches or falls within the normal/expected reference range → "NORMAL"
- If the value is below the normal range → "LOW"
- If the value is above the normal range → "HIGH"
- For qualitative tests: if the value matches the expected reference (e.g. Negative/Negative, Non-Reactive/Non-Reactive) → "NORMAL"
- For qualitative tests: if the value does NOT match the expected reference (e.g. Positive when Negative expected) → "HIGH"
- Only use "UNKNOWN" if you truly cannot determine the status

TESTS TO INTERPRET:
${testList}

Respond with ONLY a JSON array. No markdown, no explanation:
[{"test_name": "...", "interpretation": "LOW"|"NORMAL"|"HIGH"|"UNKNOWN", "is_out_of_range": true|false}]`;

  try {
    const response = await provider.chat(
      [{ role: "user", content: prompt }],
      { format: "json", temperature: 0 }
    );

    let results: { test_name: string; interpretation: string; is_out_of_range: boolean }[];
    try {
      const parsed = JSON.parse(response.content);
      results = Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn("[normalize] AI reinterpretation response was not valid JSON");
      return;
    }

    const VALID_INTERPRETATIONS = new Set(["LOW", "NORMAL", "HIGH"]);

    for (const result of results) {
      const interp = result.interpretation?.toUpperCase();
      if (!VALID_INTERPRETATIONS.has(interp)) continue;

      const entry = unknowns.find((u) => u.normalizedName === result.test_name);
      if (!entry) continue;

      tests[entry.index].interpretation = interp as "LOW" | "NORMAL" | "HIGH";
      tests[entry.index].isOutOfRange = result.is_out_of_range ?? (interp !== "NORMAL");

      console.log(
        `[normalize] AI interpreted "${entry.normalizedName}": ${entry.observedValueRaw} → ${interp}`
      );
    }
  } catch (err) {
    console.warn("[normalize] AI reinterpretation failed:", err instanceof Error ? err.message : err);
  }
}

export async function normalizeReport(
  raw: LlmExtractionResult,
  synonymMap: Map<string, string>,
  /** Optional: pass an AI provider to enable dynamic standardization and reinterpretation */
  aiProvider?: ChatProvider
): Promise<NormalizedReport> {
  const report = raw.report ?? {};
  const tests = await normalizeTests(raw.tests ?? [], synonymMap);

  if (aiProvider) {
    // Dynamic AI standardization for tests that couldn't be matched
    try {
      await aiStandardizeUnmatched(tests, aiProvider);
    } catch (err) {
      console.warn("[normalize] AI standardization skipped:", err instanceof Error ? err.message : err);
    }

    // AI re-interpretation for tests with UNKNOWN status
    try {
      await aiReinterpretUnknowns(tests, aiProvider);
    } catch (err) {
      console.warn("[normalize] AI reinterpretation skipped:", err instanceof Error ? err.message : err);
    }
  }

  return {
    sampleCollectedOn: report.report_date ?? "",
    dateSource: DATE_SOURCE_MAP[report.date_source ?? ""] ?? "UNKNOWN",
    referredBy: report.referred_by ?? "",
    sampleType: report.sample_type ?? "",
    confidence: report.confidence ?? (tests.length > 0 ? 0.7 : 0),
    tests,
    warnings: raw.warnings ?? [],
  };
}
