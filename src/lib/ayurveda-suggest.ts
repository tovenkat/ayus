import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { getProviderForUser } from "@/lib/ai/user-provider";
import type { AyurvedicType } from "@prisma/client";

// ─── Input from UI ──────────────────────────────────────────────────────────

export type AyurvedaPreferences = {
  doshaLean: "UNSURE" | "VATA" | "PITTA" | "KAPHA";  // self-reported constitution
  goal: "BALANCE" | "DIGESTION" | "ENERGY" | "SLEEP_STRESS" | "IMMUNITY" | "DETOX";
  intensity: "GENTLE" | "MODERATE";                  // how many items / how active
  avoid?: string;                                    // allergies / dislikes
};

// ─── LLM response schema (permissive) ───────────────────────────────────────

const AYUR_TYPES = ["HERB", "FORMULATION", "THERAPY", "ROUTINE", "DIET", "YOGA_PRANAYAMA", "OTHER"] as const;

const AyurvedicTypeEnum = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const up = v.toUpperCase().replace(/[\s-]+/g, "_");
  if (AYUR_TYPES.includes(up as (typeof AYUR_TYPES)[number])) return up;
  if (up.includes("YOGA") || up.includes("PRANAYAM") || up.includes("BREATH") || up.includes("MEDITAT")) return "YOGA_PRANAYAMA";
  if (up.includes("THERAP") || up.includes("MASSAGE") || up.includes("ABHYANGA") || up.includes("NASYA") || up.includes("PANCHA")) return "THERAPY";
  if (up.includes("ROUTINE") || up.includes("DINACHARYA") || up.includes("LIFESTYLE")) return "ROUTINE";
  if (up.includes("DIET") || up.includes("FOOD") || up.includes("AHARA")) return "DIET";
  if (up.includes("CHURNA") || up.includes("RASAYANA") || up.includes("KWATH") || up.includes("FORMULA") || up.includes("TRIPHALA") || up.includes("CHYAWAN")) return "FORMULATION";
  if (up.includes("HERB") || up.includes("ASHWA") || up.includes("BRAHMI") || up.includes("TULSI") || up.includes("GUDUCHI")) return "HERB";
  return v;
}, z.enum(AYUR_TYPES));

const DoshaEnum = z.preprocess((v) => {
  if (typeof v !== "string") return null;
  const up = v.toUpperCase();
  if (up.includes("TRIDOSH") || up.includes("ALL")) return "TRIDOSHA";
  if (up.includes("VATA")) return "VATA";
  if (up.includes("PITTA")) return "PITTA";
  if (up.includes("KAPHA")) return "KAPHA";
  return null;
}, z.enum(["VATA", "PITTA", "KAPHA", "TRIDOSHA"]).nullable().default(null));

const DayArray = z.preprocess((v) => {
  if (Array.isArray(v)) return v.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [];
}, z.array(z.number().int()));

const NullableStr = z.preprocess(
  (v) => (v === "" || v === "null" || v === undefined ? null : v),
  z.string().nullable().default(null),
);

const SuggestedAyurvedicSchema = z.object({
  ayurvedicType: AyurvedicTypeEnum,
  name: z.string().min(1),                        // "Ashwagandha", "Triphala", "Abhyanga"
  dosha: DoshaEnum,                               // which dosha this pacifies
  dose: NullableStr,                              // "1 tsp", "2 tablets", "500 mg"
  anupana: NullableStr,                           // carrier: warm water, honey, ghee, milk
  timing: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase().replace(/[\s-]+/g, " ").trim() : v),
    z.enum(["before meals", "after meals", "bedtime", "empty stomach"]).nullable().default("after meals"),
  ),
  time: z.string().default("07:00"),              // HH:MM
  daysOfWeek: DayArray.default([]),               // 0=Sun..6=Sat, []=daily
  notes: NullableStr,
  reasoning: z.string().default(""),
}).passthrough();

const AyurvedaPlanSchema = z.object({
  summary: z.string().default(""),
  doshaAssessment: z.string().default(""),         // short read on their likely imbalance
  redFlags: z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []), z.array(z.string())).default([]),
  suggestions: z.array(SuggestedAyurvedicSchema).min(1),
  watchOuts: z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []), z.array(z.string())).default([]),
}).passthrough();

export type AyurvedaPlan = z.infer<typeof AyurvedaPlanSchema>;

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
  const existing = await prisma.ayurvedicSchedule.findMany({ where: { userId, active: true }, select: { name: true, dose: true, time: true } });
  const conditions = (await prisma.user.findUnique({ where: { id: userId }, select: { chronicConditions: true } }))?.chronicConditions ?? [];
  return { outOfRange, recentAll, medications, existing, conditions };
}

// ─── System prompt — Ayurvedic practitioner (integrative) ────────────────────

