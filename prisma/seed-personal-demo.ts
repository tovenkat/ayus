/**
 * Demo data for a PERSONAL login account (Aarav Sharma, +910000000001) so the
 * personal dashboard is fully populated:
 *   • 6 lab reports over ~14 months with realistic, trending biomarkers
 *     (prediabetes + dyslipidemia + fatty liver + low vitamin D, all improving),
 *     spanning several organs so the status pie and organ anatomy map light up.
 *   • Today's Medications (active medication schedule).
 *   • Today's Meals (daily diet schedule, diabetic-friendly Indian plan).
 *   • Recent Doctor Visits (consults + prescriptions) incl. an upcoming follow-up.
 *
 * Idempotent — wipes and reseeds this user's demo rows. Needs biomarkers:seed.
 * Run: npm run personal:seed-demo
 */

import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { Interpretation } from "@prisma/client";

const PHONE = "+910000000001";

// 6 report timepoints, oldest → newest (months ago).
const TIMEPOINTS = [14, 11, 8, 5, 3, 1];

// name, unit, refLow, refHigh, then 6 values (oldest → newest). String values
// are qualitative (urinalysis) — stored with no numeric/range, always NORMAL.
// The panel spans ALL 16 organ systems so every region on the anatomy map
// lights up. Story: an improving prediabetic/dyslipidemic patient on treatment,
// with a few mild flags (uric acid, CRP, ESR) that also normalise.
type LabRow = [string, string, number | null, number | null, (number | string)[]];
const LABS: LabRow[] = [
  // ── Pancreas / Metabolic ──
  ["HbA1c",            "%",       4.0, 5.6,  [6.4, 6.3, 6.1, 6.0, 5.9, 5.8]],   // high, improving
  ["Fasting Glucose",  "mg/dL",   70,  100,  [118, 114, 110, 106, 102, 98]],    // high → normal
  // ── Heart / Lipids ──
  ["Total Cholesterol","mg/dL",   null,200,  [228, 220, 212, 205, 196, 188]],   // high → normal
  ["LDL Cholesterol",  "mg/dL",   null,100,  [150, 145, 138, 130, 122, 110]],   // high, improving
  ["HDL Cholesterol",  "mg/dL",   40,  null, [38, 39, 41, 43, 45, 47]],         // low → normal
  ["Triglycerides",    "mg/dL",   null,150,  [190, 180, 170, 160, 150, 140]],   // high → normal
  // ── Liver ──
  ["ALT",              "U/L",     0,   55,   [68, 64, 60, 55, 50, 45]],         // high, improving
  ["AST",              "U/L",     0,   40,   [52, 48, 44, 40, 37, 34]],         // high → normal
  ["ALP",              "U/L",     40,  129,  [88, 90, 85, 92, 87, 89]],         // normal
  // ── Kidney ──
  ["Creatinine",       "mg/dL",   0.7, 1.3,  [1.0, 1.0, 1.1, 1.0, 1.1, 1.0]],   // normal
  ["Urea",             "mg/dL",   17,  43,   [34, 36, 32, 35, 33, 34]],         // normal
  ["Uric Acid",        "mg/dL",   3.5, 7.2,  [7.6, 7.4, 7.2, 7.0, 6.8, 6.6]],   // high → normal
  // ── Thyroid / Hormones ──
  ["TSH",              "µIU/mL",  0.4, 4.5,  [3.0, 3.1, 3.2, 3.0, 2.9, 3.1]],   // normal
  ["Free T3",          "pg/mL",   2.0, 4.4,  [3.1, 3.0, 3.2, 3.1, 3.0, 3.2]],   // normal
  ["Free T4",          "ng/dL",   0.8, 1.8,  [1.2, 1.1, 1.3, 1.2, 1.1, 1.2]],   // normal
  // ── Blood / Immune / Coagulation ──
  ["Hemoglobin",       "g/dL",    13,  17,   [14.2, 14.4, 14.6, 14.8, 15.0, 15.1]], // normal
  ["WBC Count",        "10^3/µL", 4.0, 11.0, [6.8, 7.0, 6.5, 7.2, 6.9, 7.1]],   // normal
  ["Neutrophils",      "%",       40,  70,   [58, 60, 57, 61, 59, 60]],         // normal
  ["Lymphocytes",      "%",       20,  40,   [32, 31, 33, 30, 32, 31]],         // normal
  ["Platelet Count",   "10^3/µL", 150, 410,  [250, 260, 245, 255, 248, 252]],   // normal
  ["PT",               "sec",     11,  13.5, [12.0, 12.2, 11.8, 12.1, 12.0, 12.2]], // normal
  ["INR",              "",        0.8, 1.2,  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0]],   // normal
  // ── Bone / Electrolytes ──
  ["Calcium",          "mg/dL",   8.6, 10.2, [9.3, 9.4, 9.5, 9.4, 9.5, 9.4]],   // normal
  ["Phosphorus",       "mg/dL",   2.5, 4.5,  [3.4, 3.5, 3.3, 3.6, 3.4, 3.5]],   // normal
  ["Sodium",           "mmol/L",  135, 145,  [140, 141, 139, 140, 142, 140]],   // normal
  ["Potassium",        "mmol/L",  3.5, 5.1,  [4.2, 4.3, 4.1, 4.4, 4.2, 4.3]],   // normal
  ["Chloride",         "mmol/L",  98,  107,  [102, 103, 101, 104, 102, 103]],   // normal
  ["Magnesium",        "mg/dL",   1.7, 2.2,  [2.0, 2.1, 1.9, 2.0, 2.1, 2.0]],   // normal
  // ── Inflammation ──
  ["CRP",              "mg/L",    null,5,     [8, 7, 6, 5, 4, 3]],              // high → normal
  ["ESR",              "mm/hr",   0,   20,    [26, 24, 20, 18, 15, 12]],         // high → normal
  ["Ferritin",         "ng/mL",   30,  400,   [120, 130, 140, 135, 145, 150]],  // normal
  // ── Vitamins & Nutrition ──
  ["Vitamin D",        "ng/mL",   30,  100,  [18, 20, 23, 26, 30, 34]],         // low → normal
  ["Vitamin B12",      "pg/mL",   200, 900,  [210, 240, 280, 320, 360, 400]],   // low → normal
  // ── Urinary (qualitative + a couple numeric) ──
  ["Urine Protein",    "",        null,null, ["Negative", "Trace", "Negative", "Negative", "Negative", "Negative"]],
  ["Urine Glucose",    "",        null,null, ["Trace", "Negative", "Negative", "Negative", "Negative", "Negative"]],
  ["Urine Blood",      "",        null,null, ["Negative", "Negative", "Negative", "Negative", "Negative", "Negative"]],
  ["Urine pH",         "",        4.5, 8.0,  [6.0, 5.5, 6.0, 6.5, 6.0, 5.5]],   // normal
  ["Urine Specific Gravity", "",  1.005,1.030,[1.015, 1.018, 1.012, 1.020, 1.015, 1.016]], // normal
];

