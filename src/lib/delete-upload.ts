import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { appendLog } from "@/lib/vault";
import { toSlug } from "@/lib/ingestion/parsers/markdown";

function getVaultRoot(): string {
  return process.env.VAULT_ROOT ?? path.join(process.cwd(), "phr2");
}

function userScope(userId: string): string {
  return path.join(getVaultRoot(), userId);
}

async function safeUnlink(absPath: string): Promise<boolean> {
  try {
    await fs.unlink(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the wiki markdown file from disk and its cached Document + chunks + vectors.
 * Returns true if anything was actually removed.
 */
async function removeWikiPage(userId: string, relPath: string): Promise<boolean> {
  const abs = path.join(userScope(userId), "wiki", relPath);
  const existed = await safeUnlink(abs);

  const slug = toSlug(relPath.replace(/\.md$/i, "").replace(/\//g, "-"));
  const doc = await prisma.document.findUnique({
    where: { userId_slug: { userId, slug } },
    select: { id: true, chunks: { select: { id: true } } },
  });
  if (doc) {
    const chunkIds = doc.chunks.map((c) => c.id);
    if (chunkIds.length > 0) {
      try {
        const { getVectorStore } = await import("@/lib/ai/vector-store");
        const store = await getVectorStore();
        if (store) await store.delete("wiki_chunks", chunkIds);
      } catch (err) {
        console.warn(`[delete-upload] vector delete failed:`, err instanceof Error ? err.message : err);
      }
    }
    // deleteMany (not delete) so we don't throw on P2025 when a parallel
    // cascade pass has already removed this Document — happens when the same
    // biomarker entity page is referenced by multiple reports in one upload.
    await prisma.document.deleteMany({ where: { id: doc.id } });
  }
  return existed || !!doc;
}

/**
 * Parse a biomarker entity page and strip the history block(s) that reference a
 * specific report date. Returns the rewritten content, or null if no history entries
 * remain (caller should delete the page).
 */
function stripReportFromEntity(content: string, dateFormatted: string): string | null {
  const marker = `[[Lab Report — ${dateFormatted}]]`;
  const lines = content.split("\n");
  const out: string[] = [];
  let skipUntilNextHeading = false;
  let skippedBlockContainedMarker = false;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (skippedBlockContainedMarker) {
      // Drop the buffer entirely
      skippedBlockContainedMarker = false;
    } else {
      out.push(...buffer);
    }
    buffer = [];
  };

  for (const line of lines) {
    // Each reading block starts with "### <date>" — detect a new one
    if (/^###\s/.test(line)) {
      if (skipUntilNextHeading) {
        flushBuffer();
      }
      skipUntilNextHeading = true;
      skippedBlockContainedMarker = false;
      buffer = [line];
      continue;
    }

    if (skipUntilNextHeading) {
      buffer.push(line);
      if (line.includes(marker)) skippedBlockContainedMarker = true;
      // An H2 ends the current H3 block
      if (/^##\s/.test(line) && !/^###\s/.test(line)) {
        flushBuffer();
        skipUntilNextHeading = false;
        out.push(line);
      }
      continue;
    }

    out.push(line);
  }

  // Flush tail
  if (skipUntilNextHeading) flushBuffer();

  const result = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  // If no remaining history entries, caller should delete the page
  const hasRemainingReadings = /^###\s/m.test(result);
  return hasRemainingReadings ? result : null;
}

/**
 * Delete an Upload and every piece of derived data: DB records, storage, vault
 * wiki pages, raw-copy, biomarker history entries, LanceDB vectors, and log entry.
 * Idempotent — safe to call multiple times.
 */
export async function cascadeDeleteUpload(userId: string, uploadId: string): Promise<void> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    include: {
      report: {
        include: {
          testResults: {
            select: { normalizedName: true },
          },
        },
      },
    },
  });

  if (!upload || upload.userId !== userId) return;

  const report = upload.report;

  // ── 0. Health alerts for this report ───────────────────────────────────────
  // BiomarkerAlert has a plain reportId (no FK), so the Upload→Report cascade
  // doesn't remove them — delete them explicitly or they linger in the bell.
  if (report) {
    await prisma.biomarkerAlert.deleteMany({ where: { userId, reportId: report.id } });
  }

  // ── 1. Storage (uploads/ dir) ──────────────────────────────────────────────
  await storage.delete(upload.storagePath).catch(() => {});

  // ── 2. Raw copy in vault ──────────────────────────────────────────────────
  try {
    const rawDir = path.join(userScope(userId), "raw");
    const entries = await fs.readdir(rawDir).catch(() => []);
    const prefix = upload.sha256.slice(0, 12);
    for (const name of entries) {
      if (name.startsWith(prefix)) {
        await safeUnlink(path.join(rawDir, name));
      }
    }
  } catch (err) {
    console.warn(`[delete-upload] raw cleanup failed:`, err instanceof Error ? err.message : err);
  }

  // ── 3. Wiki pages derived from the report ─────────────────────────────────
  if (report) {
    const dateStr = report.sampleCollectedOn
      ? report.sampleCollectedOn.toISOString().split("T")[0]
      : report.createdAt.toISOString().split("T")[0];
    const dateFormatted = report.sampleCollectedOn
      ? report.sampleCollectedOn.toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        })
      : report.createdAt.toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        });

    // Delete the lab-report summary
    await removeWikiPage(userId, `lab-reports/${dateStr}.md`);

    // Clean up biomarker entity pages. This is driven by the DATABASE, not the
    // disk file — the vault may live on a different/ephemeral filesystem than
    // the one serving this request, so a missing .md file must not leave the
    // Document (which is what Health Notes + Graph read) orphaned.
    const uniqueNames = Array.from(
      new Set(report.testResults.map((t) => t.normalizedName)),
    );
    for (const name of uniqueNames) {
      const slug = toSlug(name);
      const entityRel = `entities/${slug}.md`;

      // Is this biomarker still referenced by any OTHER report? (The deleted
      // report's TestResults still exist here — we delete the Upload at step 5.)
      const otherRefs = await prisma.testResult.count({
        where: { userId, normalizedName: name, reportId: { not: report.id } },
      });

      if (otherRefs === 0) {
        // Only this report had it → remove the entity page + DB doc + vectors.
        await removeWikiPage(userId, entityRel);
      } else {
        // Still referenced → best-effort strip this report's readings from the
        // on-disk page if present; the DB Document correctly stays either way.
        const abs = path.join(userScope(userId), "wiki", entityRel);
        try {
          const content = await fs.readFile(abs, "utf8");
          const rewritten = stripReportFromEntity(content, dateFormatted);
          if (rewritten !== null) {
            await fs.writeFile(abs, rewritten);
            const { indexFileFromDisk } = await import("@/lib/vault-reconcile");
            await indexFileFromDisk(userId, entityRel);
          }
        } catch {
          // No disk file on this filesystem — nothing to strip; DB doc stays.
        }
      }
    }
  }

  // ── 4. If this upload produced a non-lab Document (markdown, image), clear it ─
  if (!report) {
    const doc = await prisma.document.findUnique({
      where: { uploadId },
      select: { id: true, slug: true, chunks: { select: { id: true } } },
    });
    if (doc) {
      const chunkIds = doc.chunks.map((c) => c.id);
      if (chunkIds.length > 0) {
        try {
          const { getVectorStore } = await import("@/lib/ai/vector-store");
          const store = await getVectorStore();
          if (store) await store.delete("wiki_chunks", chunkIds);
        } catch (err) {
          console.warn(`[delete-upload] vector delete failed:`, err instanceof Error ? err.message : err);
        }
      }
      await prisma.document.deleteMany({ where: { id: doc.id } });
    }
  }

  // ── 5. Delete the Upload row — Prisma cascade handles Report + TestResult + Jobs ─
  await prisma.upload.delete({ where: { id: uploadId } });

  // ── 6. Rebuild master index + log ─────────────────────────────────────────
  try {
    const { updateMasterIndex } = await import("@/lib/wiki-gen/synthesize");
    await updateMasterIndex(userId);
  } catch (err) {
    console.warn(`[delete-upload] index rebuild failed:`, err instanceof Error ? err.message : err);
  }

  await appendLog(
    userId,
    `deleted upload "${upload.originalName}" (${upload.sha256.slice(0, 8)}) — ${report ? "report + biomarker history cleaned" : "document cleaned"}`,
  );

  console.log(`[delete-upload] ${uploadId} (${upload.originalName}): fully cascaded`);
}
