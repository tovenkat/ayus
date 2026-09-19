import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { checkPatientAccess } from "@/lib/patient-roster";
import { generateVisitPrep } from "@/lib/visit-prep";

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  // Optional patient scope: a roster account (doctor/hospital/lab) can generate
  // visit prep for a consented patient. Default is the caller's own record.
  let targetUserId = userId;
  const body = await req.json().catch(() => ({}));
  const patientId = typeof body?.patientId === "string" ? body.patientId : null;
  if (patientId && patientId !== userId) {
    const gate = await checkPatientAccess(userId, patientId);
    if (!gate.ok) {
      return NextResponse.json({ error: "Not authorized for this patient" }, { status: 403 });
    }
    targetUserId = patientId;
  }

  try {
    const prep = await generateVisitPrep(targetUserId);
    return NextResponse.json(prep);
  } catch (err) {
    console.error("[visit-prep]", err);
    const message = err instanceof Error ? err.message : "Failed to generate visit prep";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
