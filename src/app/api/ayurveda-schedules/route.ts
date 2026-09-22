import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const rows = await prisma.ayurvedicSchedule.findMany({
    where: { userId, hidden: false },
    orderBy: [{ active: "desc" }, { time: "asc" }],
  });
  return NextResponse.json({ schedules: rows });
}

const CreateSchema = z.object({
  ayurvedicType: z.enum(["HERB", "FORMULATION", "THERAPY", "ROUTINE", "DIET", "YOGA_PRANAYAMA", "OTHER"]),
  name: z.string().min(1),
  dosha: z.string().nullable().optional(),
  dose: z.string().nullable().optional(),
  anupana: z.string().nullable().optional(),
  timing: z.string().nullable().optional(),
  time: z.string().default("07:00"),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional().default([]),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const body = CreateSchema.parse(await req.json());
  const row = await prisma.ayurvedicSchedule.create({
    data: {
      userId,
      ayurvedicType: body.ayurvedicType,
      name: body.name.trim(),
      dosha: body.dosha ?? null,
      dose: body.dose ?? null,
      anupana: body.anupana ?? null,
      timing: body.timing ?? "after meals",
      time: body.time,
      daysOfWeek: body.daysOfWeek,
      notes: body.notes ?? null,
      active: true,
    },
  });
  for (const p of ["/ayurveda", "/dashboard"]) revalidatePath(p);
  return NextResponse.json({ schedule: row });
}
