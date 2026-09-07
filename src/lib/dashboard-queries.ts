import { prisma } from "@/lib/prisma";
import { computeTrend, type TrendResult, type TrendDataPoint } from "@/lib/trends";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChartPoint {
  date: string;
  value: number;
  isOutOfRange: boolean;
  referenceLow: number | null;
  referenceHigh: number | null;
}

export interface TestSummary {
  normalizedName: string;
  category: string | null;
  unit: string | null;
  latestValue: number;
  latestDate: string;
  isOutOfRange: boolean;
  trend: TrendResult;
  chartData: ChartPoint[];
  referenceLow: number | null;
  referenceHigh: number | null;
}

export interface RecentReport {
  id: string;
  sampleCollectedOn: string | null;
  referredBy: string | null;
  testCount: number;
  outOfRangeCount: number;
  improvingCount: number;
  worseningCount: number;
  stableCount: number;
}

export interface StatusTimelinePoint {
  date: string;
  outOfRange: number;
  improving: number;
  worsening: number;
  stable: number;
}

export interface DashboardData {
  tests: TestSummary[];
  summary: {
    outOfRange: string[];
    improving: string[];
    worsening: string[];
    stable: string[];
  };
  recentReports: RecentReport[];
  statusTimeline: StatusTimelinePoint[];
  categories: string[];
}

export interface DashboardOptions {
  range: string;
  from?: string;
  to?: string;
  category?: string;
  abnormalOnly: boolean;
  worseningOnly: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function deduplicateByDate<
  T extends { confidence: number; createdAt: Date; report: { sampleCollectedOn: Date | null } },
>(results: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of results) {
    const dateKey = (r.report.sampleCollectedOn ?? r.createdAt).toISOString().slice(0, 10);
    const existing = seen.get(dateKey);
    if (!existing || r.confidence > existing.confidence) {
      seen.set(dateKey, r);
    }
  }
  return results.filter((r) => {
    const dateKey = (r.report.sampleCollectedOn ?? r.createdAt).toISOString().slice(0, 10);
    return seen.get(dateKey) === r;
  });
}

function computeDateRange(range: string, from?: string, to?: string): { start: Date | null; end: Date | null } {
  const now = new Date();
  switch (range) {
    case "30": return { start: new Date(now.getTime() - 30 * 86400000), end: null };
    case "90": return { start: new Date(now.getTime() - 90 * 86400000), end: null };
    case "365": return { start: new Date(now.getTime() - 365 * 86400000), end: null };
    case "custom": return { start: from ? new Date(from) : null, end: to ? new Date(to) : null };
    default: return { start: null, end: null };
  }
}

// ─── Main Query ──────────────────────────────────────────────────────────────