function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function monthsAgo(m: number): Date { const d = new Date(); d.setMonth(d.getMonth() - m); return d; }
function daysFromNow(n: number): Date { const d = new Date(); d.setDate(d.getDate() + n); return d; }

function interp(v: number, low: number | null, high: number | null): { interpretation: Interpretation; oor: boolean } {
  if (high !== null && v > high) return { interpretation: "HIGH", oor: true };
  if (low !== null && v < low) return { interpretation: "LOW", oor: true };
  return { interpretation: "NORMAL", oor: false };
}

async function seedReports(userId: string) {
  const canon = await prisma.testCanonical.findMany({
    where: { name: { in: LABS.map((l) => l[0]) } },
    select: { id: true, name: true, loincNum: true },
  });
  const cid = new Map(canon.map((c) => [c.name, c] as const));

  // Wipe prior self-uploaded demo reports for this user.
  await prisma.upload.deleteMany({
    where: { userId, organizationId: null, originalName: { startsWith: "self_demo_" } },
  });

  let reports = 0, results = 0;
  for (let i = 0; i < TIMEPOINTS.length; i++) {
    const when = monthsAgo(TIMEPOINTS[i]);
    const sha = crypto.createHash("sha256").update(`${userId}-self-${i}`).digest("hex");
    const upload = await prisma.upload.create({
      data: {
        userId, originalName: `self_demo_${i}.pdf`,
        storagePath: `${userId}/${sha}.pdf`, mimeType: "application/pdf",
        sizeBytes: 90000, sha256: sha, uploadType: "LAB_REPORT", status: "READY", createdAt: when,
      },
    });
    const rows = LABS.filter((l) => cid.has(l[0])).map(([name, unit, low, high, values]) => {
      const value = values[i];
      const c = cid.get(name)!;
      const qualitative = typeof value === "string";
      const numeric = qualitative ? null : (value as number);
      const { interpretation, oor } = qualitative
        ? { interpretation: "NORMAL" as Interpretation, oor: false }
        : interp(numeric!, low, high);
      const refRaw = low !== null && high !== null ? `${low} - ${high}`
        : high !== null ? `< ${high}`
        : low !== null ? `> ${low}`
        : qualitative ? "Negative" : "—";
      return {
        userId, rawTestName: name, normalizedName: name, canonicalTestId: c.id, loincNum: c.loincNum,
        observedValueRaw: String(value), observedValueNumeric: numeric, observedValueUnit: unit || null,
        referenceIntervalRaw: refRaw, referenceLow: low, referenceHigh: high, referenceUnit: unit || null,
        interpretation, confidence: 0.92, isOutOfRange: oor, plausibilityFlag: null,
      };
    });
    await prisma.report.create({
      data: {
        userId, uploadId: upload.id, sampleCollectedOn: when, dateSource: "SAMPLE_COLLECTED",
        sampleType: "Serum", confidence: 0.92, needsReview: false, createdAt: when,
        testResults: { create: rows },
      },
    });
    reports++; results += rows.length;
  }
  return { reports, results };
}

