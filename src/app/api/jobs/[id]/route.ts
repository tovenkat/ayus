/**
 * GET /api/jobs/[id]
 *
 * Returns the status of a background job (queued extraction, etc.). The
 * upload UI polls this endpoint every ~1.5s while a job is PENDING or
 * RUNNING to show progress; once status is COMPLETED or FAILED, polling
 * stops and the client renders the final state.
 *
 * Access control: only the job's owning user may read it.
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const job = await prisma.job.findFirst({
    where: { id, userId: auth.userId },
    include: {
      upload: {
        select: { id: true, originalName: true, status: true, uploadType: true },
      },
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = (job.payload ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    id: job.id,
    status: job.status,
    type: job.type,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    upload: job.upload,
    progressPct: typeof payload.progressPct === "number" ? payload.progressPct : null,
    progressMessage: typeof payload.progressMessage === "string" ? payload.progressMessage : null,
    result: (payload.result as { reportIds?: string[]; documentsIngested?: number; warnings?: string[]; errors?: string[] } | undefined) ?? null,
  });
}
