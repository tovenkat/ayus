import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { getProviderForUser } from "@/lib/ai/user-provider";
import type { ExerciseType } from "@prisma/client";

// ─── Input from UI ──────────────────────────────────────────────────────────

export type ExercisePreferences = {
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  goal: "GENERAL" | "WEIGHT_LOSS" | "STRENGTH" | "ENDURANCE" | "MOBILITY";
  daysPerWeek: number;            // 2–7
  equipment: "NONE" | "HOME" | "GYM";
  minutesPerSession?: number | null;
  limitations?: string;           // free-text injuries / constraints
};

// ─── LLM response schema (permissive, tolerant of drift) ────────────────────

const EX_TYPES = ["CARDIO", "STRENGTH", "FLEXIBILITY", "BALANCE", "YOGA", "WALK", "SPORT", "REST"] as const;

const ExerciseTypeEnum = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const up = v.toUpperCase().replace(/[\s-]+/g, "_");
  if (EX_TYPES.includes(up as (typeof EX_TYPES)[number])) return up;
  if (up.includes("WALK") || up.includes("JOG")) return "WALK";
  if (up.includes("RUN") || up.includes("CYCL") || up.includes("SWIM") || up.includes("CARDIO") || up.includes("HIIT")) return "CARDIO";
  if (up.includes("STRENGTH") || up.includes("WEIGHT") || up.includes("RESIST")) return "STRENGTH";
  if (up.includes("YOGA")) return "YOGA";
  if (up.includes("STRETCH") || up.includes("FLEX") || up.includes("MOBIL")) return "FLEXIBILITY";
  if (up.includes("BALANCE")) return "BALANCE";
  if (up.includes("REST")) return "REST";
  return v;
}, z.enum(EX_TYPES));

const NullableInt = z.preprocess((v) => {
  if (v === null || v === undefined || v === "" || v === "null") return null;
  if (typeof v === "string") { const n = parseInt(v.replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : null; }
  if (typeof v === "number") return Math.round(v);
  return null;
}, z.number().int().nullable());

const StringArray = z.preprocess((v) => {
  if (v == null) return [];
  if (typeof v === "string") return v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}, z.array(z.string()));

const DayArray = z.preprocess((v) => {
  if (Array.isArray(v)) return v.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [];
}, z.array(z.number().int()));

const SuggestedWorkoutSchema = z.object({
  exerciseType: ExerciseTypeEnum,
  name: z.string().min(1),                       // "Brisk walk", "Upper-body strength"
  time: z.string().default("07:00"),             // HH:MM
  durationMin: NullableInt,
  intensity: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["low", "moderate", "vigorous"]).nullable().default("moderate")),
  targetAreas: StringArray.default([]),
  daysOfWeek: DayArray.default([]),              // 0=Sun..6=Sat
  notes: z.preprocess((v) => (v === "" || v === "null" ? null : v), z.string().nullable().default(null)),
  reasoning: z.string().default(""),
}).passthrough();

const ExercisePlanSchema = z.object({
  summary: z.string().default(""),
  redFlags: StringArray.default([]),
  suggestions: z.array(SuggestedWorkoutSchema).min(1),
  watchOuts: StringArray.default([]),
}).passthrough();

export type ExercisePlan = z.infer<typeof ExercisePlanSchema>;

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
  const existing = await prisma.exerciseSchedule.findMany({ where: { userId, active: true }, select: { exerciseType: true, name: true, time: true } });
  const conditions = (await prisma.user.findUnique({ where: { id: userId }, select: { chronicConditions: true } }))?.chronicConditions ?? [];
  return { outOfRange, recentAll, medications, existing, conditions };
}

// ─── System prompt — clinical exercise physiologist ──────────────────────────

