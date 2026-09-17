/**
 * Health Document Upload API — queued mode.
 *
 * POST /api/upload
 *   Accepts: multipart/form-data with one or more files
 *   Supports: .pdf, .md, .txt, .csv, .json, .jpg, .jpeg, .png, .zip (vault)
 *
 *   For each accepted file:
 *     1. Validates size / MIME.
 *     2. Deduplicates by (userId, sha256).
 *     3. Persists the raw file via `storage.upload` + `copyToRaw` (vault).
 *     4. Creates the `Upload` row with status = UPLOADED.
 *     5. Enqueues an `EXTRACT` Job that the background worker will process.
 *
 *   Returns immediately with `{ uploads: [...], jobs: [...], errors: [...] }`.
 *   No extraction happens on this request — the client polls
 *   GET /api/jobs/[id] for status + progress.
 *
 * ZIP files are still expanded inline (each entry gets an Upload + Job) —
 * that's cheap and lets a single POST fan out into N background jobs.
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { checkPatientAccess, getRosterOrg } from "@/lib/patient-roster";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";
import { copyToRaw, safeFileName } from "@/lib/vault";
import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import type { UploadType } from "@prisma/client";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB per file
const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100 MB for zips

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  [DOCX_MIME]: ".docx",
  "text/markdown": ".md",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/json": ".json",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
};

// Also match by extension for browsers that send wrong MIME
const EXT_MIMES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": DOCX_MIME,
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".zip": "application/zip",
};

function getExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function resolveMime(file: File): string {
  const ext = getExt(file.name);
  // A .docx is a ZIP under the hood, so some browsers report application/zip.
  // Pin by extension so it's never misrouted into the ZIP-expansion path.
  if (ext === ".docx") return DOCX_MIME;
  if (ALLOWED_TYPES[file.type]) return file.type;
  return EXT_MIMES[ext] ?? file.type;
}

function shouldSkipZipEntry(filepath: string): boolean {
  const parts = filepath.split("/");
  return parts.some((p) =>
    p.startsWith(".") || p === "node_modules" || p === "__pycache__" || p === "__MACOSX"
  );
}

type QueuedFile = {
  buffer: Buffer;
  originalName: string;
  mime: string;
  ext: string;
  sha256: string;
  size: number;
};

/**
 * Attribution for upload-on-behalf-of. When set, the Upload (and resulting
 * Report) is OWNED by `ownerId` (the patient) so it lands in their records,
 * while `organizationId` + `uploadedById` record the acting lab. The Job stays
 * owned by the actor (`actorUserId`) so they can poll extraction progress.
 */
type Attribution = { ownerId: string; organizationId: string; uploadedById: string };

