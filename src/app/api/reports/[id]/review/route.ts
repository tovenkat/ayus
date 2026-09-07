import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiAuth } from "@/lib/auth-helpers";
import {
  parseOperator,
  parseReferenceRange,
  computeInterpretation,
} from "@/lib/extraction-client";
import { validateExtractedTest } from "@/lib/lab-validators";

// ─── Schemas ────────────────────────────────────────────────────────────────

const testUpdateSchema = z.object({
  id: z.string(),
  normalizedName: z.string().optional(),
  observedValueRaw: z.string().optional(),
  observedValueUnit: z.string().optional(),
  referenceIntervalRaw: z.string().optional(),
  interpretation: z.enum(["LOW", "NORMAL", "HIGH", "UNKNOWN"]).optional(),
  isOutOfRange: z.boolean().optional(),
  confidence: z.number().optional(),
});

const patchSchema = z.object({
  sampleCollectedOn: z.string().optional(),
  referredBy: z.string().optional(),
  sampleType: z.string().optional(),
  tests: z.array(testUpdateSchema).optional(),
  deletedTestIds: z.array(z.string()).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

async function loadReportWithAuth(reportId: string, userId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { upload: true },
  });

  if (!report) return { error: "Report not found", status: 404 } as const;
  if (report.userId !== userId) return { error: "Forbidden", status: 403 } as const;

  return { report } as const;
}

// ─── PATCH: update test results + report fields ─────────────────────────────

export async function PATCH(request: Request, { params }: Params) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { id: reportId } = await params;

  const loaded = await loadReportWithAuth(reportId, userId);
  if ("error" in loaded) {
    return NextResponse.json(
      { error: loaded.error },
      { status: loaded.status }
    );
  }
  const { report } = loaded;

  if (report.upload.status === "CONFIRMED") {
    return NextResponse.json(
      { error: "Report is confirmed and locked. Unlock before editing." },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    // Update report-level fields
    if (data.sampleCollectedOn !== undefined || data.referredBy !== undefined || data.sampleType !== undefined) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      if (data.sampleCollectedOn !== undefined) {
        before.sampleCollectedOn = report.sampleCollectedOn?.toISOString() ?? null;
        after.sampleCollectedOn = data.sampleCollectedOn || null;
      }
      if (data.referredBy !== undefined) {
        before.referredBy = report.referredBy;
        after.referredBy = data.referredBy;
      }
      if (data.sampleType !== undefined) {
        before.sampleType = report.sampleType;
        after.sampleType = data.sampleType;
      }

      await tx.report.update({
        where: { id: reportId },
        data: {
          ...(data.sampleCollectedOn !== undefined && {
            sampleCollectedOn: data.sampleCollectedOn ? new Date(data.sampleCollectedOn) : null,
          }),
          ...(data.referredBy !== undefined && {
            referredBy: data.referredBy || null,
          }),
          ...(data.sampleType !== undefined && {
            sampleType: data.sampleType || null,
          }),
        },
      });
    }

    // Update individual test results
    if (data.tests) {
      for (const update of data.tests) {
        const existing = await tx.testResult.findUnique({
          where: { id: update.id },
        });
        if (!existing || existing.userId !== userId) continue;

        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        const updateData: Record<string, unknown> = {};

        // Collect changed fields
        if (
          update.normalizedName !== undefined &&
          update.normalizedName !== existing.normalizedName
        ) {
          before.normalizedName = existing.normalizedName;
          after.normalizedName = update.normalizedName;
          updateData.normalizedName = update.normalizedName;
        }

        if (
          update.observedValueRaw !== undefined &&
          update.observedValueRaw !== existing.observedValueRaw
        ) {
          before.observedValueRaw = existing.observedValueRaw;
          after.observedValueRaw = update.observedValueRaw;
          updateData.observedValueRaw = update.observedValueRaw;

          const { operator, numeric } = parseOperator(update.observedValueRaw);
          updateData.observedValueNumeric = numeric;
          updateData.observedValueOperator = operator;
        }

        if (
          update.observedValueUnit !== undefined &&
          update.observedValueUnit !== (existing.observedValueUnit ?? "")
        ) {
          before.observedValueUnit = existing.observedValueUnit;
          after.observedValueUnit = update.observedValueUnit;
          updateData.observedValueUnit = update.observedValueUnit;
        }

        if (
          update.referenceIntervalRaw !== undefined &&
          update.referenceIntervalRaw !== (existing.referenceIntervalRaw ?? "")
        ) {
          before.referenceIntervalRaw = existing.referenceIntervalRaw;
          after.referenceIntervalRaw = update.referenceIntervalRaw;
          updateData.referenceIntervalRaw = update.referenceIntervalRaw;

          const { low, high } = parseReferenceRange(
            update.referenceIntervalRaw
          );
          updateData.referenceLow = low;
          updateData.referenceHigh = high;
        }

        // Recompute interpretation if value or range changed
        if (
          update.observedValueRaw !== undefined ||
          update.referenceIntervalRaw !== undefined
        ) {
          const rawVal =
            update.observedValueRaw ?? existing.observedValueRaw;
          const refRaw =
            update.referenceIntervalRaw ??
            existing.referenceIntervalRaw ??
            "";

          const { operator, numeric } = parseOperator(rawVal);
          const { low, high } = parseReferenceRange(refRaw);
          const { interpretation, isOutOfRange } = computeInterpretation(
            numeric,
            operator,
            low,
            high,
            null
          );

          if (interpretation !== existing.interpretation) {
            before.interpretation = existing.interpretation;
            after.interpretation = interpretation;
          }
          if (isOutOfRange !== existing.isOutOfRange) {
            before.isOutOfRange = existing.isOutOfRange;
            after.isOutOfRange = isOutOfRange;
          }

          updateData.interpretation = interpretation;
          updateData.isOutOfRange = isOutOfRange;
        }

        // Allow manual interpretation override
        if (
          update.interpretation !== undefined &&
          update.observedValueRaw === undefined &&
          update.referenceIntervalRaw === undefined
        ) {
          before.interpretation = existing.interpretation;
          after.interpretation = update.interpretation;
          updateData.interpretation = update.interpretation;
          updateData.isOutOfRange =
            update.interpretation === "HIGH" ||
            update.interpretation === "LOW";
        }

        if (
          update.confidence !== undefined &&
          update.confidence !== existing.confidence
        ) {
          before.confidence = existing.confidence;
          after.confidence = update.confidence;
          updateData.confidence = update.confidence;
        }

        // Re-run deterministic validator against the edited row so the
        // plausibilityFlag / warnings / adjusted confidence reflect the new
        // observed value the user typed. Always run — even ref-range-only
        // edits can change the reference_range_inverted signal.
        const changedFieldsThatAffectValidation = [
          "observedValueRaw", "observedValueNumeric", "observedValueUnit",
          "referenceLow", "referenceHigh",
        ].some((k) => k in updateData);
        if (changedFieldsThatAffectValidation) {
          const nextRaw = (updateData.observedValueRaw as string | undefined) ?? existing.observedValueRaw;
          const nextNumeric = (updateData.observedValueNumeric as number | null | undefined) ?? existing.observedValueNumeric;
          const nextUnit = (updateData.observedValueUnit as string | null | undefined) ?? existing.observedValueUnit;
          const nextRefLow = (updateData.referenceLow as number | null | undefined) ?? existing.referenceLow;
          const nextRefHigh = (updateData.referenceHigh as number | null | undefined) ?? existing.referenceHigh;
          const nextConfidence = (updateData.confidence as number | undefined) ?? existing.confidence;

          const canonicalRow = existing.canonicalTestId
            ? await tx.testCanonical.findUnique({
                where: { id: existing.canonicalTestId },
                select: { minValue: true, maxValue: true, expectedUnit: true, loincNum: true },
              })
            : null;
          const canonical = canonicalRow ? {
            minValue: canonicalRow.minValue,
            maxValue: canonicalRow.maxValue,
            expectedUnit: canonicalRow.expectedUnit,
            hasLoinc: canonicalRow.loincNum !== null,
          } : null;

          const v = validateExtractedTest({
            observedValueRaw: nextRaw,
            observedValueNumeric: nextNumeric,
            observedValueUnit: nextUnit,
            referenceLow: nextRefLow,
            referenceHigh: nextRefHigh,
            confidence: nextConfidence,
            canonical,
          });

          updateData.plausibilityFlag = v.plausibilityFlag;
          updateData.warnings = v.warnings;
          // Only overwrite confidence when a hard-check fired. Otherwise
          // trust what the user typed.
          if (v.plausibilityFlag !== null) {
            updateData.confidence = 0;
          }
        }

        if (Object.keys(updateData).length > 0) {
          await tx.testResult.update({
            where: { id: update.id },
            data: updateData,
          });
        }
      }
    }

    // Delete test results
    if (data.deletedTestIds && data.deletedTestIds.length > 0) {
      for (const testId of data.deletedTestIds) {
        const existing = await tx.testResult.findUnique({
          where: { id: testId },
        });
        if (!existing || existing.userId !== userId) continue;

        await tx.testResult.delete({ where: { id: testId } });
      }
    }
  });

  return NextResponse.json({ ok: true });
}

