/**
 * POST /api/patients/[id]/consult — a roster clinician records a consultation
 * note about a consented patient. Requires a GRANTED PatientLink. The note is
 * stored on the patient (userId) and attributed to the org + author.
 *
 * Body: { notes: string; diagnosis?: string; followUpDate?: string (YYYY-MM-DD) }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { checkPatientAccess } from "@/lib/patient-roster";

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
    notes?: string; diagnosis?: string; followUpDate?: string;
  };
  const notes = body.notes?.trim();
  if (!notes) {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  // Author name for the note (clinician), with the org as clinic label.
  const [author, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.organization.findUnique({ where: { id: gate.orgId }, select: { name: true } }),
  ]);

  let followUpDate: Date | null = null;
  if (body.followUpDate) {
    const d = new Date(body.followUpDate);
    if (!isNaN(d.getTime())) followUpDate = d;
  }

  const note = await prisma.doctorNote.create({
    data: {
      userId: patientId,
      organizationId: gate.orgId,
      recordedById: userId,
      visitDate: new Date(),
      doctorName: author?.name ?? "Clinician",
      clinic: org?.name ?? null,
      diagnosis: body.diagnosis?.trim() || null,
      notes,
      followUpDate,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: note.id, ok: true });
}
