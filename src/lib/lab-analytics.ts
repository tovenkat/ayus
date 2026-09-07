/**
 * Lab dashboard analytics — all scoped to a single org's reports (those
 * uploaded on-behalf-of a patient, i.e. Report.organizationId = orgId).
 *
 * Server-only (Prisma). Powers the four lab-dashboard surfaces:
 *   - summary tiles (volume, tests, needs-review, turnaround)
 *   - needs-review queue with a quality score
 *   - daily volume series
 *   - referring-doctor breakdown
 */

import { prisma } from "@/lib/prisma";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export type LabSummary = {
  reports30d: number;
  tests30d: number;
  needsReview: number;
  rosterCount: number;
  avgTurnaroundHours: number | null; // sampleCollectedOn → report createdAt
};

export async function getLabSummary(orgId: string): Promise<LabSummary> {
  const since = daysAgo(30);
  const [reports30d, tests30d, needsReview, rosterCount, turnaround] = await Promise.all([
    prisma.report.count({ where: { organizationId: orgId, createdAt: { gte: since } } }),
    prisma.testResult.count({
      where: { report: { organizationId: orgId, createdAt: { gte: since } } },
    }),
    prisma.report.count({ where: { organizationId: orgId, needsReview: true } }),
    prisma.patientLink.count({ where: { organizationId: orgId, status: "GRANTED" } }),
    prisma.report.findMany({
      where: { organizationId: orgId, sampleCollectedOn: { not: null }, createdAt: { gte: since } },
      select: { sampleCollectedOn: true, createdAt: true },
      take: 500,
    }),
  ]);

  let avgTurnaroundHours: number | null = null;
  const spans = turnaround
    .map((r) => (r.sampleCollectedOn ? (r.createdAt.getTime() - r.sampleCollectedOn.getTime()) / 3.6e6 : null))
    .filter((h): h is number => h !== null && h >= 0 && h < 24 * 30); // drop implausible spans
  if (spans.length > 0) {
    avgTurnaroundHours = Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
  }

  return { reports30d, tests30d, needsReview, rosterCount, avgTurnaroundHours };
}

export type QualityScore = {
  score: number;          // 0–100, higher = cleaner extraction
  band: "good" | "fair" | "poor";
};

/**
 * Quality score for a report's extraction — a heuristic the reviewer can sort
 * by. Starts from extraction confidence and deducts for out-of-range noise,
 * plausibility flags, and warnings (the same signals that set needsReview).
 */
export function scoreReportQuality(input: {
  confidence: number;
  testCount: number;
  outOfRange: number;
  plausibilityFlags: number;
  warnings: number;
}): QualityScore {
  const base = Math.round(input.confidence * 100);
  const perTest = input.testCount > 0 ? input.testCount : 1;
  // Plausibility flags are the strongest signal something was misread.
  const plausibilityPenalty = Math.min(40, (input.plausibilityFlags / perTest) * 60);
  const warningPenalty = Math.min(25, (input.warnings / perTest) * 30);
  const score = Math.max(0, Math.min(100, Math.round(base - plausibilityPenalty - warningPenalty)));
  const band = score >= 80 ? "good" : score >= 55 ? "fair" : "poor";
  return { score, band };
}

export type ReviewQueueItem = {
  reportId: string;
  uploadName: string;
  patientId: string;
  patientName: string;
  createdAt: string;
  testCount: number;
  quality: QualityScore;
};

/** Reports the org uploaded that still need review, worst-quality first. */
export async function getReviewQueue(orgId: string, limit = 20): Promise<ReviewQueueItem[]> {
  const reports = await prisma.report.findMany({
    where: { organizationId: orgId, needsReview: true },
    orderBy: { createdAt: "desc" },
    take: 100, // over-fetch, then sort by computed score and cap
    select: {
      id: true,
      confidence: true,
      createdAt: true,
      upload: { select: { originalName: true } },
      user: { select: { id: true, name: true } },
      testResults: {
        select: { isOutOfRange: true, plausibilityFlag: true, warnings: true },
      },
    },
  });

  const items = reports.map((r) => {
    const testCount = r.testResults.length;
    const outOfRange = r.testResults.filter((t) => t.isOutOfRange).length;
    const plausibilityFlags = r.testResults.filter((t) => t.plausibilityFlag).length;
    const warnings = r.testResults.reduce((n, t) => n + t.warnings.length, 0);
    return {
      reportId: r.id,
      uploadName: r.upload.originalName,
      patientId: r.user.id,
      patientName: r.user.name ?? "(unnamed)",
      createdAt: r.createdAt.toISOString(),
      testCount,
      quality: scoreReportQuality({ confidence: r.confidence, testCount, outOfRange, plausibilityFlags, warnings }),
    };
  });

  // Worst quality first — that's what a reviewer should triage.
  items.sort((a, b) => a.quality.score - b.quality.score);
  return items.slice(0, limit);
}

