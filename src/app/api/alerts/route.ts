import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const alerts = await prisma.biomarkerAlert.findMany({
    where: { userId, status: { not: "DISMISSED" } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json({ alerts });
}

const PatchSchema = z.object({
  id: z.string().optional(),
  ids: z.array(z.string()).optional(),
  action: z.enum(["SEEN", "DISMISSED"]),
});

export async function PATCH(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = PatchSchema.parse(await req.json());
  const ids = body.ids ?? (body.id ? [body.id] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: "No ids provided" }, { status: 400 });
  }

  const now = new Date();
  const updated = await prisma.biomarkerAlert.updateMany({
    where: { id: { in: ids }, userId },
    data: {
      status: body.action,
      dismissedAt: body.action === "DISMISSED" ? now : undefined,
    },
  });

  return NextResponse.json({ updated: updated.count });
}
