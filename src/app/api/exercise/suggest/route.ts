import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { suggestExercisePlan } from "@/lib/exercise-suggest";

const BodySchema = z.object({
  level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  goal: z.enum(["GENERAL", "WEIGHT_LOSS", "STRENGTH", "ENDURANCE", "MOBILITY"]),
  daysPerWeek: z.number().int().min(2).max(7),
  equipment: z.enum(["NONE", "HOME", "GYM"]),
  minutesPerSession: z.number().int().nullable().optional(),
  limitations: z.string().optional(),
  // when true (default), the generated plan replaces the current active schedule
  save: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  try {
    const plan = await suggestExercisePlan(userId, body);

    let saved = 0;
    if (body.save) {
      // Replace the current AI-generated week, but keep anything the user pinned.
      await prisma.exerciseSchedule.deleteMany({ where: { userId, isFavorite: false } });
      const rows = plan.suggestions.map((s) => ({
        userId,
        exerciseType: s.exerciseType,
        name: s.name,
        time: s.time,
        durationMin: s.durationMin,
        intensity: s.intensity,
        targetAreas: s.targetAreas,
        daysOfWeek: s.daysOfWeek,
        notes: s.notes ?? (s.reasoning || null),
        active: true,
      }));
      const res = await prisma.exerciseSchedule.createMany({ data: rows });
      saved = res.count;
      for (const p of ["/exercise", "/dashboard"]) revalidatePath(p);
    }

    return NextResponse.json({ plan, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate workout plan";
    console.error("[exercise-suggest]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
