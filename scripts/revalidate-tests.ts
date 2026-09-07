/**
 * Revalidate every historical TestResult row against the current plausibility
 * bounds + unit expectations. Run once after adding new bounds, and any time
 * you tighten the rules.
 *
 * For each row:
 *   1. Look up canonical bounds (via canonicalTestId)
 *   2. Call validateExtractedTest — same code path as fresh extractions
 *   3. Update plausibilityFlag, warnings, confidence in place
 *   4. Aggregate per Report to set Report.needsReview and Upload.status
 *
 * Idempotent — safe to re-run. Only touches rows whose validated state differs
 * from what's stored (avoids no-op writes).
 *
 * Usage:
 *   npm run tests:revalidate                # all users
 *   npm run tests:revalidate -- --dry-run   # print counts without writing
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { validateExtractedTest, LAB_VALIDATOR_CONFIDENCE_THRESHOLD } from "../src/lib/lab-validators";

const BATCH_SIZE = 500;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const total = await prisma.testResult.count();
  console.log(`[revalidate] scanning ${total} TestResult rows (dry-run=${dryRun})…`);

  const canonicalCache = new Map<string, { minValue: number | null; maxValue: number | null; expectedUnit: string | null; hasLoinc: boolean }>();
  // Track per-report aggregate so we can update Report.needsReview at the end.
  const reportsNeedingReview = new Set<string>();
  const reportsSeen = new Set<string>();

  let processed = 0;
  let updated = 0;
  let flaggedOutOfBounds = 0;
  let flaggedUnitMismatch = 0;
  let flaggedLowConfidence = 0;

  let cursor: string | null = null;
  while (true) {
    const batch: Array<{
      id: string;
      reportId: string;
      canonicalTestId: string | null;
      observedValueRaw: string;
      observedValueNumeric: number | null;
      observedValueUnit: string | null;
      referenceLow: number | null;
      referenceHigh: number | null;
      confidence: number;
      plausibilityFlag: string | null;
      warnings: string[];
    }> = await prisma.testResult.findMany({
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: "asc" },
      select: {
        id: true,
        reportId: true,
        canonicalTestId: true,
        observedValueRaw: true,
        observedValueNumeric: true,
        observedValueUnit: true,
        referenceLow: true,
        referenceHigh: true,
        confidence: true,
        plausibilityFlag: true,
        warnings: true,
      },
    });
    if (batch.length === 0) break;

    // Preload canonicals for this batch that we haven't cached yet.
    const needed = Array.from(
      new Set(batch.map((r) => r.canonicalTestId).filter((v): v is string => !!v && !canonicalCache.has(v))),
    );
    if (needed.length > 0) {
      const rows = await prisma.testCanonical.findMany({
        where: { id: { in: needed } },
        select: { id: true, minValue: true, maxValue: true, expectedUnit: true, loincNum: true },
      });
      for (const r of rows) {
        canonicalCache.set(r.id, {
          minValue: r.minValue,
          maxValue: r.maxValue,
          expectedUnit: r.expectedUnit,
          hasLoinc: r.loincNum !== null,
        });
      }
    }

    for (const row of batch) {
      reportsSeen.add(row.reportId);
      const canonical = row.canonicalTestId ? canonicalCache.get(row.canonicalTestId) ?? null : null;
      const v = validateExtractedTest({
        observedValueRaw: row.observedValueRaw,
        observedValueNumeric: row.observedValueNumeric,
        observedValueUnit: row.observedValueUnit,
        referenceLow: row.referenceLow,
        referenceHigh: row.referenceHigh,
        confidence: row.confidence,
        canonical,
      });

      if (v.plausibilityFlag === "out_of_bounds") flaggedOutOfBounds++;
      if (v.warnings.some((w) => w.startsWith("unit_mismatch"))) flaggedUnitMismatch++;
      if (v.confidence < LAB_VALIDATOR_CONFIDENCE_THRESHOLD) flaggedLowConfidence++;
      if (v.needsReview) reportsNeedingReview.add(row.reportId);

      // Only write when the outcome actually changed.
      const currentWarningsKey = row.warnings.join("|");
      const newWarningsKey = v.warnings.join("|");
      const hasChange =
        row.plausibilityFlag !== v.plausibilityFlag ||
        currentWarningsKey !== newWarningsKey ||
        Math.abs(row.confidence - v.confidence) > 0.001;

      if (hasChange && !dryRun) {
        await prisma.testResult.update({
          where: { id: row.id },
          data: {
            plausibilityFlag: v.plausibilityFlag,
            warnings: v.warnings,
            confidence: v.confidence,
          },
        });
        updated++;
      } else if (hasChange) {
        updated++;
      }
      processed++;
    }

    cursor = batch[batch.length - 1].id;
    if (processed % (BATCH_SIZE * 4) === 0) {
      console.log(`  · processed=${processed}, updated=${updated}, out_of_bounds=${flaggedOutOfBounds}, unit_mismatch=${flaggedUnitMismatch}, low_conf=${flaggedLowConfidence}`);
    }
  }

  // Aggregate: update Report.needsReview + Upload.status per report we touched.
  if (!dryRun) {
    console.log(`\n[revalidate] updating ${reportsSeen.size} report(s)…`);
    for (const reportId of reportsSeen) {
      const needsReview = reportsNeedingReview.has(reportId);
      const report = await prisma.report.update({
        where: { id: reportId },
        data: { needsReview },
        select: { uploadId: true, confidence: true },
      });
      // Only escalate Upload.status when it's currently READY. Don't overwrite
      // CONFIRMED (user already reviewed) or ERROR states.
      if (needsReview) {
        await prisma.upload.updateMany({
          where: { id: report.uploadId, status: "READY" },
          data: { status: "NEEDS_REVIEW" },
        });
      }
    }
  }

  console.log(
    `\n[revalidate] done — processed=${processed}, updated=${updated}` +
    ` · out_of_bounds=${flaggedOutOfBounds}, unit_mismatch=${flaggedUnitMismatch}, low_conf=${flaggedLowConfidence}` +
    ` · reports_needing_review=${reportsNeedingReview.size}/${reportsSeen.size}`,
  );
  if (dryRun) console.log(`(dry-run: no writes performed)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
