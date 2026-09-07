/**
 * Enrich a batch of extracted lab tests with canonical + organ links before
 * they are persisted via prisma.report.create({ testResults: { create: ... }}).
 *
 * For each test:
 *   1. Try resolveBiomarker(rawTestName || normalizedName) → canonicalTestId
 *   2. On miss, log to UnresolvedTestName so we can curate the synonym later
 *
 * Callers (upload/route.ts, extract/route.ts) map extractionResult.tests → the
 * TestResult create shape. Pipe the create rows through this helper first.
 */

import { resolveBiomarkers, logUnresolvedTestName } from "./biomarker-resolver";

type WithNames = { rawTestName: string; normalizedName: string };

export async function enrichTestResults<T extends WithNames>(
  rows: T[],
  ctx: { userId: string; reportId?: string } = { userId: "" },
): Promise<Array<T & { canonicalTestId: string | null }>> {
  if (rows.length === 0) return [];

  // Try rawTestName first; if it misses, fall back to normalizedName. Batch
  // both lookups in a single cache load.
  const allCandidates = Array.from(
    new Set(rows.flatMap((r) => [r.rawTestName, r.normalizedName].filter(Boolean))),
  );
  const resolved = await resolveBiomarkers(allCandidates);

  const enriched = rows.map((r) => {
    const primary = resolved.get(r.rawTestName);
    const fallback = primary ?? resolved.get(r.normalizedName) ?? null;
    return { ...r, canonicalTestId: fallback?.canonicalId ?? null };
  });

  // Log misses (deduped by raw name — no reason to log the same name multiple
  // times per report; the seenCount increment handles the "seen it again" story
  // across uploads).
  const missed = new Set<string>();
  for (const r of rows) {
    if (
      !resolved.get(r.rawTestName)?.canonicalId
      && !resolved.get(r.normalizedName)?.canonicalId
    ) {
      const key = r.rawTestName || r.normalizedName;
      if (key && !missed.has(key)) {
        missed.add(key);
        await logUnresolvedTestName(key, ctx);
      }
    }
  }

  return enriched;
}
