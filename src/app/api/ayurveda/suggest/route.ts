import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { suggestAyurvedaPlan } from "@/lib/ayurveda-suggest";

const BodySchema = z.object({
  doshaLean: z.enum(["UNSURE", "VATA", "PITTA", "KAPHA"]),
  goal: z.enum(["BALANCE", "DIGESTION", "ENERGY", "SLEEP_STRESS", "IMMUNITY", "DETOX"]),
  intensity: z.enum(["GENTLE", "MODERATE"]),
  avoid: z.string().optional(),
  save: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  try {
    const plan = await suggestAyurvedaPlan(userId, body);

    let saved = 0;
    if (body.save) {
      await prisma.ayurvedicSchedule.deleteMany({ where: { userId, isFavorite: false } });
      const rows = plan.suggestions.map((s) => ({
        userId,
        ayurvedicType: s.ayurvedicType,
        name: s.name,
        dosha: s.dosha,
        dose: s.dose,
        anupana: s.anupana,
        timing: s.timing,
        time: s.time,
        daysOfWeek: s.daysOfWeek,
        notes: s.notes ?? (s.reasoning || null),
        active: true,
      }));
      const res = await prisma.ayurvedicSchedule.createMany({ data: rows });
      saved = res.count;
      for (const p of ["/ayurveda", "/dashboard"]) revalidatePath(p);
    }

    return NextResponse.json({ plan, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate Ayurvedic plan";
    console.error("[ayurveda-suggest]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
