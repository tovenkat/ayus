/**
 * Population-health aggregation for a lab's CONSENTED ROSTER.
 *
 * Scope: patients with a GRANTED PatientLink to the org. We read each such
 * patient's full result history (consent covers their record), compute the
 * latest value per biomarker, and apply the repeat-interval catalog to find
 * who is due / overdue / missed for follow-up.
 *
 * Everything surfaced here is clinical DECISION SUPPORT, not diagnosis — the
 * UI must label it as such and cite the guideline (carried on each item).
 *
 * Server-only (Prisma).
 */

import { prisma } from "@/lib/prisma";
import {
  REPEAT_INTERVALS, REPEAT_INTERVAL_BY_NAME, resolveInterval, intervalLabel,
} from "@/lib/repeat-intervals";

const MS_PER_MONTH = 30 * 24 * 3.6e6;

export type FollowUpStatus = "due" | "missed";

export type FollowUpItem = {
  canonicalName: string;
  action: string;
  patientId: string;
  patientName: string;
  previousValue: string;      // raw + unit, for the drill-down "Previous" column
  lastTest: string;           // ISO
  intervalMonths: number;
  recommendation: string;     // "Repeat every 3 months — Diabetic range"
  guideline: string;
  monthsOverdue: number;      // ≥0; how long past the due date
  status: FollowUpStatus;
};

/** Roster = patients with a GRANTED link to the org. */
async function getRosterPatients(orgId: string): Promise<Map<string, string>> {
  const links = await prisma.patientLink.findMany({
    where: { organizationId: orgId, status: "GRANTED" },
    select: { patient: { select: { id: true, name: true } } },
  });
  return new Map(links.map((l) => [l.patient.id, l.patient.name ?? "(unnamed)"]));
}

/**
 * Compute every due/overdue follow-up across the roster, for the catalog tests.
 * Shared by the action-center counts, per-test drill-down, and missed view.
 */
async function computeFollowUps(orgId: string): Promise<FollowUpItem[]> {
  const roster = await getRosterPatients(orgId);
  if (roster.size === 0) return [];
  const patientIds = [...roster.keys()];

  // Map catalog canonical names → ids (only tests we have intervals for).
  const canonicals = await prisma.testCanonical.findMany({
    where: { name: { in: REPEAT_INTERVALS.map((e) => e.canonicalName) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(canonicals.map((c) => [c.id, c.name]));
  if (nameById.size === 0) return [];

  // Latest result per (patient, canonicalTest), ordered by the clinical SAMPLE
  // date (when the test was actually done) — not the row insert time.
  const results = await prisma.testResult.findMany({
    where: { userId: { in: patientIds }, canonicalTestId: { in: [...nameById.keys()] } },
    orderBy: [{ report: { sampleCollectedOn: "desc" } }, { createdAt: "desc" }],
    select: {
      userId: true,
      canonicalTestId: true,
      observedValueRaw: true,
      observedValueNumeric: true,
      observedValueUnit: true,
      report: { select: { sampleCollectedOn: true, createdAt: true } },
    },
  });

  const now = Date.now();
  const seen = new Set<string>();
  const items: FollowUpItem[] = [];

  for (const r of results) {
    const key = `${r.userId}:${r.canonicalTestId}`;
    if (seen.has(key)) continue; // not the latest for this pair
    seen.add(key);

    const canonicalName = nameById.get(r.canonicalTestId!);
    if (!canonicalName) continue;
    const entry = REPEAT_INTERVAL_BY_NAME[canonicalName];
    if (!entry) continue;

    const lastTestDate = r.report.sampleCollectedOn ?? r.report.createdAt;
    const interval = resolveInterval(entry, r.observedValueNumeric);
    const dueAt = lastTestDate.getTime() + interval.months * MS_PER_MONTH;
    const monthsOverdue = (now - dueAt) / MS_PER_MONTH;
    if (monthsOverdue < 0) continue; // not due yet

    // "missed" = overdue by at least another full interval (they've likely
    // dropped out of monitoring), else just "due".
    const status: FollowUpStatus = monthsOverdue >= interval.months ? "missed" : "due";

    items.push({
      canonicalName,
      action: entry.action,
      patientId: r.userId,
      patientName: roster.get(r.userId) ?? "(unnamed)",
      previousValue: `${r.observedValueRaw}${r.observedValueUnit ? ` ${r.observedValueUnit}` : ""}`,
      lastTest: lastTestDate.toISOString(),
      intervalMonths: interval.months,
      recommendation: `Repeat ${intervalLabel(interval.months)}${interval.reason ? ` — ${interval.reason}` : ""}`,
      guideline: entry.guideline,
      monthsOverdue: Math.round(monthsOverdue),
      status,
    });
  }

  return items;
}

export type ActionCount = { canonicalName: string; action: string; count: number };

/** Health Action Center: due patients grouped by test, most first. */
export async function getFollowUpActionCounts(orgId: string): Promise<ActionCount[]> {
  const items = await computeFollowUps(orgId);
  const byTest = new Map<string, ActionCount>();
  for (const it of items) {
    const cur = byTest.get(it.canonicalName) ?? { canonicalName: it.canonicalName, action: it.action, count: 0 };
    cur.count++;
    byTest.set(it.canonicalName, cur);
  }
  return [...byTest.values()].sort((a, b) => b.count - a.count);
}

/** Drill-down: patients due for one specific test, worst-overdue first. */
export async function getFollowUpPatients(orgId: string, canonicalName: string): Promise<FollowUpItem[]> {
  const items = await computeFollowUps(orgId);
  return items
    .filter((it) => it.canonicalName === canonicalName)
    .sort((a, b) => b.monthsOverdue - a.monthsOverdue);
}

/** Missed follow-ups across all tests (long-overdue), worst first. */
export async function getMissedFollowUps(orgId: string, limit = 50): Promise<FollowUpItem[]> {
  const items = await computeFollowUps(orgId);
  return items
    .filter((it) => it.status === "missed")
    .sort((a, b) => b.monthsOverdue - a.monthsOverdue)
    .slice(0, limit);
}

/** Totals for dashboard tiles. */
export async function getFollowUpSummary(orgId: string): Promise<{ due: number; missed: number }> {
  const items = await computeFollowUps(orgId);
  return {
    due: items.length,
    missed: items.filter((it) => it.status === "missed").length,
  };
}
