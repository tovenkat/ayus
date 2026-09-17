/**
 * Extraction runner — processes a single Upload end-to-end.
 *
 * Used by:
 *   - `src/lib/jobs/extraction-worker.ts` — the background queue poller
 *
 * Reads the raw file from storage, parses text (with quality-based OCR
 * fallback), ingests it as a wiki document, and — when the upload is a lab
 * report — runs AI extraction + report ingestion + wiki generation.
 *
 * Progress is reported via the `onProgress(pct, message)` callback, which
 * the worker forwards to `Job.payload.progress` for client polling.
 *
 * Design choices:
 *   - Single self-contained function per upload; no cross-file state.
 *     Wiki-link resolution + chunk embedding run at the end of each job so
 *     there's no orchestrator-level finalizer to write. Both are idempotent
 *     — cheap when there's nothing to do.
 *   - Errors thrown here bubble up to the worker, which marks the Job FAILED
 *     and stashes the message. Non-fatal warnings (wiki, embedding failures)
 *     are logged but do not fail the job.
 */

import { prisma } from "@/lib/prisma";
import type { Upload } from "@prisma/client";
import { storage } from "@/lib/storage";
import { extractPdfTextByPage } from "@/lib/ingestion/parsers/pdf";
import { extractDocxText, DOCX_MIME } from "@/lib/ingestion/parsers/docx";
import { assessDocumentQuality, summarizeQuality } from "@/lib/extraction/quality";
import { isSidecarReachable, extractTextViaSidecar } from "@/lib/extraction/layout-strategy";
import { ingestFile, resolveWikilinks, embedPendingChunks } from "@/lib/ingestion/pipeline";
import { callOllamaExtraction } from "@/lib/extraction";
import { createReportFromExtraction } from "@/lib/services/report-ingestion";
import { synthesizeLabReport } from "@/lib/wiki-gen/synthesize";

export type ExtractionProgress = (pct: number, message: string) => void | Promise<void>;

export type ExtractionResult = {
  reportIds: string[];    // Report rows created by this job
  documentsIngested: number;
  warnings: string[];
  errors: string[];
};

