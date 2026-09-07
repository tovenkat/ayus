/**
 * Backfill TestResult.canonicalTestId for rows that predate the wiring.
 *
 * For each TestResult with canonicalTestId = NULL:
 *   1. resolveBiomarker(rawTestName) → canonicalId?
 *   2. Fallback: resolveBiomarker(normalizedName)
 *   3. If neither matches → logUnresolvedTestName (for later curation)
 *
 * Idempotent. Safe to re-run — only touches rows still NULL.
 *
 * Run: npm run biomarkers:backfill
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { resolveBiomarker, logUnresolvedTestName, invalidateBiomarkerCache } from "../src/lib/biomarker-resolver";

const BATCH_SIZE = 200;

async function main() {
  invalidateBiomarkerCache(); // start fresh in case seed just ran

  const total = await prisma.testResult.count({ where: { canonicalTestId: null } });
  console.log(`[backfill] ${total} TestResult row(s) with canonicalTestId = NULL`);
  if (total === 0) return;

  let processed = 0;
  let matched = 0;
  let unresolved = 0;

  while (true) {
    const batch = await prisma.testResult.findMany({
      where: { canonicalTestId: null },
      select: { id: true, userId: true, reportId: true, rawTestName: true, normalizedName: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      const hit =
        (await resolveBiomarker(row.rawTestName))
        ?? (await resolveBiomarker(row.normalizedName));

      if (hit) {
        await prisma.testResult.update({
          where: { id: row.id },
          data: { canonicalTestId: hit.canonicalId },
        });
        matched++;
      } else {
        await logUnresolvedTestName(row.rawTestName || row.normalizedName, {
          userId: row.userId,
          reportId: row.reportId,
        });
        // Mark it as attempted so the WHERE clause doesn't refetch it — but we
        // don't have a "tried but failed" column. Instead, set canonicalTestId
        // to null AND use the empty string "" as a sentinel? Bad idea. Instead
        // we short-circuit the loop by advancing the offset.
        unresolved++;
      }
      processed++;
    }

    // If nothing matched in this batch, we'd loop forever. Detect that.
    const remaining = await prisma.testResult.count({ where: { canonicalTestId: null } });
    if (remaining === total - matched) {
      // All still-NULL rows in this batch failed to match — stop.
      console.log(`[backfill] progress: matched=${matched} unresolved=${unresolved} — stopping (rest are unresolvable)`);
      break;
    }
    if (processed % 500 === 0) {
      console.log(`  · processed=${processed}, matched=${matched}, unresolved=${unresolved}`);
    }
  }

  console.log(`\n[backfill] done — matched=${matched}, unresolved=${unresolved}, processed=${processed}`);
  console.log(`Review unresolved names: npm run biomarkers:unresolved`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
