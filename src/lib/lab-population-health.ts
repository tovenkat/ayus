/**
 * Phase 2 population rollups for the lab's CONSENTED ROSTER.
 *
 * Rolls the existing PER-PATIENT clinical logic up to the cohort:
 *   - Risk stratification  ← risk-assessment.buildRiskSummary (per patient)
 *   - Organ distribution   ← organ-queries.getOrganPanels (per patient)
 *   - Trend distribution   ← objective distance-to-reference over last 2 points
 *
 * Scaling note: risk/organ rollups call the per-patient functions once each,
 * so this is O(roster). Fine for a consented roster; at population scale these
 * should be materialized (a nightly job writing a PatientHealthSnapshot).
 *
 * Decision support, not diagnosis. Server-only (Prisma).
 */

import { prisma } from "@/lib/prisma";
import { buildRiskSummary, type RiskLevel } from "@/lib/risk-assessment";
import { getOrganPanels } from "@/lib/organ-queries";

async function getRosterPatientIds(orgId: string): Promise<string[]> {
  const links = await prisma.patientLink.findMany({
    where: { organizationId: orgId, status: "GRANTED" },
    select: { patientId: true },
  });
  return links.map((l) => l.patientId);
}

/** Run an async mapper over items with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ─── Risk stratification ─────────────────────────────────────────────────────

export type RiskBucket = "low" | "moderate" | "high" | "critical";
export type RiskStratification = {
  total: number;
  counts: Record<RiskBucket, number>;
};

const RISK_MAP: Record<RiskLevel, RiskBucket> = {
  LOW: "low", MEDIUM: "moderate", HIGH: "high", SUPER: "critical",
};

export async function getRiskStratification(orgId: string): Promise<RiskStratification> {
  const ids = await getRosterPatientIds(orgId);
  const counts: Record<RiskBucket, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
  if (ids.length === 0) return { total: 0, counts };

  const summaries = await mapLimit(ids, 8, (id) => buildRiskSummary(id));
  let total = 0;
  for (const s of summaries) {
    if (s.totalBiomarkers === 0) continue; // no data → not classifiable
    counts[RISK_MAP[s.overall]]++;
    total++;
  }
  return { total, counts };
}

// ─── Organ health distribution ──────────────────────────────────────────────

export type OrganDist = {
  key: string;
  name: string;
  icon: string;
  healthy: number;
  watch: number;
  needsReview: number;
  total: number;
};

export async function getOrganDistribution(orgId: string): Promise<OrganDist[]> {
  const ids = await getRosterPatientIds(orgId);
  if (ids.length === 0) return [];

  const panelsPerPatient = await mapLimit(ids, 8, (id) => getOrganPanels(id));

  const byOrgan = new Map<string, OrganDist>();
  for (const panels of panelsPerPatient) {
    for (const p of panels) {
      const d = byOrgan.get(p.key) ?? { key: p.key, name: p.name, icon: p.icon, healthy: 0, watch: 0, needsReview: 0, total: 0 };
      // Per-patient organ status from that organ's abnormal-marker count.
      if (p.outOfRangeCount === 0) d.healthy++;
      else if (p.outOfRangeCount === 1) d.watch++;
      else d.needsReview++;
      d.total++;
      byOrgan.set(p.key, d);
    }
  }
  // Most-concerning organs first (highest needs-review share).
  return [...byOrgan.values()].sort(
    (a, b) => (b.needsReview + b.watch) / b.total - (a.needsReview + a.watch) / a.total,
  );
}

// ─── Trend distribution ─────────────────────────────────────────────────────

export type TrendDist = { improving: number; stable: number; declining: number; total: number };

/** Distance a value sits OUTSIDE its reference range (0 when in range). */
function distanceOutside(value: number, low: number | null, high: number | null): number {
  if (low !== null && value < low) return low - value;
  if (high !== null && value > high) return value - high;
  return 0;
}

/**
 * Patient-level trend: for each biomarker with ≥2 numeric points and a
 * reference range, compare how far outside range the latest vs previous value
 * sits. Net improving/worsening biomarkers → patient direction. Objective
 * (uses reference bounds), so it holds for both high-bad and low-bad markers.
 */
export async function getTrendDistribution(orgId: string): Promise<TrendDist> {
  const ids = await getRosterPatientIds(orgId);
  const dist: TrendDist = { improving: 0, stable: 0, declining: 0, total: 0 };
  if (ids.length === 0) return dist;

  const rows = await prisma.testResult.findMany({
    where: {
      userId: { in: ids },
      canonicalTestId: { not: null },
      observedValueNumeric: { not: null },
      OR: [{ referenceLow: { not: null } }, { referenceHigh: { not: null } }],
    },
    orderBy: [{ userId: "asc" }, { canonicalTestId: "asc" }, { report: { sampleCollectedOn: "desc" } }, { createdAt: "desc" }],
    select: {
      userId: true, canonicalTestId: true, observedValueNumeric: true,
      referenceLow: true, referenceHigh: true,
    },
  });

  // Group consecutive rows by (userId, canonicalTestId); first two = latest,prev.
  const netByPatient = new Map<string, number>();
  let gi = 0;
  while (gi < rows.length) {
    const uid = rows[gi].userId;
    const cid = rows[gi].canonicalTestId;
    const group = [];
    while (gi < rows.length && rows[gi].userId === uid && rows[gi].canonicalTestId === cid) {
      group.push(rows[gi]);
      gi++;
    }
    if (group.length < 2) continue;
    const [latest, prev] = group;
    const dLatest = distanceOutside(latest.observedValueNumeric!, latest.referenceLow, latest.referenceHigh);
    const dPrev = distanceOutside(prev.observedValueNumeric!, prev.referenceLow, prev.referenceHigh);
    if (dLatest === dPrev) continue; // no change on this marker
    const delta = dLatest < dPrev ? 1 : -1; // closer to range = improving
    netByPatient.set(uid, (netByPatient.get(uid) ?? 0) + delta);
  }

  for (const uid of ids) {
    if (!netByPatient.has(uid)) continue; // no comparable trend data
    const net = netByPatient.get(uid)!;
    if (net > 0) dist.improving++;
    else if (net < 0) dist.declining++;
    else dist.stable++;
    dist.total++;
  }
  return dist;
}
