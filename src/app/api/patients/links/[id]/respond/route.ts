/**
 * POST /api/patients/links/[id]/respond — the *patient* grants or revokes an
 * access request. Only the patient named on the link may respond. Body:
 *   { action: "grant" | "revoke" }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;
  const { id: linkId } = await params;

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "grant" && action !== "revoke") {
    return NextResponse.json({ error: "action must be 'grant' or 'revoke'" }, { status: 400 });
  }

  const link = await prisma.patientLink.findUnique({
    where: { id: linkId },
    select: { id: true, patientId: true },
  });
  if (!link) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  // Consent is the patient's alone — no one else may respond on their behalf.
  if (link.patientId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.patientLink.update({
    where: { id: linkId },
    data: { status: action === "grant" ? "GRANTED" : "REVOKED", respondedAt: new Date() },
    select: { id: true, status: true },
  });

  return NextResponse.json({ id: updated.id, status: updated.status });
}
