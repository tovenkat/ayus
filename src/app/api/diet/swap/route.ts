import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getProviderForUser } from "@/lib/ai/user-provider";

const BodySchema = z.object({
  mealType: z.enum(["BREAKFAST", "MORNING_SNACK", "LUNCH", "AFTERNOON_SNACK", "DINNER", "EVENING_SNACK"]),
  currentItems: z.string().min(1),
  diet: z.enum(["VEGETARIAN", "EGGETARIAN", "NON_VEG", "JAIN", "VEGAN"]).default("VEGETARIAN"),
  region: z.enum(["SOUTH", "NORTH", "EAST", "WEST", "ANY"]).default("ANY"),
  avoid: z.string().optional(),
});

const AlternativeSchema = z.object({
  items: z.string(),
  calories: z.number().int().nullable().optional(),
  restrictions: z.array(z.string()).default([]),
  reasoning: z.string(),
}).passthrough();

const ResponseSchema = z.object({
  alternatives: z.array(AlternativeSchema).min(1),
}).passthrough();

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  // Pull a slim health context so the swaps are actually personalized
  const [oor, meds] = await Promise.all([
    prisma.testResult.findMany({
      where: { userId, isOutOfRange: true },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { normalizedName: true, observedValueRaw: true, observedValueUnit: true, interpretation: true },
    }),
    prisma.medication.findMany({
      where: { userId, active: true },
      select: { name: true },
    }),
  ]);

  // Dedupe biomarkers
  const seen = new Set<string>();
  const uniqueOor = oor.filter((t) => {
    const k = t.normalizedName.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const system = `You are an Indian-qualified clinical dietician. Suggest 4 varied alternatives for a single meal. Rotate across different grain bases, cuisines, and preparations. Avoid anything the user just ate (listed under "current"). Return ONLY JSON.

Diet preference: ${body.diet}. Regional cuisine: ${body.region}. Allergies/dislikes: ${body.avoid ?? "none"}.

Rules:
- Each alternative must be meaningfully different from the others (different grain, protein, or preparation).
- Use Indian portion language (katori, roti count, bowl, glass).
- Tie each reasoning to a biomarker or a general cuisine rotation rule.
- JAIN: no root vegetables, no eggs, no meat. NON_VEG: anything. VEGETARIAN: no meat/fish/eggs. EGGETARIAN: vegetarian + eggs. VEGAN: no dairy, eggs, honey.`;

  const userMsg = [
    "── CONTEXT ──",
    uniqueOor.length > 0
      ? `Out-of-range biomarkers: ${uniqueOor.map((t) => `${t.normalizedName} ${t.observedValueRaw}${t.observedValueUnit ?? ""} [${t.interpretation}]`).join("; ")}`
      : "No out-of-range biomarkers.",
    meds.length > 0 ? `Active meds: ${meds.map((m) => m.name).join(", ")}` : "No active medications.",
    "",
    `── MEAL TO SWAP ──`,
    `Meal slot: ${body.mealType.toLowerCase().replace(/_/g, " ")}`,
    `Current: ${body.currentItems}`,
    "",
    "Return JSON of this shape (no prose, no fences):",
    `{
  "alternatives": [
    { "items": "…", "calories": 420, "restrictions": ["diabetic"], "reasoning": "one sentence tied to a biomarker or variety rule" }
  ]
}`,
  ].join("\n");

  try {
    const { provider } = await getProviderForUser(userId, "chat");
    const res = await provider.chat(
      [
        { role: "system" as const, content: system },
        { role: "user" as const, content: userMsg },
      ],
      { temperature: 0.6, num_ctx: 8192 },
    );

    const parsed = safeParse(res.content);
    if (!parsed) {
      return NextResponse.json({ error: "AI couldn't produce alternatives. Try again." }, { status: 500 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[swap]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}

function safeParse(raw: string): { alternatives: z.infer<typeof AlternativeSchema>[] } | null {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  const json = first >= 0 && last > first ? candidate.slice(first, last + 1) : candidate;
  try {
    const result = ResponseSchema.safeParse(JSON.parse(json));
    if (result.success) return result.data;
  } catch {}
  return null;
}
