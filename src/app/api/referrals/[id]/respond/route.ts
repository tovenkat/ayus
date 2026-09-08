/**
 * POST /api/referrals/[id]/respond — the RECEIVING org acts on an inbound
 * referral. Only a member of the referral's toOrg may respond.
 *
 * Body: { action: "accept" | "decline" | "complete" }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import type { ReferralStatus } from "@prisma/client";

const ACTION_STATUS: Record<string, ReferralStatus> = {
  accept: "ACCEPTED",
  decline: "DECLINED",
  complete: "COMPLETED",
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id: referralId } = await params;

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const status = action ? ACTION_STATUS[action] : undefined;
  if (!status) {
    return NextResponse.json({ error: "action must be accept | decline | complete" }, { status: 400 });
  }

  const referral = await prisma.referral.findUnique({
    where: { id: referralId },
    select: { id: true, toOrgId: true },
  });
  if (!referral) return NextResponse.json({ error: "Referral not found" }, { status: 404 });
  if (!referral.toOrgId) return NextResponse.json({ error: "External referral — not actionable here" }, { status: 400 });

  // Only a member of the receiving org may respond.
  const member = await prisma.organizationMember.findFirst({
    where: { userId, organizationId: referral.toOrgId },
    select: { id: true },
  });
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updated = await prisma.referral.update({
    where: { id: referralId },
    data: { status, respondedAt: new Date() },
    select: { id: true, status: true },
  });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
