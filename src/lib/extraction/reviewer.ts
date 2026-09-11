/**
 * Low-confidence field reviewer — the "second opinion" pass.
 *
 * After primary extraction persists a report, any TestResult below the review
 * threshold is re-checked against the source text by a stronger reviewer model
 * (Claude by default). The reviewer either confirms the value (raising its
 * confidence) or corrects it — and anything it still can't verify stays flagged
 * for the human review queue. It never touches high-confidence rows.
 *
 * Fully opt-in: no-op unless REVIEW_LOW_CONFIDENCE=true and a reviewer key is
 * set (see reviewer-provider.ts).
 */

import { prisma } from "@/lib/prisma";
import { loadAIConfig } from "@/lib/ai/config";
import { getReviewerProvider } from "@/lib/ai/reviewer-provider";
import type { Interpretation } from "@prisma/client";

const REVIEW_MAX_CONF = clamp01(Number(process.env.REVIEW_CONFIDENCE_MAX) || 0.8);
const REVIEW_MAX_ROWS = Math.max(1, Number(process.env.REVIEW_MAX_ROWS) || 30);
const SOURCE_CHAR_BUDGET = 14_000;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function interpret(value: number | null, low: number | null, high: number | null): { interpretation: Interpretation; oor: boolean } {
  if (value === null) return { interpretation: "NORMAL", oor: false };
  if (high !== null && value > high) return { interpretation: "HIGH", oor: true };
  if (low !== null && value < low) return { interpretation: "LOW", oor: true };
  return { interpretation: "NORMAL", oor: false };
}

type ReviewItem = {
  id: string;
  value?: string | number | null;
  unit?: string | null;
  confidence?: number;
  changed?: boolean;
  note?: string;
};

const SYSTEM_PROMPT = `You are a meticulous clinical laboratory data reviewer. A first-pass extractor pulled these rows from a lab report but flagged them as LOW CONFIDENCE. Your job is to verify each row against the SOURCE TEXT and correct it if the extractor got it wrong.

RULES:
1. Find each test in the source text. Report the value and unit EXACTLY as printed — do not convert units or "clean up" numbers.
2. If the extracted value/unit already matches the source, set changed=false and give it a high confidence (0.9-1.0).
3. If it's wrong, set changed=true with the corrected value/unit and your confidence.
4. If you genuinely cannot find or verify the test in the source, keep the value, set changed=false, and set confidence LOW (< 0.5) so a human reviews it.
5. Never invent a value. Never guess.
Return ONLY JSON: {"reviews":[{"id","value","unit","confidence","changed","note"}]}. Include one entry per input row, echoing its id.`;

/**
 * Re-check low-confidence results for a report. Returns how many were reviewed
 * and how many were corrected. Safe to call unconditionally — no-ops when the
 * reviewer isn't configured or there's nothing below threshold.
 */
export async function reviewLowConfidenceResults(
  userId: string,
  reportId: string,
  sourceText: string,
): Promise<{ reviewed: number; corrected: number; reviewer: string | null }> {
  const reviewer = await getReviewerProvider();
  if (!reviewer) return { reviewed: 0, corrected: 0, reviewer: null };

  const rows = await prisma.testResult.findMany({
    where: { reportId, userId, confidence: { lt: REVIEW_MAX_CONF } },
    orderBy: { confidence: "asc" },
    take: REVIEW_MAX_ROWS,
    select: {
      id: true, normalizedName: true, rawTestName: true,
      observedValueRaw: true, observedValueUnit: true, referenceIntervalRaw: true,
      referenceLow: true, referenceHigh: true, confidence: true,
    },
  });
  if (rows.length === 0) return { reviewed: 0, corrected: 0, reviewer: `${reviewer.provider_id}/${reviewer.model}` };

  const payload = rows.map((r) => ({
    id: r.id,
    test: r.normalizedName || r.rawTestName,
    extracted_value: r.observedValueRaw,
    extracted_unit: r.observedValueUnit,
    reference: r.referenceIntervalRaw,
  }));

  const userPrompt =
    `SOURCE REPORT TEXT:\n"""\n${sourceText.slice(0, SOURCE_CHAR_BUDGET)}\n"""\n\n` +
    `LOW-CONFIDENCE ROWS TO VERIFY:\n${JSON.stringify(payload, null, 2)}`;

  let reviews: ReviewItem[];
  try {
    const res = await reviewer.provider.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { format: "json", temperature: 0, num_predict: 2048 },
    );
    const parsed = JSON.parse(res.content) as { reviews?: ReviewItem[] };
    reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
  } catch (err) {
    console.warn("[reviewer] second-opinion pass failed:", err instanceof Error ? err.message : err);
    return { reviewed: 0, corrected: 0, reviewer: `${reviewer.provider_id}/${reviewer.model}` };
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  let corrected = 0;

  for (const rev of reviews) {
    const row = byId.get(rev.id);
    if (!row) continue;

    const revConf = clamp01(rev.confidence ?? row.confidence);
    const data: Record<string, unknown> = {
      // Take the max so a confirmation raises confidence but a still-uncertain
      // review can't silently inflate it below what the extractor already had.
      confidence: rev.changed ? revConf : Math.max(row.confidence, revConf),
      plausibilityFlag: `reviewed:${reviewer.provider_id.toLowerCase()}${rev.changed ? ":corrected" : ""}`,
    };

    if (rev.changed && rev.value !== undefined && rev.value !== null && String(rev.value).trim() !== "") {
      const raw = String(rev.value).trim();
      const numeric = Number(raw.replace(/[^0-9.\-]/g, ""));
      const num = Number.isFinite(numeric) && raw.match(/[0-9]/) ? numeric : null;
      const { interpretation, oor } = interpret(num, row.referenceLow, row.referenceHigh);
      data.observedValueRaw = raw;
      data.observedValueNumeric = num;
      data.interpretation = interpretation;
      data.isOutOfRange = oor;
      if (rev.unit !== undefined && rev.unit !== null && String(rev.unit).trim() !== "") {
        data.observedValueUnit = String(rev.unit).trim();
      }
      corrected++;
    }

    await prisma.testResult.update({ where: { id: row.id }, data });
  }

  // Recompute the report's needs-review flag against the post-review confidences.
  const cfg = loadAIConfig();
  const stillLow = await prisma.testResult.count({
    where: { reportId, userId, confidence: { lt: cfg.requireReviewBelowConfidence } },
  });
  await prisma.report.update({
    where: { id: reportId },
    data: { needsReview: stillLow > 0 },
  });

  console.log(`[reviewer] ${reviewer.provider_id}/${reviewer.model}: reviewed ${rows.length}, corrected ${corrected}, still-low ${stillLow}`);
  return { reviewed: rows.length, corrected, reviewer: `${reviewer.provider_id}/${reviewer.model}` };
}
