import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { getProviderForUser } from "@/lib/ai/user-provider";
import type { SupplementType } from "@prisma/client";

// ─── Input from UI ──────────────────────────────────────────────────────────

export type SupplementPreferences = {
  goal: "GENERAL" | "ENERGY" | "IMMUNITY" | "BONE_JOINT" | "HEART" | "SLEEP_STRESS" | "GUT";
  diet: "OMNIVORE" | "VEGETARIAN" | "VEGAN";
  budget: "LEAN" | "BALANCED" | "COMPREHENSIVE";  // how many to include
  avoid?: string;                                 // allergies / things to skip
};

// ─── LLM response schema (permissive) ───────────────────────────────────────

const SUP_TYPES = ["VITAMIN", "MINERAL", "OMEGA", "PROBIOTIC", "PROTEIN", "HERBAL", "AMINO", "ANTIOXIDANT", "OTHER"] as const;

const SupplementTypeEnum = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const up = v.toUpperCase().replace(/[\s-]+/g, "_");
  if (SUP_TYPES.includes(up as (typeof SUP_TYPES)[number])) return up;
  if (up.includes("VITAMIN") || /^B\d/.test(up) || up.includes("FOLATE") || up.includes("BIOTIN")) return "VITAMIN";
  if (up.includes("OMEGA") || up.includes("FISH") || up.includes("DHA") || up.includes("EPA") || up.includes("FLAX")) return "OMEGA";
  if (up.includes("PROBIOTIC") || up.includes("LACTOBAC")) return "PROBIOTIC";
  if (up.includes("PROTEIN") || up.includes("WHEY") || up.includes("COLLAGEN")) return "PROTEIN";
  if (up.includes("MAGNES") || up.includes("ZINC") || up.includes("IRON") || up.includes("CALCIUM") || up.includes("SELEN")) return "MINERAL";
  if (up.includes("ASHWA") || up.includes("TURMERIC") || up.includes("CURCUM") || up.includes("HERB")) return "HERBAL";
  if (up.includes("AMINO") || up.includes("CREATINE") || up.includes("GLUTAMINE")) return "AMINO";
  if (up.includes("ANTIOX") || up.includes("COQ") || up.includes("GLUTATH")) return "ANTIOXIDANT";
  return v;
}, z.enum(SUP_TYPES));

const DayArray = z.preprocess((v) => {
  if (Array.isArray(v)) return v.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [];
}, z.array(z.number().int()));

const NullableStr = z.preprocess(
  (v) => (v === "" || v === "null" || v === undefined ? null : v),
  z.string().nullable().default(null),
);

const SuggestedSupplementSchema = z.object({
  supplementType: SupplementTypeEnum,
  name: z.string().min(1),                        // "Vitamin D3", "Omega-3"
  dose: NullableStr,                              // "1000 IU", "500 mg"
  form: NullableStr,                              // capsule | tablet | powder | liquid | gummy
  timing: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase().replace(/[\s-]+/g, " ").trim() : v),
    z.enum(["with food", "empty stomach", "bedtime"]).nullable().default("with food"),
  ),
  time: z.string().default("08:00"),              // HH:MM
  daysOfWeek: DayArray.default([]),               // 0=Sun..6=Sat, []=daily
  notes: NullableStr,
  reasoning: z.string().default(""),
}).passthrough();

const SupplementPlanSchema = z.object({
  summary: z.string().default(""),
  redFlags: z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []), z.array(z.string())).default([]),
  suggestions: z.array(SuggestedSupplementSchema).min(1),
  watchOuts: z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []), z.array(z.string())).default([]),
}).passthrough();

export type SupplementPlan = z.infer<typeof SupplementPlanSchema>;

// ─── Health context ─────────────────────────────────────────────────────────

type TestSnippet = { name: string; value: string; unit: string | null; interpretation: string; date: string };

