import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { ReviewPanel } from "@/components/reports/review-panel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Review Report ${id.slice(0, 8)} — Ayus` };
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireAuth();
  const { id: reportId } = await params;

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      upload: true,
      testResults: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!report || report.userId !== userId) {
    notFound();
  }

  const serializedReport = {
    id: report.id,
    sampleCollectedOn: report.sampleCollectedOn?.toISOString().split("T")[0] ?? "",
    referredBy: report.referredBy ?? "",
    sampleType: report.sampleType ?? "",
    confidence: report.confidence,
    fileId: report.uploadId,
    fileMimeType: report.upload.mimeType,
    fileName: report.upload.originalName,
    fileStatus: report.upload.status,
  };

  const serializedTests = report.testResults.map((t) => ({
    id: t.id,
    rawTestName: t.rawTestName,
    normalizedName: t.normalizedName,
    observedValueRaw: t.observedValueRaw,
    observedValueNumeric: t.observedValueNumeric,
    observedValueOperator: t.observedValueOperator,
    observedValueUnit: t.observedValueUnit ?? "",
    referenceIntervalRaw: t.referenceIntervalRaw ?? "",
    referenceLow: t.referenceLow,
    referenceHigh: t.referenceHigh,
    interpretation: t.interpretation,
    isOutOfRange: t.isOutOfRange,
    confidence: t.confidence,
    plausibilityFlag: t.plausibilityFlag,
    warnings: t.warnings,
    sourcePage: t.sourcePage,
  }));

  return (
    <ReviewPanel
      report={serializedReport}
      tests={serializedTests}
    />
  );
}
