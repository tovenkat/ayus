/**
 * Demo data for the Doctor + Hospital dashboards — consented panels with
 * longitudinal biomarkers designed to populate clinical intelligence:
 * care flags (combination findings, critical values, trends) and disease
 * registries (diabetes / CKD / thyroid / lipids / anemia / vit-D).
 *
 * Targets the dummy:seed orgs (Menon Family Clinic, Sri Venkateswara Hospital).
 * Idempotent — wipes and reseeds each org's demo data.
 *
 * Run: npm run clinical:seed-demo   (needs biomarkers:seed + dummy:seed first)
 */

import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { Interpretation } from "@prisma/client";

type Lab = { name: string; unit: string; refLow: number | null; refHigh: number | null; older: number; newer: number };

// ─── Clinical profiles → the biomarkers that define them (older → newer) ─────
const PROFILES: Record<string, Lab[]> = {
  diabetic_nephropathy: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 8.5, newer: 9.6 },
    { name: "Creatinine", unit: "mg/dL", refLow: 0.7, refHigh: 1.3, older: 1.3, newer: 1.7 },
  ],
  uncontrolled_diabetes: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 8.8, newer: 9.4 },
    { name: "LDL Cholesterol", unit: "mg/dL", refLow: null, refHigh: 100, older: 128, newer: 142 },
  ],
  controlled_diabetes: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 6.9, newer: 6.5 },
  ],
  ckd_progressive: [
    { name: "Creatinine", unit: "mg/dL", refLow: 0.7, refHigh: 1.3, older: 1.7, newer: 2.1 },
    { name: "Hemoglobin", unit: "g/dL", refLow: 13, refHigh: 17, older: 11.8, newer: 11.0 },
  ],
  ckd_critical: [
    { name: "Creatinine", unit: "mg/dL", refLow: 0.7, refHigh: 1.3, older: 3.6, newer: 4.6 },
  ],
  hypothyroid: [
    { name: "TSH", unit: "µIU/mL", refLow: 0.4, refHigh: 4.5, older: 6.0, newer: 8.4 },
  ],
  hyperthyroid: [
    { name: "TSH", unit: "µIU/mL", refLow: 0.4, refHigh: 4.5, older: 0.30, newer: 0.12 },
  ],
  dyslipidemia: [
    { name: "LDL Cholesterol", unit: "mg/dL", refLow: null, refHigh: 100, older: 150, newer: 172 },
  ],
  iron_anemia: [
    { name: "Ferritin", unit: "ng/mL", refLow: 30, refHigh: 400, older: 12, newer: 9 },
    { name: "Hemoglobin", unit: "g/dL", refLow: 13, refHigh: 17, older: 11.2, newer: 10.4 },
  ],
  severe_anemia: [
    { name: "Hemoglobin", unit: "g/dL", refLow: 13, refHigh: 17, older: 8.0, newer: 6.6 },
    { name: "Ferritin", unit: "ng/mL", refLow: 30, refHigh: 400, older: 8, newer: 6 },
  ],
  liver_injury: [
    { name: "ALT", unit: "U/L", refLow: 0, refHigh: 55, older: 90, newer: 185 },
  ],
  vitd_deficient: [
    { name: "Vitamin D", unit: "ng/mL", refLow: 30, refHigh: 100, older: 16, newer: 14 },
  ],
  healthy: [
    { name: "HbA1c", unit: "%", refLow: 4.0, refHigh: 5.6, older: 5.2, newer: 5.3 },
    { name: "TSH", unit: "µIU/mL", refLow: 0.4, refHigh: 4.5, older: 2.1, newer: 2.3 },
    { name: "LDL Cholesterol", unit: "mg/dL", refLow: null, refHigh: 100, older: 92, newer: 88 },
  ],
};

const DOCS = ["Dr. A. Rao", "Dr. S. Nair", "Dr. P. Mehta", "Dr. K. Iyer", "Dr. R. Bose"];

type PanelEntry = { name: string; profile: keyof typeof PROFILES; flagReview?: boolean };

const MENON_PANEL: PanelEntry[] = [
  { name: "Ramesh Kumar", profile: "diabetic_nephropathy" },
  { name: "Sunita Devi", profile: "uncontrolled_diabetes" },
  { name: "Arjun Nair", profile: "controlled_diabetes" },
  { name: "Meena Pillai", profile: "hypothyroid" },
  { name: "Vikram Singh", profile: "iron_anemia", flagReview: true },
  { name: "Lakshmi Menon", profile: "liver_injury" },
  { name: "Ganesh Iyer", profile: "ckd_progressive" },
  { name: "Priya Reddy", profile: "dyslipidemia" },
  { name: "Fatima Sheikh", profile: "vitd_deficient" },
];