function buildPrompt(prefs: ExercisePreferences): string {
  return `You are a clinical exercise physiologist and certified fitness coach who designs safe, evidence-based weekly workout plans personalized to a person's lab results, medications, and conditions. You understand how exercise interacts with metabolic, cardiac, and musculoskeletal health.

RULES:

── MEDICAL REASONING (tailor to the labs) ──
1. HbA1c / fasting glucose high → prioritize regular aerobic work (brisk walking, cycling) 150+ min/week PLUS 2× resistance training; both improve insulin sensitivity. Encourage a short post-meal walk.
2. LDL / total cholesterol / triglycerides high → emphasize moderate-to-vigorous aerobic exercise most days; note that consistency lowers lipids.
3. Blood pressure concern / on BP meds → steady-state cardio, avoid heavy breath-holding (Valsalva) on strength; warm up and cool down.
4. Uric acid high / gout risk → keep sessions well-hydrated, avoid sudden very-vigorous efforts that can trigger flares; low-impact is safer.
5. Low hemoglobin / anemia → keep intensity gentler, watch for undue fatigue/breathlessness, favor walking + light strength.
6. Vitamin D low / bone concern → include weight-bearing and light resistance for bone density, plus some outdoor daytime activity.
7. Elevated cardiac markers (troponin, CK-MB) or chest-pain history → DO NOT prescribe vigorous exercise; recommend medical clearance first and keep to light movement.
8. Very high creatinine / kidney concern → keep it light-to-moderate; avoid extreme exertion and dehydration.

── PREFERENCES ──
9. Fitness level: ${prefs.level}. Scale volume and intensity to it — beginners start low and build.
10. Primary goal: ${prefs.goal}. Bias the mix accordingly (weight loss → more cardio + a caloric-honest note; strength → progressive resistance; endurance → longer aerobic; mobility → yoga/flexibility).
11. Train ${prefs.daysPerWeek} days per week. Spread muscle groups; include at least one REST or active-recovery day; never schedule heavy strength for the same muscle group two days running.
12. Equipment: ${prefs.equipment}. NONE → bodyweight/walking/yoga only. HOME → add bands/dumbbells. GYM → machines/free weights allowed.
13. ${prefs.minutesPerSession ? `Target about ${prefs.minutesPerSession} minutes per session.` : "Use realistic session lengths (20–45 min)."}
14. Limitations / injuries (verbatim): ${prefs.limitations ?? "none"}. Respect these strictly — offer safe substitutions.

── OUTPUT ──
15. Produce ONE weekly plan: 4–8 sessions across the week. Each has exerciseType, a clear name, a time, durationMin, intensity (low|moderate|vigorous), targetAreas, and daysOfWeek (0=Sun..6=Sat).
16. For EVERY session, write a one-sentence reasoning citing a biomarker, goal, or condition (e.g., "Brisk walk 5×/week — improves your HbA1c 6.1% and LDL 145").
17. redFlags: urgent biomarker concerns that change the plan (e.g., "Elevated CK — avoid vigorous training until cleared"). watchOuts: precautions (hydration, warm-up, med timing).
18. Never prescribe beyond what the labs make safe. When in doubt, keep it lighter and add a "check with your doctor" note.

Return ONLY valid JSON matching this schema. No prose, no markdown fences.
{
  "summary": "One paragraph on the week's strategy.",
  "redFlags": ["..."],
  "suggestions": [
    {"exerciseType":"WALK","name":"Brisk morning walk","time":"07:00","durationMin":30,"intensity":"moderate","targetAreas":["cardio","legs"],"daysOfWeek":[1,2,3,4,5],"notes":"Post-breakfast is fine.","reasoning":"Aerobic base for your HbA1c 6.1% and LDL 145."}
  ],
  "watchOuts": ["Warm up 5 min; hydrate — your uric acid is borderline."]
}
`;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function suggestExercisePlan(userId: string, prefs: ExercisePreferences): Promise<ExercisePlan> {
  const ctx = await buildHealthContext(userId);

  const userMsg = [
    "Design a personalized weekly workout plan for this person.",
    "",
    "── OUT-OF-RANGE LAB RESULTS (prioritize) ──",
    ctx.outOfRange.length ? ctx.outOfRange.map((t) => `- ${t.name}: ${t.value} ${t.unit ?? ""} [${t.interpretation}] (${t.date})`).join("\n") : "(none)",
    "",
    "── OTHER RECENT LABS (context) ──",
    ctx.recentAll.length ? ctx.recentAll.slice(0, 30).map((t) => `- ${t.name}: ${t.value} ${t.unit ?? ""}`).join("\n") : "(none)",
    "",
    "── ACTIVE MEDICATIONS ──",
    ctx.medications.length ? ctx.medications.map((m) => `- ${m.name}${m.dosage ? ` (${m.dosage})` : ""} ${m.frequency}`).join("\n") : "(none)",
    "",
    "── KNOWN CONDITIONS ──",
    ctx.conditions.length ? ctx.conditions.map((c) => `- ${c}`).join("\n") : "(none)",
    "",
    "── EXISTING WORKOUTS THEY ALREADY DO ──",
    ctx.existing.length ? ctx.existing.map((e) => `- ${e.exerciseType} at ${e.time}: ${e.name}`).join("\n") : "(none)",
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

  console.warn(`[exercise-suggest] first attempt failed (provider=${settings.provider}): ${first.reason}`);
  const retry = [
    ...messages,
    { role: "assistant" as const, content: raw },
    { role: "user" as const, content: `Your previous reply was not valid. Problem: ${first.reason}\n\nReturn ONLY a JSON object exactly matching the schema. No prose, no markdown fences.` },
  ];
  raw = (await provider.chat(retry, { temperature: 0.2, num_ctx: 16384 })).content.trim();
  const second = parseAndValidate(raw);
  if (second.ok) return second.data;

  console.error(`[exercise-suggest] retry failed (provider=${settings.provider}): ${second.reason}`);
  throw new Error(`AI couldn't produce a valid plan. Try again, or switch to a stronger model in Settings. (${second.reason})`);
}

function parseAndValidate(text: string): { ok: true; data: ExercisePlan } | { ok: false; reason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(text)); }
  catch (err) { return { ok: false, reason: `invalid JSON (${err instanceof Error ? err.message : "parse error"})` }; }
  const result = ExercisePlanSchema.safeParse(parsed);
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

export type { ExerciseType };
