import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const rows = await prisma.exerciseSchedule.findMany({
    where: { userId, hidden: false },
    orderBy: [{ active: "desc" }, { time: "asc" }],
  });
  return NextResponse.json({ schedules: rows });
}

const CreateSchema = z.object({
  exerciseType: z.enum(["CARDIO", "STRENGTH", "FLEXIBILITY", "BALANCE", "YOGA", "WALK", "SPORT", "REST"]),
  name: z.string().min(1),
  time: z.string().default("07:00"),
  durationMin: z.number().int().nullable().optional(),
  intensity: z.enum(["low", "moderate", "vigorous"]).nullable().optional(),
  targetAreas: z.array(z.string()).optional().default([]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional().default([]),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const body = CreateSchema.parse(await req.json());
  const row = await prisma.exerciseSchedule.create({
    data: {
      userId,
      exerciseType: body.exerciseType,
      name: body.name.trim(),
      time: body.time,
      durationMin: body.durationMin ?? null,
      intensity: body.intensity ?? "moderate",
      targetAreas: body.targetAreas,
      daysOfWeek: body.daysOfWeek,
      notes: body.notes ?? null,
      active: true,
    },
  });
  for (const p of ["/exercise", "/dashboard"]) revalidatePath(p);
  return NextResponse.json({ schedule: row });
}