async function seedMedications(userId: string) {
  await prisma.medication.deleteMany({ where: { userId } });
  const meds: Array<Parameters<typeof prisma.medication.create>[0]["data"]> = [
    { userId, name: "Metformin", dosage: "500 mg", frequency: "TWICE_DAILY", timeSlots: ["morning", "night"], startDate: monthsAgo(10), active: true, notes: "With meals — for blood sugar control." },
    { userId, name: "Atorvastatin", dosage: "10 mg", frequency: "ONCE_DAILY", timeSlots: ["night"], startDate: monthsAgo(10), active: true, notes: "For cholesterol." },
    { userId, name: "Telmisartan", dosage: "40 mg", frequency: "ONCE_DAILY", timeSlots: ["morning"], startDate: monthsAgo(6), active: true, notes: "For blood pressure." },
    { userId, name: "Vitamin D3", dosage: "60,000 IU", frequency: "WEEKLY", timeSlots: ["morning"], startDate: monthsAgo(8), active: true, notes: "Once a week after breakfast." },
  ];
  for (const data of meds) await prisma.medication.create({ data });
  return meds.length;
}

async function seedMeals(userId: string) {
  await prisma.dietSchedule.deleteMany({ where: { userId } });
  // daysOfWeek: [] = every day. Diabetic-friendly, low-fat Indian plan.
  const meals: Array<Parameters<typeof prisma.dietSchedule.create>[0]["data"]> = [
    { userId, mealType: "BREAKFAST", time: "08:00", items: "Vegetable oats upma + 1 boiled egg + green tea", calories: 320, restrictions: ["diabetic", "low-fat"], cuisineTags: ["South Indian", "High Fibre"], prepMinutes: 15, daysOfWeek: [], active: true },
    { userId, mealType: "MORNING_SNACK", time: "11:00", items: "Handful of almonds + 1 apple", calories: 150, restrictions: ["diabetic"], cuisineTags: ["Quick"], prepMinutes: 2, daysOfWeek: [], active: true },
    { userId, mealType: "LUNCH", time: "13:00", items: "2 multigrain rotis + dal + mixed-veg sabzi + bowl of curd", calories: 480, restrictions: ["diabetic", "low-fat"], cuisineTags: ["North Indian", "Balanced"], prepMinutes: 30, daysOfWeek: [], active: true },
    { userId, mealType: "AFTERNOON_SNACK", time: "16:30", items: "Roasted chana + buttermilk", calories: 140, restrictions: ["diabetic", "high-protein"], cuisineTags: ["Quick"], prepMinutes: 5, daysOfWeek: [], active: true },
    { userId, mealType: "DINNER", time: "20:00", items: "Grilled paneer + sautéed greens + 1 roti", calories: 420, restrictions: ["diabetic", "low-fat", "high-protein"], cuisineTags: ["North Indian"], prepMinutes: 25, daysOfWeek: [], active: true },
  ];
  for (const data of meals) await prisma.dietSchedule.create({ data });
  return meals.length;
}