export type VolumePoint = { date: string; reports: number };

/** Daily report counts for the last `days` days (zero-filled). */
export async function getVolumeSeries(orgId: string, days = 14): Promise<VolumePoint[]> {
  const since = daysAgo(days - 1);
  const reports = await prisma.report.findMany({
    where: { organizationId: orgId, createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const counts = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = daysAgo(days - 1 - i);
    counts.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of reports) {
    const key = r.createdAt.toISOString().slice(0, 10);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, reports]) => ({ date, reports }));
}

export type RecentUpload = {
  id: string;
  name: string;
  status: string;        // Upload.status
  createdAt: string;
  patient: string | null; // null = unassigned intake (uploaded to the org, no patient)
  patientId: string | null;
};

/** Latest uploads for the org — the "did my upload land?" activity feed. */
export async function getRecentUploads(orgId: string, limit = 8): Promise<RecentUpload[]> {
  const uploads = await prisma.upload.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, originalName: true, status: true, createdAt: true,
      userId: true, uploadedById: true,
      user: { select: { id: true, name: true } },
    },
  });
  return uploads.map((u) => {
    const unassigned = u.uploadedById != null && u.userId === u.uploadedById;
    return {
      id: u.id,
      name: u.originalName,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      patient: unassigned ? null : (u.user.name ?? "(unnamed)"),
      patientId: unassigned ? null : u.user.id,
    };
  });
}

export type LabReportRow = {
  reportId: string;
  uploadName: string;
  patientId: string;
  patientName: string;
  createdAt: string;
  sampleType: string | null;
  referredBy: string | null;
  testCount: number;
  status: string;         // Upload.status
  quality: QualityScore;
};

export type LabReportsFilter = "all" | "NEEDS_REVIEW" | "ERROR" | "READY";

/** Org-scoped master list of reports the lab has processed (on-behalf-of). */
export async function getLabReports(
  orgId: string,
  filter: LabReportsFilter = "all",
  limit = 50,
): Promise<LabReportRow[]> {
  const statusWhere =
    filter === "NEEDS_REVIEW" ? { needsReview: true }
    : filter === "ERROR" ? { upload: { status: "ERROR" as const } }
    : filter === "READY" ? { needsReview: false }
    : {};

  const reports = await prisma.report.findMany({
    where: { organizationId: orgId, ...statusWhere },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      confidence: true,
      createdAt: true,
      sampleType: true,
      referredBy: true,
      upload: { select: { originalName: true, status: true } },
      user: { select: { id: true, name: true } },
      testResults: { select: { isOutOfRange: true, plausibilityFlag: true, warnings: true } },
    },
  });

  return reports.map((r) => {
    const testCount = r.testResults.length;
    const outOfRange = r.testResults.filter((t) => t.isOutOfRange).length;
    const plausibilityFlags = r.testResults.filter((t) => t.plausibilityFlag).length;
    const warnings = r.testResults.reduce((n, t) => n + t.warnings.length, 0);
    return {
      reportId: r.id,
      uploadName: r.upload.originalName,
      patientId: r.user.id,
      patientName: r.user.name ?? "(unnamed)",
      createdAt: r.createdAt.toISOString(),
      sampleType: r.sampleType,
      referredBy: r.referredBy,
      testCount,
      status: r.upload.status,
      quality: scoreReportQuality({ confidence: r.confidence, testCount, outOfRange, plausibilityFlags, warnings }),
    };
  });
}

/** Counts for the dashboard "needs attention" surfaces. */
export async function getLabExceptions(orgId: string): Promise<{
  pendingConsents: number;
  failedUploads: number;
  processing: number;
}> {
  const [pendingConsents, failedUploads, processing] = await Promise.all([
    prisma.patientLink.count({ where: { organizationId: orgId, status: "PENDING" } }),
    prisma.upload.count({ where: { organizationId: orgId, status: "ERROR" } }),
    prisma.upload.count({ where: { organizationId: orgId, status: { in: ["UPLOADED", "PROCESSING"] } } }),
  ]);
  return { pendingConsents, failedUploads, processing };
}

export type ReferringDoctor = { name: string; reports: number };

/** Top referring doctors by report volume (from Report.referredBy). */
export async function getReferringDoctors(orgId: string, limit = 8): Promise<ReferringDoctor[]> {
  const grouped = await prisma.report.groupBy({
    by: ["referredBy"],
    where: { organizationId: orgId, referredBy: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { referredBy: "desc" } },
    take: limit,
  });
  return grouped
    .filter((g) => g.referredBy && g.referredBy.trim())
    .map((g) => ({ name: g.referredBy!.trim(), reports: g._count._all }));
}