function buildPrompt(prefs: AyurvedaPreferences): string {
  return `You are an experienced Ayurvedic practitioner (Vaidya) with integrative-medicine training. You design safe, classical-yet-evidence-informed Ayurvedic plans personalized to a person's modern lab results, medications, conditions, and dosha constitution. You are conservative and always frame this as EDUCATIONAL, complementary to — never a replacement for — their medical treatment.

RULES:

── DOSHA READING ──
1. Self-reported lean: ${prefs.doshaLean}. If UNSURE, infer a likely imbalance from the labs/symptoms and say so plainly in doshaAssessment.
2. Map biomarkers to Ayurvedic imbalance heuristically:
   - High glucose/HbA1c, high cholesterol, weight/sluggish metabolism, high TSH → Kapha imbalance (heavy, slow). Favour warming, light, bitter/pungent, kapha-reducing herbs (Guggulu, Triphala, Trikatu), stimulating routines.
   - High inflammation, high uric acid, acidity, high liver enzymes, skin/heat issues, low → Pitta imbalance (heat). Favour cooling, bitter-sweet, pitta-pacifying herbs (Amalaki, Guduchi, Shatavari, Aloe), cooling routines.
   - Low weight, poor sleep, anxiety/stress, constipation, dryness, variable digestion → Vata imbalance (dry, mobile). Favour grounding, warm, unctuous, vata-pacifying herbs (Ashwagandha, Bala, warm sesame Abhyanga), regular routine.
3. Anemia/low B12/low D → nourishing rasayanas (Ashwagandha, Shatavari, Amalaki for iron/vitamin C), warm cooked iron-rich foods; note these complement, not replace, supplementation.

── SAFETY (critical) ──
4. Check medication interactions. On diabetes meds → herbs like Guduchi/bitter melon can add to glucose-lowering; flag "monitor sugars, coordinate with your doctor." On anticoagulants → caution with Guggulu/garlic/high-dose turmeric. On thyroid meds → caution with Ashwagandha/Guggulu; flag. Pregnancy, kidney or liver disease → keep to gentle diet/routine only and defer to a clinician.
5. Never suggest heavy-metal bhasmas or aggressive Panchakarma (Virechana/Basti) remotely; only mention gentle, safe external therapies (Abhyanga, Nasya, Shirodhara) as options to seek from a qualified practitioner.
6. Realistic OTC doses of standardized, widely-available herbs only.

── PREFERENCES ──
7. Goal: ${prefs.goal}. Bias herbs/therapies/routines toward it.
8. Intensity: ${prefs.intensity}. GENTLE → 3–4 items (mostly diet/routine + 1–2 gentle herbs). MODERATE → 5–7 items.
9. Avoid / allergies (verbatim): ${prefs.avoid ?? "none"}. Respect strictly.

── OUTPUT ──
10. Produce ONE plan: 3–7 items across herbs, formulations, therapies, routine (dinacharya), diet (ahara), and yoga/pranayama. Each has ayurvedicType, name, the dosha it pacifies, dose (for ingestibles), anupana (carrier), timing (before meals | after meals | bedtime | empty stomach), a time, and daysOfWeek (0=Sun..6=Sat; [] = daily).
11. For EVERY item, one-sentence reasoning tying it to a biomarker, dosha, or goal (e.g., "Triphala at night — supports digestion and your Kapha lean; may help LDL 165").
12. doshaAssessment: 1–2 sentences on their likely current imbalance. redFlags: urgent biomarker or interaction concerns. watchOuts: precautions + a clear line that this is educational and a qualified Ayurvedic physician and their doctor should guide use.

Return ONLY valid JSON matching this schema. No prose, no markdown fences.
{
  "summary": "One paragraph on the plan's approach.",
  "doshaAssessment": "Likely Kapha-Pitta imbalance given...",
  "redFlags": ["..."],
  "suggestions": [
    {"ayurvedicType":"FORMULATION","name":"Triphala","dosha":"TRIDOSHA","dose":"1 tsp","anupana":"warm water","timing":"bedtime","time":"21:30","daysOfWeek":[],"notes":"Start low.","reasoning":"Supports digestion and your Kapha lean; may help LDL 165."}
  ],
  "watchOuts": ["Educational only — coordinate herbs with your doctor, especially alongside your diabetes medication."]
}
`;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function suggestAyurvedaPlan(userId: string, prefs: AyurvedaPreferences): Promise<AyurvedaPlan> {
  const ctx = await buildHealthContext(userId);

  const userMsg = [
    "Design a personalized Ayurvedic plan for this person.",
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
    "── AYURVEDIC ITEMS THEY ALREADY FOLLOW ──",
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

  console.warn(`[ayurveda-suggest] first attempt failed (provider=${settings.provider}): ${first.reason}`);
  const retry = [
    ...messages,
    { role: "assistant" as const, content: raw },
    { role: "user" as const, content: `Your previous reply was not valid. Problem: ${first.reason}\n\nReturn ONLY a JSON object exactly matching the schema. No prose, no markdown fences.` },
  ];
  raw = (await provider.chat(retry, { temperature: 0.2, num_ctx: 16384 })).content.trim();
  const second = parseAndValidate(raw);
  if (second.ok) return second.data;

  console.error(`[ayurveda-suggest] retry failed (provider=${settings.provider}): ${second.reason}`);
  throw new Error(`AI couldn't produce a valid plan. Try again, or switch to a stronger model in Settings. (${second.reason})`);
}

function parseAndValidate(text: string): { ok: true; data: AyurvedaPlan } | { ok: false; reason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(text)); }
  catch (err) { return { ok: false, reason: `invalid JSON (${err instanceof Error ? err.message : "parse error"})` }; }
  const result = AyurvedaPlanSchema.safeParse(parsed);
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

export type { AyurvedicType };
