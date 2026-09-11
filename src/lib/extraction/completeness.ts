/**
 * Extraction completeness safeguard.
 *
 * LLM extraction of long reports occasionally drops tests — most often on the
 * last pages (a single-pass native read is prone to tail-omission). This runs a
 * focused second pass: given the full source text and the names already
 * extracted, it asks the model for any tests that appear in the source but were
 * MISSED, and merges them into the result BEFORE persistence — so the recovered
 * rows get the same canonical/LOINC/validation enrichment as the rest.
 *
 * Model-agnostic: it re-checks against pdf-parse text (all pages), so it catches
 * omissions whether the primary extractor used the native-PDF or chunked path.
 *
 * Opt-in: no-op unless EXTRACTION_COMPLETENESS_CHECK=true. Adds one extra LLM
 * call per upload, so it's a deliberate accuracy-for-cost trade.
 */

import type { LlmExtractionResult, LlmRawTest } from "@/lib/normalize";

const SOURCE_CHAR_BUDGET = 60_000;
const MIN_SOURCE_CHARS = 200;

const SYSTEM_PROMPT = `You are a lab-report completeness auditor for Indian diagnostic reports. You are given the SOURCE TEXT of a report and a list of test names ALREADY EXTRACTED. Find every numeric lab test that appears in the SOURCE but is MISSING from the extracted list — long reports commonly drop tests on the last pages.

RULES:
1. Return ONLY the MISSING tests — never repeat one already in the list.
2. Copy the value, unit, and reference range EXACTLY as printed. Never invent a test or value not in the source.
3. If nothing is missing, return {"tests":[]}.
Return ONLY JSON: {"tests":[{"raw_test_name","observed_value_raw","observed_value_unit","reference_interval_raw","interpretation","confidence"}]}.`;

function nameOf(t: LlmRawTest): string {
  return (t.raw_test_name ?? t.normalized_test_name ?? "").trim();
}

/**
 * Append any source-present-but-missing tests to `result.tests` in place.
 * Returns the recovered names (empty when disabled or nothing missing).
 */
export async function completeExtraction(
  userId: string,
  sourceText: string,
  result: LlmExtractionResult,
): Promise<{ added: number; names: string[] }> {
  if ((process.env.EXTRACTION_COMPLETENESS_CHECK ?? "").toLowerCase() !== "true") {
    return { added: 0, names: [] };
  }
  if (!sourceText || sourceText.trim().length < MIN_SOURCE_CHARS) return { added: 0, names: [] };

  const tests = result.tests ?? [];
  const existing = tests.map(nameOf).filter(Boolean);
  const seen = new Set(existing.map((s) => s.toLowerCase()));

  const userPrompt =
    `ALREADY EXTRACTED (${existing.length} tests):\n${existing.join(", ") || "(none)"}\n\n` +
    `SOURCE TEXT:\n"""\n${sourceText.slice(0, SOURCE_CHAR_BUDGET)}\n"""`;

  const added: LlmRawTest[] = [];
  try {
    const { getProviderForUser } = await import("@/lib/ai/user-provider");
    const { provider } = await getProviderForUser(userId, "extract");
    const res = await provider.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { format: "json", temperature: 0, num_predict: 4096, num_ctx: 32768 },
    );
    const parsed = JSON.parse(res.content) as { tests?: LlmRawTest[] };
    const candidates = Array.isArray(parsed.tests) ? parsed.tests : [];

    for (const t of candidates) {
      const name = nameOf(t);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue; // not actually new
      const val = t.observed_value_raw;
      if (val === undefined || val === null || String(val).trim() === "") continue; // no value → skip
      seen.add(key);
      added.push({ ...t, confidence: t.confidence ?? 0.6 }); // slightly-lower default: it was a recovery
    }
  } catch (err) {
    console.warn("[completeness] pass failed:", err instanceof Error ? err.message : err);
    return { added: 0, names: [] };
  }

  if (added.length > 0) {
    result.tests = [...tests, ...added];
    (result.warnings ??= []).push(`completeness: recovered ${added.length} missing test(s)`);
  }
  const names = added.map(nameOf);
  if (added.length > 0) console.log(`[completeness] recovered ${added.length}: ${names.join(", ")}`);
  return { added: added.length, names };
}
