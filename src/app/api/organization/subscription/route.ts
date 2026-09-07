import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { PRICING } from "@/lib/pricing";

const BodySchema = z.object({
  tier: z.enum(["FREE", "PERSONAL", "FAMILY", "CLINIC_STARTER", "DIAGNOSTIC_CENTER"]),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { tier } = BodySchema.parse(await req.json());
  const tierDef = PRICING[tier];

  // Find the user's primary organization (OWNER role)
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    include: { organization: { include: { subscription: true } } },
  });

  if (!membership) {
    return NextResponse.json({ error: "No organization found for this user" }, { status: 404 });
  }

  const paymentsEnabled = process.env.RAZORPAY_KEY_ID && process.env.NODE_ENV === "production";
  if (tier !== "FREE" && paymentsEnabled) {
    return NextResponse.json(
      { error: "Paid upgrades require payment. Use /api/billing/checkout.", paymentRequired: true },
      { status: 402 },
    );
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const existing = membership.organization.subscription;
  const updated = existing
    ? await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          tier,
          status: "ACTIVE",
          reportsPerMonth: tierDef.reportsPerMonth,
          periodStart: now,
          periodEnd,
          reportsUsed: 0,
        },
      })
    : await prisma.subscription.create({
        data: {
          organizationId: membership.organizationId,
          tier,
          status: "ACTIVE",
          reportsPerMonth: tierDef.reportsPerMonth,
          periodStart: now,
          periodEnd,
        },
      });

  return NextResponse.json({
    ok: true,
    tier: updated.tier,
    reportsPerMonth: updated.reportsPerMonth,
    devMode: !paymentsEnabled,
  });
}
