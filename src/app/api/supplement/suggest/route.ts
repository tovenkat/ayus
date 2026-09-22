import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { suggestSupplementPlan } from "@/lib/supplement-suggest";

const BodySchema = z.object({
  goal: z.enum(["GENERAL", "ENERGY", "IMMUNITY", "BONE_JOINT", "HEART", "SLEEP_STRESS", "GUT"]),
  diet: z.enum(["OMNIVORE", "VEGETARIAN", "VEGAN"]),
  budget: z.enum(["LEAN", "BALANCED", "COMPREHENSIVE"]),
  avoid: z.string().optional(),
  save: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  try {
    const plan = await suggestSupplementPlan(userId, body);

    let saved = 0;
    if (body.save) {
      await prisma.supplementSchedule.deleteMany({ where: { userId, isFavorite: false } });
      const rows = plan.suggestions.map((s) => ({
        userId,
        supplementType: s.supplementType,
        name: s.name,
        dose: s.dose,
        form: s.form,
        timing: s.timing,
        time: s.time,
        daysOfWeek: s.daysOfWeek,
        notes: s.notes ?? (s.reasoning || null),
        active: true,
      }));
      const res = await prisma.supplementSchedule.createMany({ data: rows });
      saved = res.count;
      for (const p of ["/supplements", "/dashboard"]) revalidatePath(p);
    }

    return NextResponse.json({ plan, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate supplement plan";
    console.error("[supplement-suggest]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
