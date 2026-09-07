/**
 * Extract API — runs AI extraction on an uploaded PDF, creates Report + TestResults.
 *
 * POST /api/extract
 * Body: { uploadId: string }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { callOllamaExtraction } from "@/lib/extraction";
import { synthesizeLabReport } from "@/lib/wiki-gen/synthesize";
import { createReportFromExtraction } from "@/lib/services/report-ingestion";

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { uploadId } = (await req.json()) as { uploadId: string };

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, userId },
  });

  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  if (upload.mimeType !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files can be extracted" }, { status: 400 });
  }

  try {
    // Download the file
    const buffer = await storage.download(upload.storagePath);

    // Run AI extraction with wiki context
    const result = await callOllamaExtraction(
      "", // text — will be extracted from PDF internally
      upload.mimeType,
      buffer,
      undefined,
      userId
    );

    if (!result.tests || result.tests.length === 0) {
      return NextResponse.json({ error: "No test results found in the PDF" }, { status: 422 });
    }

    // Delete existing report for this upload (re-extraction)
    await prisma.report.deleteMany({ where: { uploadId } });

    // Ingest — service handles enrichment, plausibility validation, review-gating,
    // and Report + TestResults + Upload.status update in one transaction.
    const ingested = await createReportFromExtraction(userId, uploadId, result);
    if (!ingested) {
      return NextResponse.json({ error: "No test results found in the PDF" }, { status: 422 });
    }

    // Generate / update wiki pages from the extracted report
    try {
      const fullReport = await prisma.report.findUnique({
        where: { id: ingested.reportId },
        include: { testResults: true },
      });
      if (fullReport) {
        const wikiResult = await synthesizeLabReport(userId, {
          id: fullReport.id,
          sampleCollectedOn: fullReport.sampleCollectedOn,
          referredBy: fullReport.referredBy,
          sampleType: fullReport.sampleType,
          testResults: fullReport.testResults.map((tr) => ({
            normalizedName: tr.normalizedName,
            observedValueRaw: tr.observedValueRaw,
            observedValueNumeric: tr.observedValueNumeric,
            observedValueUnit: tr.observedValueUnit,
            referenceIntervalRaw: tr.referenceIntervalRaw,
            referenceLow: tr.referenceLow,
            referenceHigh: tr.referenceHigh,
            interpretation: tr.interpretation,
            isOutOfRange: tr.isOutOfRange,
          })),
        });
        console.log(`[extract] Wiki: ${wikiResult.pagesCreated} created, ${wikiResult.pagesUpdated} updated`);
      }
    } catch (wikiErr) {
      console.warn("[extract] Wiki generation failed:", wikiErr instanceof Error ? wikiErr.message : wikiErr);
    }

    return NextResponse.json({
      success: true,
      reportId: ingested.reportId,
      testCount: ingested.testCount,
      needsReview: ingested.needsReview,
      warningCount: ingested.warningCount,
    });
  } catch (err) {
    console.error("[extract] Error:", err);
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "ERROR", errorMessage: err instanceof Error ? err.message : "Extraction failed" },
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 500 }
    );
  }
}
