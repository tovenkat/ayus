import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const rows = await prisma.supplementSchedule.findMany({
    where: { userId, hidden: false },
    orderBy: [{ active: "desc" }, { time: "asc" }],
  });
  return NextResponse.json({ schedules: rows });
}

const CreateSchema = z.object({
  supplementType: z.enum(["VITAMIN", "MINERAL", "OMEGA", "PROBIOTIC", "PROTEIN", "HERBAL", "AMINO", "ANTIOXIDANT", "OTHER"]),
  name: z.string().min(1),
  dose: z.string().nullable().optional(),
  form: z.string().nullable().optional(),
  timing: z.string().nullable().optional(),
  time: z.string().default("08:00"),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional().default([]),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const body = CreateSchema.parse(await req.json());
  const row = await prisma.supplementSchedule.create({
    data: {
      userId,
      supplementType: body.supplementType,
      name: body.name.trim(),
      dose: body.dose ?? null,
      form: body.form ?? null,
      timing: body.timing ?? "with food",
      time: body.time,
      daysOfWeek: body.daysOfWeek,
      notes: body.notes ?? null,
      active: true,
    },
  });
  for (const p of ["/supplements", "/dashboard"]) revalidatePath(p);
  return NextResponse.json({ schedule: row });
}
