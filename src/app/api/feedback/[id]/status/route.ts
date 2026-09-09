/**
 * POST /api/feedback/[id]/status — triage a feedback item. Restricted to
 * feedback admins (FEEDBACK_EMAIL / FEEDBACK_ADMIN_EMAILS).
 *
 * Body: { status: "OPEN" | "PLANNED" | "RESOLVED" | "DECLINED" }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isFeedbackAdmin } from "@/lib/email";
import { FeedbackStatus } from "@prisma/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id } = await params;

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!isFeedbackAdmin(me?.email)) {
    return NextResponse.json({ error: "Not authorized to triage feedback" }, { status: 403 });
  }

  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (!status || !(Object.values(FeedbackStatus) as string[]).includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const updated = await prisma.feedback.update({
    where: { id },
    data: { status: status as FeedbackStatus },
    select: { id: true, status: true },
  });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
