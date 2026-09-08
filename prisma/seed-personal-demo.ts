/**
 * Demo lab data for a PERSONAL login account (Aarav Sharma, +910000000001), so
 * the personal dashboard shows the status pie next to a populated organ map,
 * and /dashboard/organs renders real anatomy. Biomarkers span several organs
 * with a normal/abnormal mix.
 *
 * Idempotent — wipes and reseeds this user's demo reports. Needs biomarkers:seed.
 * Run: npm run personal:seed-demo
 */

import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { Interpretation } from "@prisma/client";

const PHONE = "+910000000001";

// name, unit, refLow, refHigh, older, newer
const LABS: [string, string, number | null, number | null, number, number][] = [
  ["HbA1c", "%", 4.0, 5.6, 5.9, 6.1],                 // pancreas/metabolic — high
  ["Creatinine", "mg/dL", 0.7, 1.3, 1.0, 1.1],         // kidney — normal
  ["ALT", "U/L", 0, 55, 48, 62],                       // liver — high
  ["TSH", "µIU/mL", 0.4, 4.5, 3.0, 3.2],               // thyroid — normal
  ["LDL Cholesterol", "mg/dL", null, 100, 132, 145],   // lipid — high
  ["Hemoglobin", "g/dL", 13, 17, 14.8, 14.5],          // blood — normal
  ["Vitamin D", "ng/mL", 30, 100, 20, 22],             // vitamins — low
];

function monthsAgo(m: number): Date { const d = new Date(); d.setMonth(d.getMonth() - m); return d; }
function interp(v: number, low: number | null, high: number | null): { interpretation: Interpretation; oor: boolean } {
  if (high !== null && v > high) return { interpretation: "HIGH", oor: true };
  if (low !== null && v < low) return { interpretation: "LOW", oor: true };
  return { interpretation: "NORMAL", oor: false };
}

async function main() {
  const user = await prisma.user.findUnique({ where: { phone: PHONE }, select: { id: true, name: true } });
  if (!user) throw new Error(`User ${PHONE} not found — run \`npm run dummy:seed\` first.`);

  const canon = await prisma.testCanonical.findMany({ where: { name: { in: LABS.map((l) => l[0]) } }, select: { id: true, name: true, loincNum: true } });
  const cid = new Map(canon.map((c) => [c.name, c] as const));

  // Wipe prior self-uploaded demo reports for this user.
  await prisma.upload.deleteMany({ where: { userId: user.id, organizationId: null, originalName: { startsWith: "self_demo_" } } });

  let reports = 0, results = 0;
  for (const phase of ["older", "newer"] as const) {
    const when = monthsAgo(phase === "older" ? 8 : 2);
    const sha = crypto.createHash("sha256").update(`${user.id}-self-${phase}`).digest("hex");
    const upload = await prisma.upload.create({
      data: {
        userId: user.id, originalName: `self_demo_${phase}.pdf`,
        storagePath: `${user.id}/${sha}.pdf`, mimeType: "application/pdf",
        sizeBytes: 90000, sha256: sha, uploadType: "LAB_REPORT", status: "READY", createdAt: when,
      },
    });
    const rows = LABS.filter((l) => cid.has(l[0])).map(([name, unit, low, high, older, newer]) => {
      const value = phase === "older" ? older : newer;
      const { interpretation, oor } = interp(value, low, high);
      const c = cid.get(name)!;
      const refRaw = low !== null && high !== null ? `${low} - ${high}` : high !== null ? `< ${high}` : `> ${low}`;
      return {
        userId: user.id, rawTestName: name, normalizedName: name, canonicalTestId: c.id, loincNum: c.loincNum,
        observedValueRaw: String(value), observedValueNumeric: value, observedValueUnit: unit,
        referenceIntervalRaw: refRaw, referenceLow: low, referenceHigh: high, referenceUnit: unit,
        interpretation, confidence: 0.9, isOutOfRange: oor, plausibilityFlag: null,
      };
    });
    await prisma.report.create({
      data: {
        userId: user.id, uploadId: upload.id, sampleCollectedOn: when, dateSource: "SAMPLE_COLLECTED",
        sampleType: "Serum", confidence: 0.9, needsReview: false, createdAt: when,
        testResults: { create: rows },
      },
    });
    reports++; results += rows.length;
  }
  console.log(`[personal-demo] ${user.name ?? PHONE}: ${reports} reports, ${results} results. Log in as ${PHONE} → /dashboard.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
