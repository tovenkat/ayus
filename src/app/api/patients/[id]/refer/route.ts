/**
 * POST /api/patients/[id]/refer — a roster clinician refers a consented patient
 * to another org / specialty. Requires a GRANTED PatientLink.
 *
 * Body: { specialty: Specialty; reason: string; toOrgId?: string; toOrgName?: string }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { checkPatientAccess } from "@/lib/patient-roster";
import { Specialty } from "@prisma/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id: patientId } = await params;

  const gate = await checkPatientAccess(userId, patientId);
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.reason === "not_a_roster_account" ? "Not a roster account" : "No consent for this patient" },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    specialty?: string; reason?: string; toOrgId?: string; toOrgName?: string;
  };
  const reason = body.reason?.trim();
  if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  const specialty = (Object.values(Specialty) as string[]).includes(body.specialty ?? "")
    ? (body.specialty as Specialty)
    : Specialty.GENERAL;

  // Validate an in-system target if given; otherwise fall back to free-text.
  let toOrgId: string | null = null;
  if (body.toOrgId) {
    const target = await prisma.organization.findUnique({ where: { id: body.toOrgId }, select: { id: true } });
    if (target) toOrgId = target.id;
  }
  const toOrgName = toOrgId ? null : (body.toOrgName?.trim() || null);
  if (!toOrgId && !toOrgName) {
    return NextResponse.json({ error: "a referral target (toOrgId or toOrgName) is required" }, { status: 400 });
  }

  const referral = await prisma.referral.create({
    data: {
      patientId, fromOrgId: gate.orgId, toOrgId, toOrgName, specialty, reason,
      createdById: userId, status: "PENDING",
    },
    select: { id: true },
  });

  return NextResponse.json({ id: referral.id, ok: true });
}
