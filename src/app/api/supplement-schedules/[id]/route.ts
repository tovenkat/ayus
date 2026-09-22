import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  dose: z.string().nullable().optional(),
  form: z.string().nullable().optional(),
  timing: z.string().nullable().optional(),
  time: z.string().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
});

async function ownedOr404(userId: string, id: string) {
  const row = await prisma.supplementSchedule.findUnique({ where: { id }, select: { userId: true } });
  return row && row.userId === userId;
}

export async function PATCH(req: Request, { params }: Params) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id } = await params;
  if (!(await ownedOr404(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = PatchSchema.parse(await req.json());
  const row = await prisma.supplementSchedule.update({ where: { id }, data });
  for (const p of ["/supplements", "/dashboard"]) revalidatePath(p);
  return NextResponse.json({ schedule: row });
}

export async function DELETE(_req: Request, { params }: Params) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id } = await params;
  if (!(await ownedOr404(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.supplementSchedule.delete({ where: { id } });
  for (const p of ["/supplements", "/dashboard"]) revalidatePath(p);
  return NextResponse.json({ ok: true });
}