export async function runExtractionForUpload(
  upload: Upload,
  onProgress?: ExtractionProgress,
): Promise<ExtractionResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reportIds: string[] = [];
  let documentsIngested = 0;

  const report = async (pct: number, message: string) => {
    try { await onProgress?.(pct, message); } catch { /* progress must never break the run */ }
  };

  await report(2, `Reading ${upload.originalName}`);
  const buffer = await storage.download(upload.storagePath);

  await prisma.upload.update({ where: { id: upload.id }, data: { status: "PROCESSING" } });

  const mime = upload.mimeType;

  // ── PDF / DOCX (text-first extraction) ───────────────────────────────────
  if (mime === "application/pdf" || mime === DOCX_MIME) {
    let pdfText: string;

    if (mime === DOCX_MIME) {
      // Word / Google Docs export — mammoth pulls plain text (incl. tables).
      pdfText = await extractDocxText(buffer);
      await report(8, `read ${pdfText.length.toLocaleString()} chars from document`);
      if (pdfText.length < 10) {
        throw new Error("DOCX has no extractable text (empty or image-only document)");
      }
    } else {
      const pageResult = await extractPdfTextByPage(buffer);
      pdfText = pageResult.total;

      const quality = assessDocumentQuality(pageResult.pages);
      await report(8, `${quality.numPages}p · mean quality ${quality.meanScore.toFixed(2)}`);
      console.log(`[extract-runner] "${upload.originalName}" quality: ${summarizeQuality(quality)} → ${quality.needsOcr ? "OCR" : "digital"}`);

      if (quality.needsOcr) {
        const sidecarUp = await isSidecarReachable();
        if (sidecarUp) {
          await report(10, `${quality.reason} — running Docling OCR`);
          try {
            const ocrText = await extractTextViaSidecar(buffer, mime, upload.originalName);
            if (ocrText.length > pdfText.length) {
              pdfText = ocrText;
              await report(14, `Docling OCR recovered ${pdfText.length.toLocaleString()} chars`);
            }
          } catch (ocrErr) {
            console.warn(`[extract-runner] Docling OCR failed for "${upload.originalName}":`, ocrErr instanceof Error ? ocrErr.message : ocrErr);
            warnings.push(`OCR failed: ${ocrErr instanceof Error ? ocrErr.message : "unknown error"}`);
          }
        }
      }

      if (pdfText.length < 10) {
        throw new Error("PDF has no extractable text (scanned image, no OCR available)");
      }
    }

    // Ingest as wiki doc (chunks, tags, wikilinks).
    await ingestFile({
      filename: upload.originalName, content: pdfText,
      mimeType: mime, userId: upload.userId, uploadId: upload.id,
    });
    documentsIngested++;

    if (upload.uploadType === "LAB_REPORT") {
      await report(20, "Analyzing with AI");
      const extractionResult = await callOllamaExtraction(pdfText, mime, buffer, (_step, msg) => {
        const m = msg.match(/(\d+)\s*\/\s*(\d+)/);
        let pct = 40;
        if (m) {
          const n = parseInt(m[1], 10), tot = parseInt(m[2], 10);
          if (tot > 0) pct = 25 + (n / tot) * 50;
        }
        void report(pct, msg);
      }, upload.userId);

      // Completeness safeguard: recover any tests present in the source text
      // but missed by the extractor (long-report tail-drop), before persistence
      // so they get the same enrichment. No-op unless EXTRACTION_COMPLETENESS_CHECK=true.
      try {
        const { completeExtraction } = await import("@/lib/extraction/completeness");
        const comp = await completeExtraction(upload.userId, pdfText, extractionResult);
        if (comp.added > 0) await report(35, `recovered ${comp.added} missed test${comp.added !== 1 ? "s" : ""}`);
      } catch (compErr) {
        warnings.push(`completeness: ${compErr instanceof Error ? compErr.message : String(compErr)}`);
      }

      const ingested = await createReportFromExtraction(upload.userId, upload.id, extractionResult);
      if (ingested) {
        reportIds.push(ingested.reportId);
        await report(85, `validated ${ingested.testCount} test${ingested.testCount !== 1 ? "s" : ""}${ingested.needsReview ? " (needs review)" : ""}`);

        // Second-opinion pass: re-check low-confidence fields with the reviewer
        // model (Claude by default). No-op unless REVIEW_LOW_CONFIDENCE=true.
        try {
          const { reviewLowConfidenceResults } = await import("@/lib/extraction/reviewer");
          const rev = await reviewLowConfidenceResults(upload.userId, ingested.reportId, pdfText);
          if (rev.reviewed > 0) {
            await report(88, `reviewed ${rev.reviewed} uncertain field${rev.reviewed !== 1 ? "s" : ""}${rev.corrected ? ` (${rev.corrected} corrected)` : ""}`);
          }
        } catch (revErr) {
          const msg = revErr instanceof Error ? revErr.message : String(revErr);
          console.warn(`[extract-runner] reviewer pass failed for "${upload.originalName}":`, msg);
          warnings.push(`reviewer: ${msg}`);
        }

        // Wiki pages
        try {
          await report(90, "generating wiki pages");
          const fullReport = await prisma.report.findUnique({
            where: { id: ingested.reportId },
            include: { testResults: true },
          });
          if (fullReport) {
            await synthesizeLabReport(upload.userId, {
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
          }
        } catch (wikiErr) {
          const msg = wikiErr instanceof Error ? wikiErr.message : String(wikiErr);
          console.warn(`[extract-runner] wiki generation failed for "${upload.originalName}":`, msg);
          warnings.push(`wiki: ${msg}`);
        }
      }
    } else {
      // Clinical extraction path (non-lab PDF)
      try {
        await report(30, `analyzing (${upload.uploadType.toLowerCase().replace("_", " ")})`);
        const { extractClinicalReport } = await import("@/lib/clinical-extraction");
        const { persistClinicalReport } = await import("@/lib/clinical-extraction/synthesize");
        const dispatch = await extractClinicalReport(upload.userId, pdfText, { uploadType: upload.uploadType });
        const persist = await persistClinicalReport({
          userId: upload.userId,
          uploadId: upload.id,
          kind: dispatch.kind,
          extraction: dispatch.extraction,
          classificationConfidence: dispatch.classificationConfidence,
          entities: dispatch.entities,
        });
        await report(85, `classified as ${dispatch.kind}${persist.medicationsAdded ? ` (+${persist.medicationsAdded} meds)` : ""}`);
      } catch (clinicalErr) {
        const msg = clinicalErr instanceof Error ? clinicalErr.message : String(clinicalErr);
        console.warn(`[extract-runner] clinical extraction failed:`, msg);
        warnings.push(`clinical: ${msg}`);
      }
    }
  }
  // ── Image ──────────────────────────────────────────────────────────────
  else if (mime.startsWith("image/")) {
    await ingestFile({
      filename: upload.originalName, content: `[Image: ${upload.originalName}]`,
      mimeType: mime, userId: upload.userId, uploadId: upload.id,
    });
    documentsIngested++;

    if (upload.uploadType === "LAB_REPORT") {
      await report(25, "Analyzing image with vision model");
      const extractionResult = await callOllamaExtraction("", mime, buffer, (_step, msg) => {
        void report(50, msg);
      }, upload.userId);
      const ingested = await createReportFromExtraction(upload.userId, upload.id, extractionResult);
      if (ingested) {
        reportIds.push(ingested.reportId);
        await report(85, `validated ${ingested.testCount} test${ingested.testCount !== 1 ? "s" : ""}`);
      }
    }
  }
  // ── Text-based (md/txt/csv/json) ───────────────────────────────────────
  else {
    const content = buffer.toString("utf-8");
    await ingestFile({
      filename: upload.originalName, content,
      mimeType: mime, userId: upload.userId, uploadId: upload.id,
    });
    documentsIngested++;
    await report(80, "ingested");
  }

  // Post-loop finalisation. Both are idempotent — cheap when there's nothing
  // pending. Running them per-job avoids needing an orchestrator to trigger
  // them once after a batch.
  await report(94, "resolving wiki links");
  try { await resolveWikilinks(upload.userId); } catch (err) {
    warnings.push(`wikilinks: ${err instanceof Error ? err.message : "unknown"}`);
  }

  await report(96, "embedding for search");
  try {
    let batch = await embedPendingChunks(upload.userId);
    while (batch > 0) batch = await embedPendingChunks(upload.userId);
  } catch (err) {
    warnings.push(`embedding: ${err instanceof Error ? err.message : "unknown"}`);
  }

  await prisma.upload.update({ where: { id: upload.id }, data: { status: "READY" } });
  await report(100, "done");

  return { reportIds, documentsIngested, warnings, errors };
}
