import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { getProviderForUser } from "@/lib/ai/user-provider";
import type { MealType } from "@prisma/client";

// ─── Input shape from UI ────────────────────────────────────────────────────

export type DietPreferences = {
  diet: "VEGETARIAN" | "EGGETARIAN" | "NON_VEG" | "JAIN" | "VEGAN";
  region: "SOUTH" | "NORTH" | "EAST" | "WEST" | "ANY";
  avoid?: string; // free-text allergies / dislikes
  goalKcal?: number | null;
};

// ─── LLM response schema ────────────────────────────────────────────────────

// ── Permissive helpers that tolerate common LLM drift ──

const MEAL_TYPES = [
  "BREAKFAST",
  "MORNING_SNACK",
  "LUNCH",
  "AFTERNOON_SNACK",
  "DINNER",
  "EVENING_SNACK",
] as const;

const MealTypeEnum = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const up = v.toUpperCase().replace(/[\s-]+/g, "_");
  if (MEAL_TYPES.includes(up as (typeof MEAL_TYPES)[number])) return up;
  // Common aliases
  if (up === "SNACK") return "MORNING_SNACK";
  if (up.startsWith("BREAKFAST")) return "BREAKFAST";
  if (up.startsWith("LUNCH")) return "LUNCH";
  if (up.startsWith("DINNER") || up === "SUPPER") return "DINNER";
  if (up.includes("MORNING")) return "MORNING_SNACK";
  if (up.includes("AFTERNOON") || up.includes("TEA")) return "AFTERNOON_SNACK";
  if (up.includes("EVENING") || up.includes("NIGHT")) return "EVENING_SNACK";
  return v;
}, z.enum(MEAL_TYPES));

const NullableString = z.preprocess(
  (v) => (v === "" || v === "null" || v === null || v === undefined ? null : v),
  z.string().nullable(),
);

const NullableInt = z.preprocess((v) => {
  if (v === null || v === undefined || v === "" || v === "null") return null;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "number") return Math.round(v);
  return null;
}, z.number().int().nullable());

const StringArray = z.preprocess((v) => {
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}, z.array(z.string()));

const SuggestedMealSchema = z.object({
  mealType: MealTypeEnum,
  time: z.string().default("08:00"), // HH:MM
  items: z.string().min(1), // "2 ragi dosa + coconut chutney + sambhar"
  calories: NullableInt,
  restrictions: StringArray.default([]),
  notes: NullableString.default(null),
  reasoning: z.string().default(""), // "Ragi has low GI — your HbA1c is 6.8"
}).passthrough();

const DietPlanSchema = z.object({
  summary: z.string().default(""),
  redFlags: StringArray.default([]),
  suggestions: z.array(SuggestedMealSchema).min(1),
  watchOuts: StringArray.default([]),
}).passthrough();

export type DietPlan = z.infer<typeof DietPlanSchema>;

// ─── Build context from user's health record ────────────────────────────────

type TestSnippet = {
  name: string;
  value: string;
  unit: string | null;
  interpretation: string;
  referenceRange: string | null;
  date: string;
};

async function buildHealthContext(userId: string): Promise<{
  outOfRange: TestSnippet[];
  recentAll: TestSnippet[];
  medications: { name: string; dosage: string | null; frequency: string }[];
  existingMeals: { mealType: MealType; time: string; items: string }[];
}> {
  const testResults = await prisma.testResult.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      normalizedName: true,
      observedValueRaw: true,
      observedValueUnit: true,
      referenceIntervalRaw: true,
      interpretation: true,
      isOutOfRange: true,
      createdAt: true,
    },
  });

  const toSnippet = (t: (typeof testResults)[number]): TestSnippet => ({
    name: t.normalizedName,
    value: t.observedValueRaw,
    unit: t.observedValueUnit,
    interpretation: t.interpretation,
    referenceRange: t.referenceIntervalRaw,
    date: t.createdAt.toISOString().split("T")[0],
  });

  // Dedupe by test name, keep the most recent reading per biomarker
  const seenNames = new Set<string>();
  const unique: typeof testResults = [];
  for (const t of testResults) {
    if (seenNames.has(t.normalizedName.toLowerCase())) continue;
    seenNames.add(t.normalizedName.toLowerCase());
    unique.push(t);
  }

  const outOfRange = unique.filter((t) => t.isOutOfRange).map(toSnippet);
  const recentAll = unique.map(toSnippet);

  const medications = await prisma.medication.findMany({
    where: { userId, active: true },
    select: { name: true, dosage: true, frequency: true },
  });

  const existingMeals = await prisma.dietSchedule.findMany({
    where: { userId, active: true },
    select: { mealType: true, time: true, items: true },
  });

  return { outOfRange, recentAll, medications, existingMeals };
}

