import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { getProviderForUser } from "@/lib/ai/user-provider";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BiomarkerReading = {
  name: string;
  latest: { value: string; unit: string | null; interpretation: string; date: string };
  previous: { value: string; date: string } | null;
  trend: "improving" | "worsening" | "stable" | "unknown";
  isOutOfRange: boolean;
  referenceLow: number | null;
  referenceHigh: number | null;
  /** Last 10 numeric readings, chronological order. Empty if no numerics. */
  history: { date: string; value: number }[];
};

export type VisitPrep = {
  generatedAt: string; // ISO
  // AI-generated narrative sections
  headline: string;
  narrativeSummary: string;
  redFlags: string[];
  questionsToAsk: string[];
  // Deterministic sections computed from DB
  activeMedications: { name: string; dosage: string | null; frequency: string; notes?: string | null }[];
  recentBiomarkers: BiomarkerReading[];
  outOfRangeBiomarkers: BiomarkerReading[];
  activeDiet: { mealType: string; time: string; items: string }[];
  lastVisit: { date: string; doctorName: string | null; summary: string | null } | null;
};

// ─── Schema for the LLM output (narrative parts only) ────────────────────────

const NarrativeSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  redFlags: z.array(z.string()).default([]),
  questionsToAsk: z.array(z.string()).default([]),
}).passthrough();

// ─── Helpers ────────────────────────────────────────────────────────────────

