/**
 * Obsidian Vault Upload API
 *
 * POST /api/upload/vault
 * Accepts: multipart/form-data with a .zip file of an Obsidian vault
 * Extracts all .md files and ingests them into the wiki.
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { ingestFile, resolveWikilinks, embedPendingChunks } from "@/lib/ingestion/pipeline";
import AdmZip from "adm-zip";

const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100 MB

const SUPPORTED_EXTENSIONS = new Set([
  ".md", ".txt", ".csv", ".json",
]);

// Skip Obsidian config and hidden files
function shouldSkip(filepath: string): boolean {
  const parts = filepath.split("/");
  return parts.some((p) =>
    p.startsWith(".") || p === "node_modules" || p === "__pycache__"
  );
}

function getMimeType(filename: string): string {
  if (filename.endsWith(".md")) return "text/markdown";
  if (filename.endsWith(".txt")) return "text/plain";
  if (filename.endsWith(".csv")) return "text/csv";
  if (filename.endsWith(".json")) return "application/json";
  return "text/plain";
}

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const rateLimit = checkApiRateLimit(userId, 5, 0.1); // 5 vault uploads per minute
  if (rateLimit) return rateLimit;

  try {
    const formData = await req.formData();
    const file = formData.get("vault") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No vault file provided" }, { status: 400 });
    }

    if (file.size > MAX_ZIP_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_ZIP_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // ── Extract zip ─────────────────────────────────────────────────────
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      return NextResponse.json(
        { error: "Invalid zip file. Please upload a .zip of your Obsidian vault." },
        { status: 400 }
      );
    }

    const entries = zip.getEntries();
    const mdFiles: { filename: string; content: string; mimeType: string }[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const filepath = entry.entryName;
      if (shouldSkip(filepath)) continue;

      const ext = "." + filepath.split(".").pop()?.toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const content = entry.getData().toString("utf-8");
      if (!content.trim()) continue;

      mdFiles.push({
        filename: filepath,
        content,
        mimeType: getMimeType(filepath),
      });
    }

    if (mdFiles.length === 0) {
      return NextResponse.json(
        { error: "No supported files found in the zip. Looking for: .md, .txt, .csv, .json" },
        { status: 400 }
      );
    }

    console.log(`[vault] Ingesting ${mdFiles.length} files from vault "${file.name}"`);

    // ── Ingest all files ────────────────────────────────────────────────
    const results = [];
    const errors: string[] = [];

    for (const mdFile of mdFiles) {
      try {
        const result = await ingestFile({
          filename: mdFile.filename,
          content: mdFile.content,
          mimeType: mdFile.mimeType,
          userId,
        });
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[vault] Failed to ingest ${mdFile.filename}: ${msg}`);
        errors.push(`${mdFile.filename}: ${msg}`);
      }
    }

    // ── Resolve cross-document wikilinks ─────────────────────────────────
    const resolved = await resolveWikilinks(userId);

    // ── Embed chunks (best-effort, don't fail the upload) ────────────────
    let embedded = 0;
    try {
      // Embed in batches until all done
      let batch = await embedPendingChunks(userId);
      while (batch > 0) {
        embedded += batch;
        batch = await embedPendingChunks(userId);
      }
    } catch (err) {
      console.warn("[vault] Embedding failed (vector search will be unavailable):", err instanceof Error ? err.message : err);
    }

    console.log(
      `[vault] Done: ${results.length} docs, ${errors.length} errors, ` +
      `${resolved} links resolved, ${embedded} chunks embedded`
    );

    return NextResponse.json({
      success: true,
      documents: results.length,
      totalTags: results.reduce((sum, r) => sum + r.tagsCreated, 0),
      totalChunks: results.reduce((sum, r) => sum + r.chunksCreated, 0),
      totalWikilinks: results.reduce((sum, r) => sum + r.wikilinksCreated, 0),
      wikilinksResolved: resolved,
      chunksEmbedded: embedded,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[vault] Upload error:", err);
    return NextResponse.json(
      { error: "Failed to process vault upload" },
      { status: 500 }
    );
  }
}