async function buildHealthContext(userId: string) {
  const testResults = await prisma.testResult.findMany({
    where: { userId },
    orderBy: [{ report: { sampleCollectedOn: "desc" } }, { createdAt: "desc" }],
    take: 80,
    select: { normalizedName: true, observedValueRaw: true, observedValueUnit: true, interpretation: true, isOutOfRange: true, createdAt: true },
  });
  const seen = new Set<string>();
  const unique = testResults.filter((t) => {
    const k = t.normalizedName.toLowerCase();
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const toSnippet = (t: (typeof unique)[number]): TestSnippet => ({
    name: t.normalizedName, value: t.observedValueRaw, unit: t.observedValueUnit,
    interpretation: t.interpretation, date: t.createdAt.toISOString().split("T")[0],
  });
  const outOfRange = unique.filter((t) => t.isOutOfRange).map(toSnippet);
  const recentAll = unique.map(toSnippet);
  const medications = await prisma.medication.findMany({ where: { userId, active: true }, select: { name: true, dosage: true, frequency: true } });
  const existing = await prisma.supplementSchedule.findMany({ where: { userId, active: true }, select: { name: true, dose: true, time: true } });
  const conditions = (await prisma.user.findUnique({ where: { id: userId }, select: { chronicConditions: true } }))?.chronicConditions ?? [];
  return { outOfRange, recentAll, medications, existing, conditions };
}

// ─── System prompt — clinical nutritionist ───────────────────────────────────

function buildPrompt(prefs: SupplementPreferences): string {
  return `You are a clinical nutritionist and registered dietitian who designs safe, evidence-based supplement (nutraceutical) plans personalized to a person's lab results, medications, and conditions. You are conservative: supplements support, they don't replace medical care, and you never recommend megadoses or anything that interacts dangerously with the person's medications.

RULES:

── MEDICAL REASONING (tailor to the labs) ──
1. Vitamin D low → Vitamin D3, typical 1000–2000 IU/day maintenance (higher only if deficient and note "as your doctor advises"); pair with Vitamin K2 and take with a fatty meal.
2. Vitamin B12 low → B12 (methylcobalamin); for vegans always include B12.
3. Ferritin / hemoglobin low (iron deficiency) → iron (with vitamin C for absorption, away from tea/coffee/calcium); NEVER suggest iron if iron/ferritin is high.
4. HbA1c / glucose high → consider magnesium, omega-3, and berberine-type support with a clear "discuss with your doctor, especially alongside diabetes meds" note.
5. LDL / triglycerides high → omega-3 (EPA/DHA); note plant sterols and soluble fibre.
6. Magnesium low, cramps, poor sleep, high stress → magnesium glycinate at bedtime.
7. Uric acid high → vitamin C may modestly help; avoid high-dose niacin.
8. Low protein intake / vegetarian / vegan → protein powder and ensure B12, iron, omega-3 (algal for vegans), zinc.
9. Gut issues → a probiotic.
10. On anticoagulants (warfarin etc.) → be very careful with vitamin K, high-dose omega-3, and fish oil — flag interaction and defer to the doctor.
11. Kidney or liver concern (high creatinine / enzymes) → keep it minimal; avoid high-dose anything and flag for medical review.

── PREFERENCES ──
12. Primary goal: ${prefs.goal}. Bias the stack toward it.
13. Diet: ${prefs.diet}. VEGAN → algal omega-3 (not fish oil), ensure B12/iron/zinc; VEGETARIAN → watch B12/iron/omega-3.
14. Depth: ${prefs.budget}. LEAN → 3–4 essentials only. BALANCED → 4–6. COMPREHENSIVE → 6–8, still justified.
15. Avoid / allergies (verbatim): ${prefs.avoid ?? "none"}. Respect strictly.

── OUTPUT ──
16. Produce ONE supplement plan: 3–8 items. Each has supplementType, a clear name, a dose (realistic OTC amount), form, timing (with food | empty stomach | bedtime), a time, and daysOfWeek (0=Sun..6=Sat; [] = daily).
17. For EVERY item, write a one-sentence reasoning citing a biomarker, goal, or diet (e.g., "Vitamin D3 2000 IU — your 25-OH D is 8.8 ng/mL (deficient)").
18. redFlags: urgent biomarker or interaction concerns. watchOuts: absorption tips, spacing from meds, and a reminder that supplements are not a substitute for prescribed treatment.
19. Prefer well-studied, widely-available supplements. Never exceed safe upper limits. When unsure, leave it out and add a "ask your doctor" note.

Return ONLY valid JSON matching this schema. No prose, no markdown fences.
{
  "summary": "One paragraph on the stack's rationale.",
  "redFlags": ["..."],
  "suggestions": [
    {"supplementType":"VITAMIN","name":"Vitamin D3","dose":"2000 IU","form":"capsule","timing":"with food","time":"08:00","daysOfWeek":[],"notes":"Pair with K2.","reasoning":"Your 25-OH Vitamin D is 8.8 ng/mL (deficient)."}
  ],
  "watchOuts": ["Take iron away from tea/coffee and calcium."]
}
`;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function suggestSupplementPlan(userId: string, prefs: SupplementPreferences): Promise<SupplementPlan> {
  const ctx = await buildHealthContext(userId);

  const userMsg = [
    "Design a personalized supplement plan for this person.",
    "",
    "── OUT-OF-RANGE LAB RESULTS (prioritize) ──",
    ctx.outOfRange.length ? ctx.outOfRange.map((t) => `- ${t.name}: ${t.value} ${t.unit ?? ""} [${t.interpretation}] (${t.date})`).join("\n") : "(none)",
    "",
    "── OTHER RECENT LABS (context) ──",
    ctx.recentAll.length ? ctx.recentAll.slice(0, 30).map((t) => `- ${t.name}: ${t.value} ${t.unit ?? ""}`).join("\n") : "(none)",
    "",
    "── ACTIVE MEDICATIONS (check interactions) ──",
    ctx.medications.length ? ctx.medications.map((m) => `- ${m.name}${m.dosage ? ` (${m.dosage})` : ""} ${m.frequency}`).join("\n") : "(none)",
    "",
    "── KNOWN CONDITIONS ──",
    ctx.conditions.length ? ctx.conditions.map((c) => `- ${c}`).join("\n") : "(none)",
    "",
    "── SUPPLEMENTS THEY ALREADY TAKE ──",
    ctx.existing.length ? ctx.existing.map((e) => `- ${e.name}${e.dose ? ` (${e.dose})` : ""} at ${e.time}`).join("\n") : "(none)",
    "",
    "Return ONLY the JSON object.",
  ].join("\n");

  const { provider, settings } = await getProviderForUser(userId, "chat");
  const messages = [
    { role: "system" as const, content: buildPrompt(prefs) },
    { role: "user" as const, content: userMsg },
  ];

  let raw = (await provider.chat(messages, { temperature: 0.4, num_ctx: 16384 })).content.trim();
  const first = parseAndValidate(raw);
  if (first.ok) return first.data;

  console.warn(`[supplement-suggest] first attempt failed (provider=${settings.provider}): ${first.reason}`);
  const retry = [
    ...messages,
    { role: "assistant" as const, content: raw },
    { role: "user" as const, content: `Your previous reply was not valid. Problem: ${first.reason}\n\nReturn ONLY a JSON object exactly matching the schema. No prose, no markdown fences.` },
  ];
  raw = (await provider.chat(retry, { temperature: 0.2, num_ctx: 16384 })).content.trim();
  const second = parseAndValidate(raw);
  if (second.ok) return second.data;

  console.error(`[supplement-suggest] retry failed (provider=${settings.provider}): ${second.reason}`);
  throw new Error(`AI couldn't produce a valid plan. Try again, or switch to a stronger model in Settings. (${second.reason})`);
}

function parseAndValidate(text: string): { ok: true; data: SupplementPlan } | { ok: false; reason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(text)); }
  catch (err) { return { ok: false, reason: `invalid JSON (${err instanceof Error ? err.message : "parse error"})` }; }
  const result = SupplementPlanSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    return { ok: false, reason: `schema mismatch — ${detail}` };
  }
  return { ok: true, data: result.data };
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}

export type { SupplementType };
