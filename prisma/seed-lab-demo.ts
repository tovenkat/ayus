/**
 * Demo data for the Laboratory dashboard — a small CONSENTED roster with
 * longitudinal results, so the population-health surfaces (Action Center,
 * risk stratification, organ distribution, trends, follow-ups) render with
 * real numbers.
 *
 * Idempotent: wipes and recreates the demo org's uploads/reports each run.
 * Requires `npm run biomarkers:seed` first (needs canonical test ids).
 *
 * Run: npm run lab:seed-demo
 */

import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { Interpretation } from "@prisma/client";

// Target the existing Bluebell Diagnostics demo lab (from `npm run dummy:seed`)
// so logging in as +910000000010 shows a populated dashboard. Override with
// LAB_DEMO_ORG_SLUG to seed a different org.
const ORG_SLUG = process.env.LAB_DEMO_ORG_SLUG ?? "bluebell-diagnostics";

type Lab = { name: string; unit: string; refLow: number | null; refHigh: number | null; older: number; newer: number };
type PatientSpec = {
  name: string;
  referredBy: string;
  olderMonthsAgo: number;
  newerMonthsAgo: number;
  labs: Lab[];
  flagReview?: boolean;
};

const DOCS = ["Dr. A. Rao", "Dr. S. Nair", "Dr. P. Mehta", "Dr. K. Iyer"];

// Reference ranges mirror seed-biomarkers plausibility. older→newer encodes the trend.
const PATIENTS: PatientSpec[] = [
  { name: "Ramesh Kumar", referredBy: DOCS[0], olderMonthsAgo: 14, newerMonthsAgo: 8, labs: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 7.8, newer: 9.2 },        // diabetic, worsening, overdue (missed)
    { name: "Creatinine", unit: "mg/dL", refLow: 0.7, refHigh: 1.3, older: 1.2, newer: 1.5 }, // rising
  ] },
  { name: "Sunita Devi", referredBy: DOCS[1], olderMonthsAgo: 11, newerMonthsAgo: 5, labs: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 9.0, newer: 7.2 },        // diabetic, improving, due
    { name: "LDL Cholesterol", unit: "mg/dL", refLow: null, refHigh: 100, older: 165, newer: 138 },
  ] },
  { name: "Anil Sharma", referredBy: DOCS[0], olderMonthsAgo: 24, newerMonthsAgo: 18, labs: [
    { name: "Vitamin D", unit: "ng/mL", refLow: 30, refHigh: 100, older: 12, newer: 14 },   // deficient, missed (18mo)
  ] },
  { name: "Meena Pillai", referredBy: DOCS[2], olderMonthsAgo: 13, newerMonthsAgo: 7, labs: [
    { name: "TSH", unit: "µIU/mL", refLow: 0.4, refHigh: 4.5, older: 6.2, newer: 8.0 },     // high, worsening, due
  ] },
  { name: "Vikram Singh", referredBy: DOCS[3], olderMonthsAgo: 16, newerMonthsAgo: 10, labs: [
    { name: "Ferritin", unit: "ng/mL", refLow: 30, refHigh: 400, older: 10, newer: 8 },     // iron deficient
    { name: "Hemoglobin", unit: "g/dL", refLow: 13, refHigh: 17, older: 10.5, newer: 9.4 }, // falling
  ], flagReview: true },
  { name: "Lakshmi Menon", referredBy: DOCS[1], olderMonthsAgo: 15, newerMonthsAgo: 9, labs: [
    { name: "ALT", unit: "U/L", refLow: 0, refHigh: 55, older: 120, newer: 95 },            // elevated, improving
  ] },
  { name: "Arjun Nair", referredBy: DOCS[2], olderMonthsAgo: 8, newerMonthsAgo: 2, labs: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 5.3, newer: 5.4 },        // healthy, recent — not due
    { name: "LDL Cholesterol", unit: "mg/dL", refLow: null, refHigh: 100, older: 92, newer: 88 },
  ] },
  { name: "Priya Reddy", referredBy: DOCS[0], olderMonthsAgo: 9, newerMonthsAgo: 3, labs: [
    { name: "TSH", unit: "µIU/mL", refLow: 0.4, refHigh: 4.5, older: 2.1, newer: 2.4 },     // healthy
    { name: "Vitamin D", unit: "ng/mL", refLow: 30, refHigh: 100, older: 42, newer: 45 },
  ] },
  { name: "Ganesh Iyer", referredBy: DOCS[3], olderMonthsAgo: 20, newerMonthsAgo: 15, labs: [
    { name: "Creatinine", unit: "mg/dL", refLow: 0.7, refHigh: 1.3, older: 1.6, newer: 1.9 }, // CKD, worsening, missed
  ] },
  { name: "Fatima Sheikh", referredBy: DOCS[1], olderMonthsAgo: 7, newerMonthsAgo: 4, labs: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 6.1, newer: 6.0 },        // prediabetic, ~stable
  ] },
];

function monthsAgo(m: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d;
}