export async function buildDashboardData(
  userId: string,
  options: DashboardOptions
): Promise<DashboardData> {
  const { start, end } = computeDateRange(options.range, options.from, options.to);

  const dateFilter: Record<string, Date> = {};
  if (start) dateFilter.gte = start;
  if (end) dateFilter.lte = end;

  // Look up category filter from TestCanonical
  let categoryNames: string[] | null = null;
  if (options.category) {
    const canonicals = await prisma.testCanonical.findMany({
      where: { category: options.category },
      select: { name: true },
    });
    categoryNames = canonicals.map((c) => c.name);
  }

  const results = await prisma.testResult.findMany({
    where: {
      userId,
      ...(Object.keys(dateFilter).length > 0 && {
        report: { sampleCollectedOn: dateFilter },
      }),
      ...(categoryNames && { normalizedName: { in: categoryNames } }),
    },
    include: {
      report: { select: { sampleCollectedOn: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by normalizedName
  const grouped = new Map<string, typeof results>();
  for (const r of results) {
    const key = r.normalizedName;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  // Look up categories
  const allNames = [...grouped.keys()];
  const canonicals = allNames.length > 0
    ? await prisma.testCanonical.findMany({
        where: { name: { in: allNames } },
        select: { name: true, category: true },
      })
    : [];
  const categoryMap = new Map(canonicals.map((c) => [c.name, c.category]));

  // Build per-test summaries
  const tests: TestSummary[] = [];
  const summary = {
    outOfRange: [] as string[],
    improving: [] as string[],
    worsening: [] as string[],
    stable: [] as string[],
  };

  for (const [name, rawResults] of grouped) {
    rawResults.sort((a, b) => {
      const da = (a.report.sampleCollectedOn ?? a.createdAt).getTime();
      const db = (b.report.sampleCollectedOn ?? b.createdAt).getTime();
      return da - db;
    });

    const testResults = deduplicateByDate(rawResults);

    const trendPoints: TrendDataPoint[] = testResults.map((r) => ({
      observedValueNumeric: r.observedValueNumeric,
      referenceLow: r.referenceLow,
      referenceHigh: r.referenceHigh,
      isOutOfRange: r.isOutOfRange,
    }));

    const trend = computeTrend(trendPoints);
    if (!trend) continue;

    const latest = testResults[testResults.length - 1];
    const chartData: ChartPoint[] = testResults
      .filter((r) => r.observedValueNumeric !== null)
      .map((r) => ({
        date: (r.report.sampleCollectedOn ?? r.createdAt).toISOString(),
        value: r.observedValueNumeric!,
        isOutOfRange: r.isOutOfRange,
        referenceLow: r.referenceLow,
        referenceHigh: r.referenceHigh,
      }));

    const testSummary: TestSummary = {
      normalizedName: name,
      category: categoryMap.get(name) ?? null,
      unit: latest.observedValueUnit,
      latestValue: trend.latestValue,
      latestDate: (latest.report.sampleCollectedOn ?? latest.createdAt).toISOString(),
      isOutOfRange: latest.isOutOfRange,
      trend,
      chartData,
      referenceLow: latest.referenceLow,
      referenceHigh: latest.referenceHigh,
    };

    if (latest.isOutOfRange) summary.outOfRange.push(name);
    if (trend.status === "improving") summary.improving.push(name);
    else if (trend.status === "worsening") summary.worsening.push(name);
    else summary.stable.push(name);

    tests.push(testSummary);
  }

  let filteredTests = tests;
  if (options.abnormalOnly) {
    filteredTests = filteredTests.filter((t) => t.isOutOfRange || t.trend.status === "worsening");
  }
  if (options.worseningOnly) {
    filteredTests = filteredTests.filter((t) => t.trend.status === "worsening");
  }

  // Trend lookup for report stats
  const trendLookup = new Map<string, string>();
  for (const t of tests) trendLookup.set(t.normalizedName, t.trend.status);

  // Recent reports
  const allReports = await prisma.report.findMany({
    where: { userId },
    include: {
      _count: { select: { testResults: true } },
      testResults: { select: { normalizedName: true, isOutOfRange: true } },
    },
    orderBy: { sampleCollectedOn: "desc" },
  });

  function computeReportStats(r: (typeof allReports)[number]) {
    let improvingCount = 0, worseningCount = 0, stableCount = 0, outOfRangeCount = 0;
    const seen = new Set<string>();
    for (const tr of r.testResults) {
      if (seen.has(tr.normalizedName)) continue;
      seen.add(tr.normalizedName);
      if (tr.isOutOfRange) outOfRangeCount++;
      const status = trendLookup.get(tr.normalizedName);
      if (status === "improving") improvingCount++;
      else if (status === "worsening") worseningCount++;
      else stableCount++;
    }
    return { outOfRangeCount, improvingCount, worseningCount, stableCount };
  }

  const recentReports: RecentReport[] = allReports.slice(0, 5).map((r) => {
    const stats = computeReportStats(r);
    return {
      id: r.id,
      sampleCollectedOn: r.sampleCollectedOn?.toISOString() ?? null,
      referredBy: r.referredBy,
      testCount: r._count.testResults,
      ...stats,
    };
  });

  const statusTimeline: StatusTimelinePoint[] = [...allReports]
    .reverse()
    .filter((r) => r.sampleCollectedOn)
    .map((r) => {
      const stats = computeReportStats(r);
      return {
        date: r.sampleCollectedOn!.toISOString(),
        outOfRange: stats.outOfRangeCount,
        improving: stats.improvingCount,
        worsening: stats.worseningCount,
        stable: stats.stableCount,
      };
    });

  // Distinct categories
  const allCats = await prisma.testCanonical.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
  });
  const categories = allCats.map((c) => c.category!).filter(Boolean).sort();

  return { tests: filteredTests, summary, recentReports, statusTimeline, categories };
}
