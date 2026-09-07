/**
 * POST /api/patients/[id]/link — a roster account (lab/clinic/hospital)
 * requests access to a patient's records. Creates or re-opens a PENDING
 * PatientLink for the caller's org. The patient must approve before any
 * records become visible (see /api/patients/links/[id]/respond).
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getRosterOrg } from "@/lib/patient-roster";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id: patientId } = await params;

  if (patientId === userId) {
    return NextResponse.json({ error: "Cannot request access to yourself" }, { status: 400 });
  }

  const org = await getRosterOrg(userId);
  if (!org) {
    return NextResponse.json({ error: "Only roster accounts can request patient access" }, { status: 403 });
  }

  const patient = await prisma.user.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  const existing = await prisma.patientLink.findUnique({
    where: { organizationId_patientId: { organizationId: org.orgId, patientId } },
    select: { status: true },
  });

  // Already granted → no-op (don't reset an approved consent to pending).
  if (existing?.status === "GRANTED") {
    return NextResponse.json({ status: "GRANTED", changed: false });
  }

  const link = await prisma.patientLink.upsert({
    where: { organizationId_patientId: { organizationId: org.orgId, patientId } },
    create: {
      organizationId: org.orgId,
      patientId,
      status: "PENDING",
      requestedById: org.memberId,
    },
    // Re-requesting after a REVOKE moves it back to PENDING.
    update: { status: "PENDING", requestedById: org.memberId, respondedAt: null },
    select: { id: true, status: true },
  });

  return NextResponse.json({ id: link.id, status: link.status, changed: true });
}
