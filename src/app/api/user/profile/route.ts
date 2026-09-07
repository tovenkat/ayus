import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  name: z.string().min(1).max(80),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());
  const name = body.name.trim();
  if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });

  await prisma.user.update({
    where: { id: userId },
    data: { name },
  });

  return NextResponse.json({ ok: true, name });
}
