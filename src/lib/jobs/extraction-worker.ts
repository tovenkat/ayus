/**
 * Extraction worker — polls `Job` table for PENDING `EXTRACT` jobs and runs
 * them through the extraction runner.
 *
 * Design:
 *   - Started once at Next.js boot from src/instrumentation.ts.
 *   - Poll every 3 s; concurrency = 2 (Docling sidecar handles one at a time
 *     efficiently, and Prisma connection pool has slack).
 *   - Atomic claim via `updateMany({status: PENDING} → RUNNING)` — safe under
 *     multiple Next.js dev processes and future horizontal scale.
 *   - Progress is written back to `Job.payload.progress` on every callback
 *     from the runner, throttled at 300ms per job to avoid hot DB writes.
 *   - Jobs that throw are marked FAILED; the message (first 500 chars) is
 *     stored in `Job.error` and the Upload flips to ERROR.
 *
 * The worker is intentionally simple (setInterval + a Set of in-flight IDs)
 * rather than a proper queue library. For a local-first PHR app running one
 * Node process, that's more than enough. If we ever need multi-worker
 * distribution, `pg-boss` on top of the same table is a small hop.
 */

import { prisma } from "@/lib/prisma";
import type { Job } from "@prisma/client";
import { runExtractionForUpload } from "@/lib/services/extraction-runner";

const POLL_INTERVAL_MS = 3_000;
const CONCURRENCY = 2;
const PROGRESS_THROTTLE_MS = 300;

const IN_FLIGHT = new Set<string>();
let started = false;

export function startExtractionWorker(): void {
  if (started) return;
  started = true;
  console.log(`[extraction-worker] starting — poll=${POLL_INTERVAL_MS}ms concurrency=${CONCURRENCY}`);
  void loop();
}

async function loop(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error("[extraction-worker] tick error:", err instanceof Error ? err.message : err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function tick(): Promise<void> {
  const slots = CONCURRENCY - IN_FLIGHT.size;
  if (slots <= 0) return;

  const jobs = await prisma.job.findMany({
    where: {
      status: "PENDING",
      type: "EXTRACT",
      id: { notIn: [...IN_FLIGHT] },
    },
    orderBy: { createdAt: "asc" },
    take: slots,
  });
  if (jobs.length === 0) return;

  for (const job of jobs) {
    IN_FLIGHT.add(job.id);
    void processJob(job).finally(() => IN_FLIGHT.delete(job.id));
  }
}

async function processJob(job: Job): Promise<void> {
  // Atomic claim: only proceed if the row is still PENDING. Another worker
  // may have grabbed it between findMany() and now.
  const claimed = await prisma.job.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) return;

  console.log(`[extraction-worker] job ${job.id.slice(0, 8)} claimed`);
  const jobStart = Date.now();

  if (!job.uploadId) {
    await failJob(job.id, "Job has no associated upload");
    return;
  }

  const upload = await prisma.upload.findUnique({ where: { id: job.uploadId } });
  if (!upload) {
    await failJob(job.id, `Upload ${job.uploadId} not found`);
    return;
  }

  // Throttled progress writer — coalesces bursts of updates into one DB
  // write per PROGRESS_THROTTLE_MS window. The final tick still lands
  // because we flush on completion below.
  let lastFlush = 0;
  let pendingProgress: { pct: number; message: string } | null = null;
  const flush = async () => {
    if (!pendingProgress) return;
    const { pct, message } = pendingProgress;
    pendingProgress = null;
    lastFlush = Date.now();
    await prisma.job.update({
      where: { id: job.id },
      data: {
        payload: {
          ...((job.payload as object | null) ?? {}),
          progressPct: pct,
          progressMessage: message,
          progressUpdatedAt: new Date().toISOString(),
        },
      },
    }).catch(() => { /* progress writes never fail the job */ });
  };

  const onProgress = async (pct: number, message: string) => {
    pendingProgress = { pct, message };
    if (Date.now() - lastFlush >= PROGRESS_THROTTLE_MS) await flush();
  };

  try {
    const result = await runExtractionForUpload(upload, onProgress);
    await flush();

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        payload: {
          ...((job.payload as object | null) ?? {}),
          progressPct: 100,
          progressMessage: "done",
          progressUpdatedAt: new Date().toISOString(),
          result: {
            reportIds: result.reportIds,
            documentsIngested: result.documentsIngested,
            warnings: result.warnings,
            errors: result.errors,
          },
        },
      },
    });
    console.log(`[extraction-worker] job ${job.id.slice(0, 8)} completed in ${((Date.now() - jobStart) / 1000).toFixed(1)}s (${result.reportIds.length} report(s))`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[extraction-worker] job ${job.id.slice(0, 8)} failed:`, msg);
    await failJob(job.id, msg);
    if (upload) {
      await prisma.upload.update({
        where: { id: upload.id },
        data: { status: "ERROR", errorMessage: msg.slice(0, 500) },
      }).catch(() => {});
    }
  }
}

async function failJob(jobId: string, message: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "FAILED", error: message.slice(0, 500) },
  }).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
