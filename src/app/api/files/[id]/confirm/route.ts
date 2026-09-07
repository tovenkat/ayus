import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiAuth } from "@/lib/auth-helpers";

const testRowSchema = z.object({
  id: z.string(),
  rawTestName: z.string(),
  normalizedName: z.string(),
  observedValueRaw: z.string(),
  observedValueNumeric: z.number().nullable(),
  observedValueOperator: z.enum(["LT", "GT", "EQ", "APPROX"]).nullable(),
  observedValueUnit: z.string(),
  referenceIntervalRaw: z.string(),
  referenceLow: z.number().nullable(),
  referenceHigh: z.number().nullable(),
  interpretation: z.enum(["LOW", "NORMAL", "HIGH", "UNKNOWN"]),
  isOutOfRange: z.boolean(),
  confidence: z.number(),
});

const confirmSchema = z.object({
  sampleCollectedOn: z.string(),
  referredBy: z.string(),
  sampleType: z.string().default(""),
  confidence: z.number(),
  tests: z.array(testRowSchema).min(1, "At least one test result is required"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { id: uploadId } = await params;

  const file = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (file.status !== "NEEDS_REVIEW") {
    return NextResponse.json(
      { error: `File status is ${file.status}, expected NEEDS_REVIEW` },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    // Check if a draft report already exists (created during extraction)
    const existing = await tx.report.findUnique({ where: { uploadId: uploadId } });

    let report;
    if (existing) {
      // Update existing draft report with user's edits
      await tx.testResult.deleteMany({ where: { reportId: existing.id } });
      report = await tx.report.update({
        where: { id: existing.id },
        data: {
          sampleCollectedOn: data.sampleCollectedOn ? new Date(data.sampleCollectedOn) : null,
          dateSource: data.sampleCollectedOn ? "REPORT_DATE" : "UNKNOWN",
          referredBy: data.referredBy || null,
          sampleType: data.sampleType || null,
          rawJson: data as object,
          confidence: data.confidence,
        },
      });
    } else {
      report = await tx.report.create({
        data: {
          userId,
          uploadId,
          sampleCollectedOn: data.sampleCollectedOn ? new Date(data.sampleCollectedOn) : null,
          dateSource: data.sampleCollectedOn ? "REPORT_DATE" : "UNKNOWN",
          referredBy: data.referredBy || null,
          sampleType: data.sampleType || null,
          rawJson: data as object,
          confidence: data.confidence,
        },
      });
    }

    await tx.testResult.createMany({
      data: data.tests.map((t) => ({
        userId,
        reportId: report.id,
        rawTestName: t.rawTestName,
        normalizedName: t.normalizedName,
        observedValueRaw: t.observedValueRaw,
        observedValueNumeric: t.observedValueNumeric,
        observedValueOperator: t.observedValueOperator,
        observedValueUnit: t.observedValueUnit,
        referenceIntervalRaw: t.referenceIntervalRaw,
        referenceLow: t.referenceLow,
        referenceHigh: t.referenceHigh,
        interpretation: t.interpretation,
        confidence: t.confidence,
        isOutOfRange: t.isOutOfRange,
      })),
    });

    await tx.upload.update({
      where: { id: uploadId },
      data: { status: "CONFIRMED" },
    });

    // Update the extraction job to completed
    await tx.job.updateMany({
      where: { uploadId, type: "EXTRACT" },
      data: { status: "COMPLETED" },
    });

    return report;
  });

  return NextResponse.json({ reportId: result.id });
}