/** Store a file + create Upload + enqueue Job. Returns null on duplicate. */
async function enqueueOne(
  actorUserId: string,
  file: QueuedFile,
  uploadType: UploadType,
  attribution?: Attribution,
): Promise<{ uploadId: string; jobId: string; originalName: string } | { skipped: string }> {
  const ownerId = attribution?.ownerId ?? actorUserId;
  const storagePath = `${ownerId}/${file.sha256}${file.ext}`;

  const existing = await prisma.upload.findUnique({
    where: { userId_sha256: { userId: ownerId, sha256: file.sha256 } },
  });
  if (existing) return { skipped: `${file.originalName}: already uploaded (duplicate)` };

  await storage.upload(storagePath, file.buffer, file.mime);
  await copyToRaw(ownerId, `${file.sha256.slice(0, 12)}-${safeFileName(file.originalName)}`, file.buffer);

  const upload = await prisma.upload.create({
    data: {
      userId: ownerId,
      organizationId: attribution?.organizationId ?? null,
      uploadedById: attribution?.uploadedById ?? null,
      originalName: file.originalName,
      storagePath,
      mimeType: file.mime,
      sizeBytes: file.size,
      sha256: file.sha256,
      uploadType,
      status: "UPLOADED",
    },
  });

  const job = await prisma.job.create({
    data: {
      userId: actorUserId,
      uploadId: upload.id,
      type: "EXTRACT",
      status: "PENDING",
      payload: {
        originalName: file.originalName,
        uploadType,
        mimeType: file.mime,
        sizeBytes: file.size,
        progressPct: 0,
        progressMessage: "queued",
      },
    },
  });

  return { uploadId: upload.id, jobId: job.id, originalName: file.originalName };
}

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const rateLimit = checkApiRateLimit(userId, 10, 0.2);
  if (rateLimit) return rateLimit;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const files = formData.getAll("files") as File[];
  const singleFile = formData.get("file") as File | null;
  if (singleFile && files.length === 0) files.push(singleFile);
  const vaultFile = formData.get("vault") as File | null;
  if (vaultFile && files.length === 0) files.push(vaultFile);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }
  const uploadTypeRaw = (formData.get("uploadType") as string) ?? "OTHER";
  const uploadType = (["LAB_REPORT", "PRESCRIPTION", "DISCHARGE_SUMMARY", "DOCTOR_NOTE", "HEALTH_NOTE", "OTHER"].includes(uploadTypeRaw)
    ? uploadTypeRaw : "OTHER") as UploadType;

  // ── Upload-on-behalf-of: a roster account uploading for a consented patient.
  //    Requires a GRANTED PatientLink; the report lands in the patient's
  //    records, attributed to the caller's org.
  const patientId = (formData.get("patientId") as string | null)?.trim() || null;
  let attribution: Attribution | undefined;
  if (patientId) {
    const gate = await checkPatientAccess(userId, patientId);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.reason === "not_a_roster_account" ? "Not a roster account" : "No consent to upload for this patient" },
        { status: 403 },
      );
    }
    attribution = { ownerId: patientId, organizationId: gate.orgId, uploadedById: userId };
  } else {
    // A roster account uploading WITHOUT a patient → still attribute to the org
    // as an unassigned intake, so it shows on the lab dashboard / Reports list
    // immediately rather than vanishing (report owner stays the lab account).
    const org = await getRosterOrg(userId);
    if (org) attribution = { ownerId: userId, organizationId: org.orgId, uploadedById: userId };
  }

  const uploads: Array<{ uploadId: string; jobId: string; originalName: string }> = [];
  const errors: string[] = [];

  for (const file of files) {
    const mime = resolveMime(file);
    const ext = getExt(file.name);
    const maxSize = ext === ".zip" ? MAX_ZIP_SIZE : MAX_FILE_SIZE;

    if (file.size > maxSize) {
      errors.push(`${file.name}: exceeds ${maxSize / 1024 / 1024}MB limit`);
      continue;
    }
    if (!ALLOWED_TYPES[mime] && !EXT_MIMES[ext]) {
      errors.push(`${file.name}: unsupported file type (${mime})`);
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    // ── ZIP — expand and enqueue each entry as its own Upload + Job ─────
    if (ext === ".zip" || mime === "application/zip" || mime === "application/x-zip-compressed") {
      try {
        const zip = new AdmZip(buffer);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          if (shouldSkipZipEntry(entry.entryName)) continue;
          const entryExt = getExt(entry.entryName);
          const entryMime = EXT_MIMES[entryExt];
          if (!entryMime) continue;
          if (entryMime.startsWith("image/")) continue; // images inside zips: skip

          const entryBuffer = entry.getData();
          const entrySha = crypto.createHash("sha256").update(entryBuffer).digest("hex");
          const result = await enqueueOne(userId, {
            buffer: entryBuffer,
            originalName: entry.entryName,
            mime: entryMime,
            ext: entryExt,
            sha256: entrySha,
            size: entryBuffer.length,
          }, uploadType, attribution);
          if ("skipped" in result) errors.push(result.skipped);
          else uploads.push(result);
        }
      } catch {
        errors.push(`${file.name}: invalid zip file`);
      }
      continue;
    }

    const result = await enqueueOne(userId, {
      buffer, originalName: file.name, mime, ext, sha256, size: file.size,
    }, uploadType, attribution);
    if ("skipped" in result) errors.push(result.skipped);
    else uploads.push(result);
  }

  console.log(`[upload] enqueued ${uploads.length} job(s), ${errors.length} error(s)`);

  return NextResponse.json({
    success: true,
    queued: uploads.length,
    uploads,                                    // [{ uploadId, jobId, originalName }]
    jobIds: uploads.map((u) => u.jobId),        // convenience for the client poller
    errors: errors.length > 0 ? errors : undefined,
  });
}
