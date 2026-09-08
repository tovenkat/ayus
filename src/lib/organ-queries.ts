/**
 * Organ-view queries — group a user's TestResult history by OrganSystem so the
 * dashboard can render per-organ panels.
 *
 * Requires TestResult.canonicalTestId to be populated (extraction pipeline
 * hooked via enrichTestResults; historical data via `npm run biomarkers:backfill`).
 * Results without canonicalTestId are excluded from the organ view — they'd
 * skew the "no data yet" story for organs whose biomarkers just haven't been
 * curated into TestSynonym yet.
 */

import { prisma } from "@/lib/prisma";
import type { Interpretation } from "@prisma/client";

export type OrganPanelResult = {
  canonicalId: string;
  canonicalName: string;
  category: string | null;
  latest: {
    resultId: string;
    reportId: string;
    loincNum: string | null;
    valueRaw: string;
    valueNumeric: number | null;
    unit: string | null;
    referenceLow: number | null;
    referenceHigh: number | null;
    referenceUnit: string | null;
    interpretation: Interpretation;
    isOutOfRange: boolean;
    sampleCollectedOn: Date | null;
  };
  history: Array<{
    date: Date | null;
    valueNumeric: number | null;
    valueRaw: string;
    isOutOfRange: boolean;
  }>;
};

export type OrganPanel = {
  key: string;             // e.g. "kidney"
  name: string;            // e.g. "Kidney"
  icon: string;
  svgRegionId: string;
  results: OrganPanelResult[];
  outOfRangeCount: number; // number of canonical tests whose latest is abnormal
};

export async function getOrganPanels(userId: string): Promise<OrganPanel[]> {
  // Pull organs and their canonical tests up front; small, cacheable.
  const organs = await prisma.organSystem.findMany({
    include: {
      tests: {
        include: {
          canonicalTest: { select: { id: true, name: true, category: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // For this user, get every TestResult with a canonical link — one query.
  const rows = await prisma.testResult.findMany({
    where: { userId, canonicalTestId: { not: null } },
    include: {
      report: { select: { sampleCollectedOn: true, createdAt: true } },
    },
    orderBy: [
      { report: { sampleCollectedOn: "desc" } },
      { createdAt: "desc" },
    ],
  });

  // Group by canonicalTestId → list of results (newest first).
  const byCanonical = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.canonicalTestId) continue;
    const list = byCanonical.get(r.canonicalTestId);
    if (list) list.push(r);
    else byCanonical.set(r.canonicalTestId, [r]);
  }

  const panels: OrganPanel[] = organs.map((organ) => {
    const results: OrganPanelResult[] = [];
    let outOfRangeCount = 0;

    for (const link of organ.tests) {
      const canonical = link.canonicalTest;
      const history = byCanonical.get(canonical.id);
      if (!history || history.length === 0) continue;

      const latest = history[0];
      if (latest.isOutOfRange) outOfRangeCount++;

      results.push({
        canonicalId: canonical.id,
        canonicalName: canonical.name,
        category: canonical.category,
        latest: {
          resultId: latest.id,
          reportId: latest.reportId,
          loincNum: latest.loincNum,
          valueRaw: latest.observedValueRaw,
          valueNumeric: latest.observedValueNumeric,
          unit: latest.observedValueUnit,
          referenceLow: latest.referenceLow,
          referenceHigh: latest.referenceHigh,
          referenceUnit: latest.referenceUnit,
          interpretation: latest.interpretation,
          isOutOfRange: latest.isOutOfRange,
          sampleCollectedOn: latest.report.sampleCollectedOn,
        },
        history: history.slice(0, 12).map((h) => ({
          date: h.report.sampleCollectedOn ?? h.report.createdAt,
          valueNumeric: h.observedValueNumeric,
          valueRaw: h.observedValueRaw,
          isOutOfRange: h.isOutOfRange,
        })),
      });
    }

    // Sort within a panel: out-of-range first, then by canonical name.
    results.sort((a, b) => {
      if (a.latest.isOutOfRange !== b.latest.isOutOfRange) {
        return a.latest.isOutOfRange ? -1 : 1;
      }
      return a.canonicalName.localeCompare(b.canonicalName);
    });

    return {
      key: organ.key,
      name: organ.name,
      icon: organ.icon,
      svgRegionId: organ.svgRegionId,
      results,
      outOfRangeCount,
    };
  });

  // Only return organs that have at least one result — the dashboard shouldn't
  // render empty panels.
  return panels.filter((p) => p.results.length > 0);
}