// ─── PUT: confirm report ────────────────────────────────────────────────────

export async function PUT(request: Request, { params }: Params) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { id: reportId } = await params;

  const loaded = await loadReportWithAuth(reportId, userId);
  if ("error" in loaded) {
    return NextResponse.json(
      { error: loaded.error },
      { status: loaded.status }
    );
  }
  const { report } = loaded;

  let body: { action?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine for confirm
  }

  if (body.action === "unlock") {
    if (report.upload.status !== "CONFIRMED") {
      return NextResponse.json(
        { error: "Report is not confirmed" },
        { status: 409 }
      );
    }

    await prisma.upload.update({
      where: { id: report.uploadId },
      data: { status: "NEEDS_REVIEW" },
    });

    return NextResponse.json({ ok: true, status: "NEEDS_REVIEW" });
  }

  // Default action: confirm
  if (report.upload.status === "CONFIRMED") {
    return NextResponse.json(
      { error: "Report is already confirmed" },
      { status: 409 }
    );
  }

  const testCount = await prisma.testResult.count({
    where: { reportId },
  });

  if (testCount === 0) {
    return NextResponse.json(
      { error: "Cannot confirm a report with no test results" },
      { status: 400 }
    );
  }

  // Confirming means the user has reviewed the report. Clear the review flag
  // on Report so dashboards stop badging it, but leave individual test rows'
  // plausibilityFlag/warnings intact for audit — the user's acceptance is the
  // record that they saw the warnings.
  await prisma.$transaction([
    prisma.upload.update({
      where: { id: report.uploadId },
      data: { status: "CONFIRMED" },
    }),
    prisma.report.update({
      where: { id: reportId },
      data: { needsReview: false },
    }),
    prisma.job.updateMany({
      where: { uploadId: report.uploadId, type: "EXTRACT" },
      data: { status: "COMPLETED" },
    }),
  ]);

  return NextResponse.json({ ok: true, status: "CONFIRMED" });
}