// ─── System prompt — Indian dietician persona ───────────────────────────────

function buildPrompt(prefs: DietPreferences): string {
  return `You are an Indian-qualified clinical dietician with deep knowledge of regional Indian cuisine (South, North, East, West), Ayurvedic meal principles, and evidence-based modern nutrition. Your task is to design a one-day meal plan personalized to the user's lab results and medications.

RULES:

── MEDICAL REASONING ──
1. Read every lab result. Flag the out-of-range ones and pick ingredients that directly address them:
   • HbA1c high (>5.6) → low-GI grains: ragi, bajra, jowar, steel-cut oats. Avoid white rice, maida, sugar, jaggery in large amounts.
   • LDL / Total Cholesterol high → oats, soaked almonds, flaxseed, avoid ghee-heavy fried items.
   • Uric acid high → avoid red meat, organ meats, dal-heavy (esp. urad), spinach, mushroom.
   • Creatinine high / low eGFR → moderate protein, low-sodium, avoid processed foods, limit dal.
   • Vitamin D low → add egg yolk (if eggetarian+), fortified milk, sun-dried shiitake, fatty fish (if non-veg).
   • Vitamin B12 low → add curd, paneer, eggs, fortified nutritional yeast. If vegan, strongly recommend supplementation.
   • Hemoglobin low → add green leafy veg (palak, methi), jaggery (in moderation), dates, ragi.
   • TSH high (hypothyroid) → avoid excess soy, raw cruciferous (cabbage/cauliflower raw). Cooked is fine.
   • Thyroid medication interaction: instruct to take thyroxine 1 hour before breakfast.
2. Cross-reference medications:
   • Statins → avoid grapefruit.
   • Metformin → ensure regular, non-fasting meals; include B12-rich foods.
   • Warfarin → consistent vitamin K intake (don't suddenly increase/decrease greens).
   • Blood pressure meds → low-sodium, watch potassium if ACE inhibitor/ARB.

── CUISINE & CULTURE ──
3. User's diet preference: ${prefs.diet}. Never suggest forbidden items.
   • VEGETARIAN: no meat, no fish, no eggs.
   • EGGETARIAN: vegetarian + eggs allowed.
   • NON_VEG: everything allowed.
   • JAIN: no root vegetables (onion, garlic, potato, radish, carrot, beet). No eggs, no meat, no honey.
   • VEGAN: no dairy, no eggs, no honey, no meat.
4. User's region: ${prefs.region}. Favor that region's familiar dishes but mix in variety.
   • SOUTH: idli, dosa, upma, pongal, sambhar, rasam, curd rice, ragi mudde.
   • NORTH: roti, paratha, dal tadka, sabzi, curd, poha, upma, khichdi.
   • EAST: rice, dal, luchi (limit), shorshe maach (NV), begun bhaja.
   • WEST: thepla, dhokla, poha, methi muthia, khichdi, undhiyu.
5. User allergies / dislikes (verbatim): ${prefs.avoid ?? "none"}. Avoid these strictly.

── SCHEDULE ──
6. Propose 4–6 meals at typical Indian timings:
   • Breakfast 07:30–09:00
   • Morning snack 10:30–11:00 (optional — only if caloric goal needs it)
   • Lunch 12:30–13:30
   • Afternoon tea 16:00–16:30 (optional)
   • Dinner 19:30–20:30
   • Late evening (only if patient is hypoglycemia-prone or diabetic on insulin)
7. Keep portions realistic in Indian units (katoris, chapatis, rotis). Write items like: "2 ragi rotis + 1 katori palak sabzi + 1 katori dal + 1 small bowl curd".
8. ${prefs.goalKcal ? `Target approximately ${prefs.goalKcal} kcal across the day.` : "Estimate kcal per meal; aim for 1800–2000 kcal/day unless the user's weight/BMI data suggests otherwise."}

── REASONING ──
9. For EVERY suggestion, write a one-sentence reasoning that directly cites a biomarker, medication, or cuisine rationale. Examples:
   • "Ragi dosa chosen because HbA1c is 6.8% — low GI grain."
   • "Skipping ghee-laden paratha because LDL is 165 mg/dL."
   • "Paneer over tofu — you're NORTH vegetarian and paneer is culturally default."
10. Output "redFlags" for urgent biomarker concerns (e.g., HbA1c >7, creatinine >1.4).
11. Output "watchOuts" for drug-food interactions.

── OUTPUT FORMAT ──
Return ONLY valid JSON matching this schema. No prose outside JSON. No markdown code fences.

{
  "summary": "One paragraph describing the overall strategy for today.",
  "redFlags": ["HbA1c 6.8% — pre-diabetic range, prioritize low-GI"],
  "suggestions": [
    {
      "mealType": "BREAKFAST",
      "time": "08:00",
      "items": "2 ragi dosa + 1 bowl coconut chutney + 1 bowl sambhar",
      "calories": 420,
      "restrictions": ["diabetic", "low-gi"],
      "notes": "Skip the sugar in filter coffee today.",
      "reasoning": "Ragi has GI ~55 — appropriate for your HbA1c 6.8%."
    }
  ],
  "watchOuts": ["Take thyroxine 1 hour before breakfast; avoid calcium within 4 hours."]
}
`;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function suggestDietPlan(userId: string, prefs: DietPreferences): Promise<DietPlan> {
  const context = await buildHealthContext(userId);

  const userMsg = [
    "Generate a one-day diet plan for this user.",
    "",
    "── OUT-OF-RANGE LAB RESULTS (prioritize these) ──",
    context.outOfRange.length > 0
      ? context.outOfRange.map((t) => `- ${t.name}: ${t.value} ${t.unit ?? ""} [${t.interpretation}] ref: ${t.referenceRange ?? "?"} (${t.date})`).join("\n")
      : "(none)",
    "",
    "── OTHER RECENT LAB RESULTS (context) ──",
    context.recentAll.length > 0
      ? context.recentAll.slice(0, 30).map((t) => `- ${t.name}: ${t.value} ${t.unit ?? ""}`).join("\n")
      : "(none)",
    "",
    "── ACTIVE MEDICATIONS ──",
    context.medications.length > 0
      ? context.medications.map((m) => `- ${m.name}${m.dosage ? ` (${m.dosage})` : ""} ${m.frequency}`).join("\n")
      : "(none)",
    "",
    "── EXISTING MEALS THE USER ALREADY FOLLOWS ──",
    context.existingMeals.length > 0
      ? context.existingMeals.map((m) => `- ${m.mealType} at ${m.time}: ${m.items}`).join("\n")
      : "(none)",
    "",
    "Return ONLY the JSON object.",
  ].join("\n");

  const { provider, settings } = await getProviderForUser(userId, "chat");
  const systemPrompt = buildPrompt(prefs);

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMsg },
  ];

  let response = await provider.chat(messages, { temperature: 0.3, num_ctx: 16384 });
  let rawContent = response.content.trim();

  const firstAttempt = parseAndValidate(rawContent);
  if (firstAttempt.ok) return firstAttempt.data;

  console.warn(`[diet-suggest] First attempt failed (provider=${settings.provider}): ${firstAttempt.reason}`);
  console.warn(`[diet-suggest] Raw (first 600 chars):`, rawContent.slice(0, 600));

  // One self-correcting retry — feed the error back to the model
  const retryMessages = [
    ...messages,
    { role: "assistant" as const, content: rawContent },
    {
      role: "user" as const,
      content: `Your previous reply was not valid. Problem: ${firstAttempt.reason}\n\nReturn ONLY a JSON object exactly matching the schema I described. No prose, no markdown fences.`,
    },
  ];
  response = await provider.chat(retryMessages, { temperature: 0.2, num_ctx: 16384 });
  rawContent = response.content.trim();

  const second = parseAndValidate(rawContent);
  if (second.ok) return second.data;

  console.error(`[diet-suggest] Retry failed (provider=${settings.provider}): ${second.reason}`);
  console.error(`[diet-suggest] Raw retry (first 600 chars):`, rawContent.slice(0, 600));
  throw new Error(`AI couldn't produce a valid plan. Try again, or switch to a stronger model in Settings. (${second.reason})`);
}

function parseAndValidate(text: string): { ok: true; data: DietPlan } | { ok: false; reason: string } {
  const jsonText = extractJson(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, reason: `invalid JSON (${err instanceof Error ? err.message : "parse error"})` };
  }

  const result = DietPlanSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `schema mismatch — ${detail}` };
  }
  return { ok: true, data: result.data };
}

function extractJson(text: string): string {
  // Strip markdown fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find outermost { ... }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}
