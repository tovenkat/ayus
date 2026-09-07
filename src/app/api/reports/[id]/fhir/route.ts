/**
 * GET /api/reports/[id]/fhir — FHIR R4 export of a report.
 *
 * Access: the report's owner (patient), or a roster account with a GRANTED
 * consent link to that patient. Returns a FHIR Bundle (application/fhir+json).
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { checkPatientAccess } from "@/lib/patient-roster";
import { buildReportFhirBundle } from "@/lib/fhir";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id: reportId } = await params;

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { userId: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Owner, or a lab/clinic with granted consent to this patient.
  if (report.userId !== userId) {
    const gate = await checkPatientAccess(userId, report.userId);
    if (!gate.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const bundle = await buildReportFhirBundle(reportId);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/fhir+json",
      "Content-Disposition": `attachment; filename="report-${reportId}.fhir.json"`,
    },
  });
}