const SVH_PANEL: PanelEntry[] = [
  { name: "Anil Sharma", profile: "diabetic_nephropathy" },
  { name: "Kavita Rao", profile: "uncontrolled_diabetes" },
  { name: "Suresh Babu", profile: "controlled_diabetes" },
  { name: "Deepa Menon", profile: "controlled_diabetes" },
  { name: "Ravi Verma", profile: "ckd_critical", flagReview: true },
  { name: "Nisha Gupta", profile: "ckd_progressive" },
  { name: "Mohan Das", profile: "severe_anemia", flagReview: true },
  { name: "Anjali Nair", profile: "iron_anemia" },
  { name: "Prakash Jain", profile: "hypothyroid" },
  { name: "Rekha Pillai", profile: "hyperthyroid" },
  { name: "Sanjay Roy", profile: "liver_injury" },
  { name: "Divya Iyer", profile: "dyslipidemia" },
  { name: "Karan Malhotra", profile: "dyslipidemia" },
  { name: "Pooja Shah", profile: "vitd_deficient" },
  { name: "Vivek Kulkarni", profile: "healthy" },
  { name: "Neha Bansal", profile: "healthy" },
];

function monthsAgo(m: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d;
}
function interp(v: number, low: number | null, high: number | null): { interpretation: Interpretation; oor: boolean } {
  if (high !== null && v > high) return { interpretation: "HIGH", oor: true };
  if (low !== null && v < low) return { interpretation: "LOW", oor: true };
  return { interpretation: "NORMAL", oor: false };
}

async function seedPanel(orgSlug: string, panel: PanelEntry[], canonicalId: Map<string, string>) {
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    include: { members: { orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } },
  });
  if (!org) {
    console.warn(`[clinical-demo] ⚠ org "${orgSlug}" not found — run \`npm run dummy:seed\`. Skipping.`);
    return;
  }
  const ownerId = org.members[0]?.userId ?? undefined;

  await prisma.upload.deleteMany({ where: { organizationId: org.id } });

  let reports = 0, results = 0;
  for (let i = 0; i < panel.length; i++) {
    const entry = panel[i];
    const email = `demo-${orgSlug}-p${i}@userid.local`;
    const patient = await prisma.user.upsert({
      where: { email }, update: { name: entry.name }, create: { email, name: entry.name },
    });
    await prisma.patientLink.upsert({
      where: { organizationId_patientId: { organizationId: org.id, patientId: patient.id } },
      update: { status: "GRANTED", respondedAt: new Date() },
      create: { organizationId: org.id, patientId: patient.id, status: "GRANTED", requestedById: ownerId, respondedAt: new Date() },
    });

    const labs = PROFILES[entry.profile];
    const referredBy = DOCS[i % DOCS.length];
    for (const phase of ["older", "newer"] as const) {
      const when = monthsAgo(phase === "older" ? 9 : 3);
      const sha = crypto.createHash("sha256").update(`${email}-${phase}`).digest("hex");
      const needsReview = phase === "newer" && !!entry.flagReview;
      const upload = await prisma.upload.create({
        data: {
          userId: patient.id, organizationId: org.id, uploadedById: ownerId,
          originalName: `${entry.name.split(" ")[0]}_${phase}.pdf`,
          storagePath: `${patient.id}/${sha}.pdf`, mimeType: "application/pdf",
          sizeBytes: 100000, sha256: sha, uploadType: "LAB_REPORT",
          status: needsReview ? "NEEDS_REVIEW" : "READY", createdAt: when,
        },
      });
      const rows = labs.filter((l) => canonicalId.has(l.name)).map((l) => {
        const value = phase === "older" ? l.older : l.newer;
        const { interpretation, oor } = interp(value, l.refLow, l.refHigh);
        const refRaw = l.refLow !== null && l.refHigh !== null ? `${l.refLow} - ${l.refHigh}` : l.refHigh !== null ? `< ${l.refHigh}` : `> ${l.refLow}`;
        return {
          userId: patient.id, rawTestName: l.name, normalizedName: l.name,
          canonicalTestId: canonicalId.get(l.name)!, loincNum: null as string | null,
          observedValueRaw: String(value), observedValueNumeric: value, observedValueUnit: l.unit,
          referenceIntervalRaw: refRaw, referenceLow: l.refLow, referenceHigh: l.refHigh, referenceUnit: l.unit,
          interpretation, confidence: needsReview ? 0.42 : 0.9, isOutOfRange: oor,
          plausibilityFlag: needsReview ? "low_confidence" : null,
        };
      });
      await prisma.report.create({
        data: {
          userId: patient.id, uploadId: upload.id, organizationId: org.id,
          sampleCollectedOn: when, dateSource: "SAMPLE_COLLECTED", referredBy, sampleType: "Serum",
          confidence: needsReview ? 0.42 : 0.9, needsReview, createdAt: when,
          testResults: { create: rows },
        },
      });
      reports++; results += rows.length;
    }
  }
  console.log(`[clinical-demo] ${org.name}: ${panel.length} patients, ${reports} reports, ${results} results`);
}

async function main() {
  const names = [...new Set(Object.values(PROFILES).flat().map((l) => l.name))];
  const canon = await prisma.testCanonical.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  const canonicalId = new Map(canon.map((c) => [c.name, c.id]));
  const missing = names.filter((n) => !canonicalId.has(n));
  if (missing.length) console.warn(`[clinical-demo] ⚠ canonicals missing (run biomarkers:seed): ${missing.join(", ")}`);

  await seedPanel("menon-family-clinic", MENON_PANEL, canonicalId);
  await seedPanel("sri-venkateswara-hospital", SVH_PANEL, canonicalId);
  console.log("[clinical-demo] done — log in as +910000000020 (doctor) or +910000000030 (hospital).");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