function interp(value: number, low: number | null, high: number | null): { interpretation: Interpretation; oor: boolean } {
  if (high !== null && value > high) return { interpretation: "HIGH", oor: true };
  if (low !== null && value < low) return { interpretation: "LOW", oor: true };
  return { interpretation: "NORMAL", oor: false };
}

async function main() {
  // 1. Canonical test id map (must be seeded).
  const names = [...new Set(PATIENTS.flatMap((p) => p.labs.map((l) => l.name)))];
  const canonicals = await prisma.testCanonical.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  const canonicalId = new Map(canonicals.map((c) => [c.name, c.id]));
  const missing = names.filter((n) => !canonicalId.has(n));
  if (missing.length) {
    console.warn(`[lab-demo] ⚠ canonical tests not seeded: ${missing.join(", ")} — run \`npm run biomarkers:seed\` first. Those biomarkers will be skipped.`);
  }

  // 2. Resolve the target lab org + its owner (created by dummy:seed).
  const org = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
    include: { members: { orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } },
  });
  if (!org) {
    throw new Error(`Org "${ORG_SLUG}" not found — run \`npm run dummy:seed\` first (or set LAB_DEMO_ORG_SLUG).`);
  }
  if (org.type !== "DIAGNOSTIC_CENTER") {
    console.warn(`[lab-demo] ⚠ org "${ORG_SLUG}" is ${org.type}, not DIAGNOSTIC_CENTER — the lab dashboard only renders for lab accounts.`);
  }
  const labUserId = org.members[0]?.userId ?? null; // owner, used as requestedById

  // 3. Wipe prior demo data (cascades reports→testResults).
  await prisma.upload.deleteMany({ where: { organizationId: org.id } });
  console.log(`[lab-demo] org=${org.slug} — reset. Seeding ${PATIENTS.length} consented patients…`);

  // 4. Patients + consent + reports.
  let reportCount = 0, resultCount = 0;
  for (let i = 0; i < PATIENTS.length; i++) {
    const spec = PATIENTS[i];
    const email = `demo-lab-p${i}@userid.local`;
    const patient = await prisma.user.upsert({
      where: { email },
      update: { name: spec.name },
      create: { email, name: spec.name },
    });

    await prisma.patientLink.upsert({
      where: { organizationId_patientId: { organizationId: org.id, patientId: patient.id } },
      update: { status: "GRANTED", respondedAt: new Date() },
      create: { organizationId: org.id, patientId: patient.id, status: "GRANTED", requestedById: labUserId ?? undefined, respondedAt: new Date() },
    });

    // Two reports per patient: older + newer.
    for (const phase of ["older", "newer"] as const) {
      const when = monthsAgo(phase === "older" ? spec.olderMonthsAgo : spec.newerMonthsAgo);
      const sha = crypto.createHash("sha256").update(`${email}-${phase}`).digest("hex");
      const needsReview = phase === "newer" && !!spec.flagReview;
      const upload = await prisma.upload.create({
        data: {
          userId: patient.id, organizationId: org.id, uploadedById: labUserId ?? undefined,
          originalName: `${spec.name.split(" ")[0]}_labreport_${phase}.pdf`,
          storagePath: `${patient.id}/${sha}.pdf`, mimeType: "application/pdf",
          sizeBytes: 120000, sha256: sha, uploadType: "LAB_REPORT",
          status: needsReview ? "NEEDS_REVIEW" : "READY", createdAt: when,
        },
      });

      const rows = spec.labs
        .filter((l) => canonicalId.has(l.name))
        .map((l) => {
          const value = phase === "older" ? l.older : l.newer;
          const { interpretation, oor } = interp(value, l.refLow, l.refHigh);
          const refRaw = l.refLow !== null && l.refHigh !== null ? `${l.refLow} - ${l.refHigh}`
            : l.refHigh !== null ? `< ${l.refHigh}` : `> ${l.refLow}`;
          return {
            userId: patient.id, rawTestName: l.name, normalizedName: l.name,
            canonicalTestId: canonicalId.get(l.name)!,
            observedValueRaw: String(value), observedValueNumeric: value, observedValueUnit: l.unit,
            referenceIntervalRaw: refRaw, referenceLow: l.refLow, referenceHigh: l.refHigh, referenceUnit: l.unit,
            interpretation, confidence: needsReview ? 0.42 : 0.9, isOutOfRange: oor,
            plausibilityFlag: needsReview ? "low_confidence" : null,
          };
        });

      await prisma.report.create({
        data: {
          userId: patient.id, uploadId: upload.id, organizationId: org.id,
          sampleCollectedOn: when, dateSource: "SAMPLE_COLLECTED", referredBy: spec.referredBy,
          sampleType: "Serum", confidence: needsReview ? 0.42 : 0.9, needsReview,
          createdAt: when, testResults: { create: rows },
        },
      });
      reportCount++;
      resultCount += rows.length;
    }
  }

  console.log(`[lab-demo] done — org "${org.name}", ${PATIENTS.length} patients (all GRANTED), ${reportCount} reports, ${resultCount} results.`);
  console.log(`[lab-demo] populated org ${org.slug} — log in as the lab owner (+910000000010) to see the dashboard`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
