import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { createShareLink, formatShareMessage, type ShareExpiry } from "@/lib/share";

const BodySchema = z.object({
  resource: z.enum(["EMERGENCY_CARD", "VISIT_PREP", "REPORT", "FULL_WIKI", "DOCTOR_NOTE"]),
  resourceId: z.string().nullable().optional(),
  snapshotJson: z.any().optional(), // caller may pass pre-rendered content (e.g., visit prep)
  pin: z.string().optional(),
  recipientName: z.string().optional(),
  recipientPhone: z.string().optional(),
  expiry: z.enum(["24H", "48H", "7D", "30D"]).optional(),
  sendWhatsApp: z.boolean().default(false),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  // Validate resourceId when relevant
  if (body.resource === "REPORT" && !body.resourceId) {
    return NextResponse.json({ error: "resourceId required for REPORT" }, { status: 400 });
  }
  if (body.resource === "REPORT") {
    const report = await prisma.report.findFirst({
      where: { id: body.resourceId!, userId },
      select: { id: true },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  // Doctor note — validate ownership + freeze a snapshot the public view can
  // render without hitting ACL rules or joining tables that may have changed.
  if (body.resource === "DOCTOR_NOTE") {
    if (!body.resourceId) {
      return NextResponse.json({ error: "resourceId required for DOCTOR_NOTE" }, { status: 400 });
    }
    const note = await prisma.doctorNote.findFirst({
      where: { id: body.resourceId, userId },
      include: { prescriptions: true },
    });
    if (!note) return NextResponse.json({ error: "Doctor note not found" }, { status: 404 });
    // Store a frozen copy — later edits to the DoctorNote won't leak into
    // an already-shared link.
    body.snapshotJson = {
      id: note.id,
      visitDate: note.visitDate.toISOString(),
      doctorName: note.doctorName,
      specialty: note.specialty,
      clinic: note.clinic,
      diagnosis: note.diagnosis,
      notes: note.notes,
      followUpDate: note.followUpDate?.toISOString() ?? null,
      prescriptions: note.prescriptions.map((p) => ({
        medication: p.medication,
        dosage: p.dosage,
        frequency: p.frequency,
        duration: p.duration,
        instructions: p.instructions,
      })),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true },
  });
  const patientName = user?.name ?? user?.email ?? "An Ayus user";

  const { token, url, expiresAt } = await createShareLink({
    userId,
    resource: body.resource,
    resourceId: body.resourceId ?? null,
    snapshotJson: body.snapshotJson,
    pin: body.pin,
    recipientName: body.recipientName,
    recipientPhone: body.recipientPhone,
    expiry: (body.expiry ?? "48H") as ShareExpiry,
  });

  let sentViaWhatsApp = false;
  let whatsAppError: string | undefined;

  if (body.sendWhatsApp && body.recipientPhone) {
    try {
      const { sendWhatsApp } = await import("@/lib/twilio");
      const message = formatShareMessage(body.resource, patientName, url, expiresAt, body.pin);
      await sendWhatsApp(body.recipientPhone, message);
      sentViaWhatsApp = true;
    } catch (err) {
      whatsAppError = err instanceof Error ? err.message : "WhatsApp send failed";
      console.warn("[share] WhatsApp send failed:", whatsAppError);
    }
  }

  return NextResponse.json({
    token,
    url,
    expiresAt: expiresAt.toISOString(),
    sentViaWhatsApp,
    whatsAppError,
  });
}