function iso(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Compare two numeric test readings to classify the trend. */
function classifyTrend(
  latest: { numeric: number | null; outOfRange: boolean; interpretation: string },
  previous: { numeric: number | null; outOfRange: boolean; interpretation: string } | null,
): BiomarkerReading["trend"] {
  if (!previous) return "unknown";
  if (latest.numeric === null || previous.numeric === null) {
    // Fall back to interpretation comparison
    if (!latest.outOfRange && previous.outOfRange) return "improving";
    if (latest.outOfRange && !previous.outOfRange) return "worsening";
    return "stable";
  }
  const delta = latest.numeric - previous.numeric;
  const absPct = Math.abs(delta / (previous.numeric || 1));
  if (absPct < 0.05) return "stable";
  // Direction of "worse" depends on whether the test is currently out of range
  if (latest.outOfRange && !previous.outOfRange) return "worsening";
  if (!latest.outOfRange && previous.outOfRange) return "improving";
  // Both same flag — use numeric distance from reference
  return "stable";
}

async function buildBiomarkerHistory(userId: string): Promise<BiomarkerReading[]> {
  // Use the LATEST reading per biomarker regardless of age — a report uploaded
  // for an old test date (e.g. a 2022 lab) is still the patient's most recent
  // data and must not be hidden by a recency window. Order by report date so
  // the grouping below picks the genuinely latest reading.
  const results = await prisma.testResult.findMany({
    where: { userId },
    orderBy: [
      { report: { sampleCollectedOn: "desc" } },
      { createdAt: "desc" },
    ],
    take: 500,
    include: { report: { select: { sampleCollectedOn: true, createdAt: true } } },
  });

  // Group by biomarker name (most recent first)
  const grouped = new Map<string, typeof results>();
  for (const r of results) {
    const key = r.normalizedName.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const readings: BiomarkerReading[] = [];
  for (const rows of grouped.values()) {
    if (rows.length === 0) continue;
    const latest = rows[0];
    const previous = rows[1] ?? null;

    const dateFor = (x: (typeof rows)[number]) =>
      x.report?.sampleCollectedOn
        ? iso(x.report.sampleCollectedOn)
        : iso(x.report?.createdAt ?? x.createdAt);

    // Pull last 10 numeric readings in chronological order (for sparkline)
    const history = rows
      .filter((r) => r.observedValueNumeric !== null)
      .slice(0, 10)
      .reverse()
      .map((r) => ({
        date: dateFor(r),
        value: r.observedValueNumeric as number,
      }));

    // Reference range: use the most recent reading that has numeric bounds
    const refRow = rows.find((r) => r.referenceLow !== null || r.referenceHigh !== null);

    readings.push({
      name: latest.normalizedName,
      latest: {
        value: latest.observedValueRaw,
        unit: latest.observedValueUnit,
        interpretation: latest.interpretation,
        date: dateFor(latest),
      },
      previous: previous
        ? { value: previous.observedValueRaw, date: dateFor(previous) }
        : null,
      trend: classifyTrend(
        { numeric: latest.observedValueNumeric, outOfRange: latest.isOutOfRange, interpretation: latest.interpretation },
        previous
          ? { numeric: previous.observedValueNumeric, outOfRange: previous.isOutOfRange, interpretation: previous.interpretation }
          : null,
      ),
      isOutOfRange: latest.isOutOfRange,
      referenceLow: refRow?.referenceLow ?? null,
      referenceHigh: refRow?.referenceHigh ?? null,
      history,
    });
  }

  return readings;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function generateVisitPrep(userId: string): Promise<VisitPrep> {
  const [biomarkers, meds, diet, lastNote] = await Promise.all([
    buildBiomarkerHistory(userId),
    prisma.medication.findMany({
      where: { userId, active: true },
      select: { name: true, dosage: true, frequency: true, notes: true },
    }),
    prisma.dietSchedule.findMany({
      where: { userId, active: true },
      orderBy: { time: "asc" },
      select: { mealType: true, time: true, items: true },
    }),
    prisma.doctorNote.findFirst({
      where: { userId },
      orderBy: { visitDate: "desc" },
      select: { visitDate: true, doctorName: true, notes: true, diagnosis: true },
    }),
  ]);

  const outOfRange = biomarkers.filter((b) => b.isOutOfRange);
  const recent = biomarkers.slice(0, 25); // cap for prompt

  // Build prompt with the computed data; ask the AI only for narrative + questions
  const userMsg = [
    "Generate a clinical visit-prep for this patient to take into their next doctor appointment.",
    "",
    "── OUT-OF-RANGE BIOMARKERS ──",
    outOfRange.length > 0
      ? outOfRange.map((b) => `- ${b.name}: ${b.latest.value} ${b.latest.unit ?? ""} [${b.latest.interpretation}] — trend: ${b.trend}${b.previous ? ` (prev ${b.previous.value} on ${b.previous.date})` : ""}`).join("\n")
      : "(none)",
    "",
    "── OTHER RECENT BIOMARKERS (context) ──",
    recent.filter((b) => !b.isOutOfRange).slice(0, 15).map((b) => `- ${b.name}: ${b.latest.value} ${b.latest.unit ?? ""}`).join("\n") || "(none)",
    "",
    "── ACTIVE MEDICATIONS ──",
    meds.length > 0
      ? meds.map((m) => `- ${m.name}${m.dosage ? ` (${m.dosage})` : ""} ${m.frequency}${m.notes ? ` — ${m.notes}` : ""}`).join("\n")
      : "(none)",
    "",
    "── LAST DOCTOR VISIT ──",
    lastNote
      ? `${iso(lastNote.visitDate)} — Dr. ${lastNote.doctorName ?? "Unknown"}: ${lastNote.diagnosis ?? lastNote.notes ?? "(no summary)"}`
      : "(no prior note on record)",
    "",
    "Return ONLY JSON matching this schema:",
    `{
  "headline": "string — one-line status for the doctor to read in 3 seconds",
  "summary": "string — 2-3 paragraph clinical narrative covering what has changed since the last visit, key concerns, and current medication context. Written for the doctor, not the patient.",
  "redFlags": ["string[] — urgent findings worth flagging at the top"],
  "questionsToAsk": ["string[] — 4-6 specific questions the patient should ask their doctor based on these biomarkers + meds. Indian healthcare context."]
}`,
    "",
    "Rules:",
    "- Do NOT diagnose. Describe what the record shows.",
    "- Do NOT invent biomarker values.",
    "- If there's a medication-food or medication-medication concern (e.g., statins + high triglycerides, thyroxine + calcium), surface it in redFlags or questionsToAsk.",
    "- Indian cultural context: use terms a patient in India would understand, acknowledge South Asian elevated-risk considerations for diabetes/heart.",
  ].join("\n");

  const systemPrompt = `You are a clinical assistant preparing a one-page visit-prep document for a patient in India. Your output will be shown to the patient and their doctor. Be concise, specific, and non-alarmist. Every claim must trace to data provided. No diagnosis, only observations.`;

  const { provider } = await getProviderForUser(userId, "chat");
  const response = await provider.chat(
    [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMsg },
    ],
    { temperature: 0.3, num_ctx: 16384 },
  );

  const narrative = parseNarrative(response.content);

  return {
    generatedAt: new Date().toISOString(),
    headline: narrative.headline,
    narrativeSummary: narrative.summary,
    redFlags: narrative.redFlags,
    questionsToAsk: narrative.questionsToAsk,
    activeMedications: meds,
    recentBiomarkers: recent,
    outOfRangeBiomarkers: outOfRange,
    activeDiet: diet,
    lastVisit: lastNote
      ? { date: iso(lastNote.visitDate), doctorName: lastNote.doctorName, summary: lastNote.diagnosis ?? lastNote.notes }
      : null,
  };
}

function parseNarrative(raw: string): {
  headline: string;
  summary: string;
  redFlags: string[];
  questionsToAsk: string[];
} {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  const json = first >= 0 && last > first ? candidate.slice(first, last + 1) : candidate;

  try {
    const parsed = NarrativeSchema.parse(JSON.parse(json));
    return {
      headline: parsed.headline,
      summary: parsed.summary,
      redFlags: parsed.redFlags,
      questionsToAsk: parsed.questionsToAsk,
    };
  } catch {
    return {
      headline: "Visit prep generated — AI narrative unavailable.",
      summary: "The AI model couldn't produce a structured summary. The data sections below are still accurate.",
      redFlags: [],
      questionsToAsk: [],
    };
  }
}