async function seedVisits(userId: string) {
  // Remove prior self-recorded demo visits (no org attribution). Prescriptions cascade.
  await prisma.doctorNote.deleteMany({ where: { userId, organizationId: null } });

  // Visit 1 — first diagnosis, ~10 months ago.
  await prisma.doctorNote.create({
    data: {
      userId, visitDate: monthsAgo(10), doctorName: "Dr. Arjun Menon", specialty: "ENDOCRINOLOGY",
      clinic: "Menon Family Clinic", diagnosis: "Prediabetes, dyslipidemia, Vitamin D deficiency",
      notes: "HbA1c 6.4%. Started on Metformin + Atorvastatin. Counselled on diet and 30 min daily walk. Vitamin D3 weekly.",
      followUpDate: monthsAgo(7),
      prescriptions: {
        create: [
          { medication: "Metformin", dosage: "500 mg", frequency: "twice daily", duration: "ongoing", instructions: "With breakfast and dinner." },
          { medication: "Atorvastatin", dosage: "10 mg", frequency: "once daily", duration: "ongoing", instructions: "At bedtime." },
          { medication: "Vitamin D3", dosage: "60,000 IU", frequency: "weekly", duration: "8 weeks", instructions: "After breakfast on Sundays." },
        ],
      },
    },
  });

  // Visit 2 — follow-up, ~4 months ago, things improving, add BP med.
  await prisma.doctorNote.create({
    data: {
      userId, visitDate: monthsAgo(4), doctorName: "Dr. Arjun Menon", specialty: "ENDOCRINOLOGY",
      clinic: "Menon Family Clinic", diagnosis: "Prediabetes — improving; stage-1 hypertension",
      notes: "HbA1c down to 6.0%. Lipids improving. BP 142/90 — started Telmisartan. Continue current plan.",
      followUpDate: monthsAgo(1),
      prescriptions: {
        create: [
          { medication: "Telmisartan", dosage: "40 mg", frequency: "once daily", duration: "ongoing", instructions: "In the morning." },
        ],
      },
    },
  });

  // Visit 3 — recent, ~3 weeks ago, with an UPCOMING follow-up (future date).
  await prisma.doctorNote.create({
    data: {
      userId, visitDate: daysAgo(21), doctorName: "Dr. Priya Nair", specialty: "GENERAL",
      clinic: "Wellness Point Clinic", diagnosis: "Routine review — metabolic panel stable",
      notes: "HbA1c 5.8%, LDL 110, Vitamin D normalised. Patient doing well. Reinforced diet and activity. Recheck labs in 6 weeks.",
      followUpDate: daysFromNow(21),
      prescriptions: {
        create: [
          { medication: "Metformin", dosage: "500 mg", frequency: "twice daily", duration: "ongoing", instructions: "Continue." },
        ],
      },
    },
  });

  return 3;
}

/**
 * Let the demo personal account use a cloud "Internet LLM" for chat/RAG:
 *   • Turn OFF privacy mode (it forces everything to local Ollama and greys out
 *     the provider cards in Settings → AI).
 *   • Upgrade the individual org to the PERSONAL tier, which unlocks the cloud
 *     providers + BYOK (FREE is "Local Ollama only", so the cards are disabled).
 * The user still picks a provider and (per BYOK) pastes a key in Settings — or
 * set INTERNET_LLM + its API key in .env to make it work with no key entry.
 */
async function enableInternetLlm(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { privacyMode: false } });

  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organization: { type: "INDIVIDUAL" } },
    select: { organizationId: true },
  });
  if (!membership) return "no individual org";

  const { PRICING } = await import("../src/lib/pricing");
  await prisma.subscription.update({
    where: { organizationId: membership.organizationId },
    data: { tier: "PERSONAL", reportsPerMonth: PRICING.PERSONAL.reportsPerMonth },
  });
  return "PERSONAL tier + privacy off";
}

async function main() {
  const user = await prisma.user.findUnique({ where: { phone: PHONE }, select: { id: true, name: true } });
  if (!user) throw new Error(`User ${PHONE} not found — run \`npm run dummy:seed\` first.`);

  const { reports, results } = await seedReports(user.id);
  const meds = await seedMedications(user.id);
  const meals = await seedMeals(user.id);
  const visits = await seedVisits(user.id);
  const ai = await enableInternetLlm(user.id);

  console.log(
    `[personal-demo] ${user.name ?? PHONE}: ${reports} reports, ${results} results, ` +
    `${meds} medications, ${meals} meals, ${visits} doctor visits (1 upcoming follow-up); ` +
    `AI: ${ai}. Log in as ${PHONE} → /dashboard.`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
