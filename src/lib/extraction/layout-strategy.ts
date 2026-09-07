/**
 * Layout-first extraction strategy.
 *
 * Pipeline: PaddleOCR PP-Structure sidecar → deterministic row parser →
 * (Stage 2) LLM fallback for uncertain rows.
 *
 * Contract: returns extraction JSON in the exact same shape as the existing
 * LLM extraction path, so the downstream ingestion service (biomarker
 * resolver, validators, deterministic post-processing) works unchanged.
 *
 * Advantages over pure LLM extraction:
 *   1. Table column mapping is deterministic (no misaligned rows).
 *   2. Per-cell OCR quality tends to be better than vision-LLM-on-page.
 *   3. Small local models never see the "300-line prompt" — they only
 *      handle metadata + edge cases (Stage 2).
 *
 * Requires the sidecar at LAYOUT_SIDECAR_URL to be running. See
 * scripts/layout-sidecar/README.md for setup.
 */

import { parse as parseHtml } from "node-html-parser";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { loadAIConfig } from "@/lib/ai/config";
import {
  fromDocling, blocksOfKind, topOfDocumentText,
  type CanonicalDocument, type DoclingResponse,
} from "@/lib/extraction/canonical";

/**
 * Long-request undici dispatcher for the sidecar. Node's default `fetch`
 * uses a 5-minute `headersTimeout` — a 20-page PDF through PaddleOCR
 * PP-Structure blows past that easily. Raise to 20 minutes; the sidecar's
 * own ANALYZE_TIMEOUT_SEC (default 600s) is the real ceiling.
 */
const LONG_REQUEST_AGENT = new Agent({
  headersTimeout: 20 * 60 * 1000, // 20 min
  bodyTimeout: 20 * 60 * 1000,    // 20 min
  connect: {
    timeout: 10_000,               // 10 s to establish connection is still short
    // TCP keepalive: send small probe packets during idle periods so
    // Docker Desktop's network proxy doesn't consider the connection idle
    // and kill it. macOS default keepalive delay is 2 hours — override.
    keepAlive: true,
    keepAliveInitialDelay: 10_000, // start probing after 10 s of idle
  },
});

// ─── Contract types (must match the shape callOllamaExtraction returns) ─────

export type ExtractedTest = {
  raw_test_name?: string;
  normalized_test_name?: string;
  observed_value_raw?: string | number;
  observed_value_numeric?: number | null;
  observed_value_operator?: string | null;
  observed_value_unit?: string | null;
  reference_interval_raw?: string | null;
  reference_low?: number | null;
  reference_high?: number | null;
  reference_unit?: string | null;
  interpretation?: string;
  confidence?: number;
  /** 1-indexed page in the source PDF this test came from. Nullable when the
   *  extractor doesn't know (LLM-only path today). Layout path fills it in. */
  source_page?: number | null;
};

export type ExtractionResult = {
  tests: ExtractedTest[];
  report: {
    report_date: string | null;
    date_source: "sample_collected" | "report_date" | "unknown";
    referred_by: string | null;
    sample_type: string | null;
    confidence: number;
  };
};

// ─── Sidecar client ─────────────────────────────────────────────────────────

type SidecarRegion = {
  id: string;
  type: string;   // "text" | "title" | "table" | "figure" | "figure_caption" | ...
  bbox: [number, number, number, number];
  text: string;
  html?: string;  // only for tables
};

type SidecarPage = {
  page: number;
  width: number;
  height: number;
  regions: SidecarRegion[];
};

type SidecarResponse = {
  analysis_id: string;
  pages: SidecarPage[];
};

async function analyzeViaSidecar(buffer: Buffer, mimeType: string, filename: string): Promise<SidecarResponse> {
  const { layoutSidecarUrl } = loadAIConfig();

  // Use undici's own fetch + FormData + Blob rather than the Node globals.
  // Node's global fetch (which IS undici under the hood, but wrapped) has
  // fragile behavior with multipart bodies + custom dispatcher + large blobs.
  // Going straight to undici sidesteps the wrapper.
  const form = new UndiciFormData();
  // Use the global Blob (Node 18+). undici's FormData accepts a global Blob
  // and streams it correctly. Passing `buffer` directly (as Uint8Array) into
  // the Blob avoids an extra copy.
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, filename);

  console.log(`[extract:layout] POST ${layoutSidecarUrl}/analyze  size=${buffer.length} mime=${mimeType}`);

  let res;
  try {
    res = await undiciFetch(`${layoutSidecarUrl}/analyze`, {
      method: "POST",
      body: form,
      dispatcher: LONG_REQUEST_AGENT,
    });
  } catch (err) {
    // Expose the real error via err.cause. Node's generic "fetch failed"
    // hides the actual TCP / DNS / TLS / stream error.
    const cause = err instanceof Error && "cause" in err
      ? (err as { cause?: unknown }).cause
      : undefined;
    console.error(
      `[extract:layout] fetch to /analyze threw:`,
      err instanceof Error ? err.message : err,
      cause ? `\n  cause: ${cause instanceof Error ? cause.message : JSON.stringify(cause)}` : "",
      cause instanceof Error && cause.stack ? `\n  cause.stack: ${cause.stack.split("\n").slice(0, 4).join("\n")}` : "",
    );
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`layout sidecar /analyze returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as SidecarResponse;
}

/** Health check so callers can decide whether to fall back to LLM path. */
export async function isSidecarReachable(): Promise<boolean> {
  const { layoutSidecarUrl } = loadAIConfig();
  try {
    const res = await fetch(`${layoutSidecarUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * OCR-only fallback: run Docling and return page-ordered plain text.
 *
 * Used by the upload route when the digital PDF text layer is empty/sparse
 * (scanned or image-only PDFs). The output is a drop-in replacement for
 * `extractPdfText`'s return — a single string fed to the LLM extractor.
 * Tables get inlined as their plain text; if you need structured table
 * parsing use `extractViaLayout()` instead.
 */
export async function extractTextViaSidecar(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const analysis = await analyzeViaSidecar(buffer, mimeType, filename);
  return analysis.pages
    .map((p) => p.regions.map((r) => r.text.trim()).filter(Boolean).join("\n"))
    .join("\n\n")
    .trim();
}

// ─── HTML table parser ─────────────────────────────────────────────────────

type ParsedTable = {
  headerRow: string[];
  dataRows: string[][];
};

/**
 * Parse the reconstructed table HTML PaddleOCR returns into rows of cells.
 * PP-Structure outputs a well-formed <table> with <tr>/<td>; some models emit
 * <th> for the header. We handle both by treating the first row as header
 * regardless of tag.
 */
function parseTableHtml(html: string): ParsedTable | null {
  try {
    const root = parseHtml(html);
    const tableEl = root.querySelector("table");
    if (!tableEl) return null;

    const rows: string[][] = [];
    for (const tr of tableEl.querySelectorAll("tr")) {
      const cells = tr.querySelectorAll("td, th").map((c) =>
        c.text.replace(/\s+/g, " ").trim()
      );
      if (cells.length > 0 && cells.some((c) => c.length > 0)) rows.push(cells);
    }
    if (rows.length < 2) return null; // need at least header + one data row

    return { headerRow: rows[0], dataRows: rows.slice(1) };
  } catch {
    return null;
  }
}

// ─── Column mapping (deterministic header inference) ───────────────────────

type ColumnMap = {
  name: number;
  value: number;
  unit: number | null;
  reference: number | null;
  flag: number | null;
};

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Map column indices from the header row. Returns null if we can't identify
 * at least name + value columns — caller should skip the whole table or
 * hand it to the LLM fallback.
 */
function mapColumns(header: string[]): ColumnMap | null {
  const findFirst = (patterns: RegExp[]) => {
    for (let i = 0; i < header.length; i++) {
      const h = normalizeHeader(header[i]);
      if (patterns.some((p) => p.test(h))) return i;
    }
    return null;
  };

  const name = findFirst([/^test$/, /^parameter$/, /^investigation$/, /^analyte$/, /^testname/, /^parametername/]);
  const value = findFirst([/^result$/, /^value$/, /^observed/, /^observation/, /^actual/, /^readings?$/]);
  const unit = findFirst([/^units?$/, /^uom$/]);
  // Reference-range column: covers "Reference Range", "Ref Range", "Ref. Range",
  // "Reference Interval", "Ref Interval", "Bio. Ref. Interval", "Bio Ref Range",
  // "Normal Range", "Biological Range". Header normalization strips non-letters,
  // so "Ref. Range" → "refrange", "Bio. Ref. Interval" → "biolrefinterval".
  const reference = findFirst([
    /^reference/,
    /^ref(range|interval|values?)?$/,
    /^range$/,
    /^normal/,
    /^biological/,
    /^biol?ref/,
    /^biolrange/,
  ]);
  const flag = findFirst([/^flag$/, /^status$/, /^remarks?$/, /^interpretation/, /^hl$/]);

  if (name === null || value === null) return null;
  return { name, value, unit, reference, flag };
}

// ─── Deterministic row parser ──────────────────────────────────────────────

/**
 * Convert one data row's cells into an ExtractedTest shape. Returns null when
 * the row is clearly not test data (separator, sub-panel header, empty).
 */
function parseRow(cells: string[], cols: ColumnMap): ExtractedTest | null {
  const name = (cells[cols.name] ?? "").trim();
  const value = (cells[cols.value] ?? "").trim();
  if (!name || !value) return null;

  // Skip separator / section-header rows
  if (/^[-—_=\s]{3,}$/.test(name)) return null;
  if (name.length > 120) return null;              // too long, almost certainly a comment
  if (/^(subtotal|total|panel|section|test group|remarks?|note|comments?)$/i.test(name)) return null;
  // Values that are actually panel headers ("---" or ":") also skip
  if (/^[-—_=:\s]+$/.test(value)) return null;

  const unit = cols.unit !== null ? ((cells[cols.unit] ?? "").trim() || null) : null;
  let ref = cols.reference !== null ? ((cells[cols.reference] ?? "").trim() || null) : null;
  let flag = cols.flag !== null ? ((cells[cols.flag] ?? "").trim() || null) : null;

  // Rescue passes — Docling occasionally puts the ref interval or the H/L flag
  // in a cell that wasn't mapped (either the header for that column was oddly
  // spelled, or the report inlined "Bio. Ref. Interval. :- 0.2 - 20" into an
  // adjacent cell). Scan the row's OTHER cells before giving up.
  if (!ref) ref = findRefInRow(cells, cols);
  if (!flag) flag = findFlagInRow(cells, cols);

  // Feed the LLM-shape fields — downstream ingestion applies its own
  // deterministic parse of value/operator/range, so we can leave the numeric
  // fields null here. That's fine: parseOperator + parseReferenceRange in
  // report-ingestion will fill them in.
  return {
    raw_test_name: name,
    normalized_test_name: name,        // ingestion resolves via biomarker resolver
    observed_value_raw: value,
    observed_value_numeric: null,      // downstream derives
    observed_value_operator: null,
    observed_value_unit: unit,
    reference_interval_raw: ref,
    reference_low: null,               // downstream derives
    reference_high: null,
    reference_unit: unit,
    interpretation: flag && /^(H|HIGH|L|LOW|N|NORMAL)$/i.test(flag) ? flag.toLowerCase() : "unknown",
    confidence: 0.9,                   // deterministic parse — high default
  };
}

/**
 * When mapColumns misses the reference column, scan every OTHER cell for
 * either (a) an inline "Bio. Ref. Interval. :- X" label + value, or (b) a
 * standalone range/operator string. Skips already-mapped cells so we don't
 * grab the value itself as the range.
 *
 * Deliberately conservative — only accepts strings that look like a range or
 * an operator-anchored bound, not bare single numbers (which are almost
 * certainly the observed value in a differently-mapped column).
 */
function findRefInRow(cells: string[], cols: ColumnMap): string | null {
  const skip = new Set<number>();
  for (const idx of [cols.name, cols.value, cols.unit, cols.flag]) if (idx !== null) skip.add(idx);

  const INLINE_LABEL = /(?:bio\.?\s*)?ref(?:erence|erring)?\.?\s*(?:interval|range|values?)?\.?\s*:?\s*[-—–]?\s*([<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?(?:\s*[\w%µμ/.]+)*)/i;
  const RANGE_ONLY  = /^\s*\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?(?:\s*[\w%µμ/.]+)*\s*$/;
  const OPERATOR    = /^\s*(?:[<>]=?|[≤≥])\s*\d+(?:\.\d+)?(?:\s*[\w%µμ/.]+)*\s*$/;

  for (let i = 0; i < cells.length; i++) {
    if (skip.has(i)) continue;
    const c = (cells[i] ?? "").trim();
    if (!c) continue;
    const labelMatch = c.match(INLINE_LABEL);
    if (labelMatch) return labelMatch[1].trim();
    if (RANGE_ONLY.test(c) || OPERATOR.test(c)) return c;
  }
  return null;
}

/**
 * Rescue pass for the H / L / NORMAL flag when the report doesn't have a
 * clear status column. Same skip-mapped-cells discipline.
 */
function findFlagInRow(cells: string[], cols: ColumnMap): string | null {
  const skip = new Set<number>();
  for (const idx of [cols.name, cols.value, cols.unit, cols.reference]) if (idx !== null) skip.add(idx);
  for (let i = 0; i < cells.length; i++) {
    if (skip.has(i)) continue;
    const c = (cells[i] ?? "").trim();
    if (/^(H|L|N|HIGH|LOW|NORMAL|HH|LL|CRITICAL|ABN|ABNORMAL)$/i.test(c)) return c;
  }
  return null;
}

// ─── Report metadata extraction from non-table regions ─────────────────────

type Metadata = ExtractionResult["report"];

const DATE_LABELS = /\b(?:sample\s*collected\s*(?:on)?|collection\s*date|collected\s*on|sample\s*received|report\s*date|reported\s*on|printed\s*on|date\s*of\s*collection)\s*[:\-]?\s*([^\n|]+)/i;
const REFERRED_BY_LABELS = /\b(?:ref(?:erring)?\.?\s*(?:by|dr|physician)|ordering\s*physician|consultant|referred\s*by|referring\s*doctor|requested\s*by|req\.?\s*by)\s*[:\-]?\s*([^\n|]+)/i;
// Require an explicit type-ish suffix so we don't grab dates from
// "Sample Collected On" or "Sample Received".
const SAMPLE_LABELS = /\b(?:sample\s*(?:type|material)|specimen\s*(?:type)?|specimen)\s*[:\-]?\s*([^\n|]+)/i;

function extractMetadata(regions: SidecarRegion[]): Metadata {
  // Include tables here too — most Indian lab-report headers put patient meta
  // ("Sample Collected On", "Referred By", "Sample Type") inside a two-column
  // key/value table at the top of the page. Docling emits those as `table`
  // regions; the earlier filter dropped them and the regexes saw nothing.
  const topText = regions
    .filter((r) => r.type === "title" || r.type === "text" || r.type === "header" || r.type === "table")
    .slice(0, 12)
    .map((r) => r.text || htmlToText(r.html))
    .filter(Boolean)
    .join("\n");
  return extractMetadataFromTopText(topText);
}

/**
 * Canonical-document metadata extractor. Reads header text from the first
 * couple of pages via topOfDocumentText, which already knows how to inline
 * key/value tables so patient-details tables are visible to the label regex.
 */
function extractMetadataFromCanonical(doc: CanonicalDocument): Metadata {
  const topText = topOfDocumentText(doc, 2);
  return extractMetadataFromTopText(topText);
}

function extractMetadataFromTopText(topText: string): Metadata {

  const dateMatch = topText.match(DATE_LABELS);
  const referredMatch = topText.match(REFERRED_BY_LABELS);
  const sampleMatch = topText.match(SAMPLE_LABELS);

  // Very light normalisation. The full sanitizers in extraction.ts run
  // downstream on the ingestion side — no need to duplicate them here.
  const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

  return {
    report_date: dateMatch ? tryFormatDate(clean(dateMatch[1])) : null,
    date_source: dateMatch ? guessDateSource(dateMatch[0]) : "unknown",
    referred_by: referredMatch ? clean(referredMatch[1]) : null,
    sample_type: sampleMatch ? clean(sampleMatch[1]) : null,
    confidence: 0.7, // deterministic but only regex — moderate confidence
  };
}

function tryFormatDate(s: string): string | null {
  // Handles DD/MM/YYYY (Indian standard) and YYYY-MM-DD; falls through to null.
  const dmyMatch = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (dmyMatch) {
    let [, d, m, y] = dmyMatch;
    if (y.length === 2) y = Number(y) < 50 ? `20${y}` : `19${y}`;
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ymdMatch = s.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}-${ymdMatch[3].padStart(2, "0")}`;
  }
  return null;
}

function guessDateSource(labelBlock: string): "sample_collected" | "report_date" | "unknown" {
  if (/sample|collected/i.test(labelBlock)) return "sample_collected";
  if (/report|printed|reported/i.test(labelBlock)) return "report_date";
  return "unknown";
}

/**
 * Strip HTML tags and unescape entities into a plain text stream. Used when a
 * region has HTML (tables) but no populated `text` field. Deliberately simple
 * — we don't need cell-perfect reconstruction, just enough text for the label
 * regexes above to find "Sample Collected On:", "Ref.By:" etc.
 */
function htmlToText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\/?(?:tr|td|th|br|p|div|li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ─── Main entry ────────────────────────────────────────────────────────────

/**
 * Extract structured lab data via the layout sidecar.
 *
 * Flow:
 *   1. Docling sidecar returns raw regions + HTML.
 *   2. Adapter converts that into a CanonicalDocument — the single
 *      intermediate representation with typed blocks, structured table rows
 *      (already parsed), coordinates, and provenance.
 *   3. Downstream extractors (tests + metadata) read from the canonical doc,
 *      not from HTML strings or region arrays. This means:
 *        - a new backend (image OCR, other layout engine) only needs an
 *          adapter to fromDocling-style, no downstream refactor.
 *        - each block carries its bbox + originating region ID, so
 *          extraction errors can be traced back to a specific page region.
 *
 * Throws if the sidecar is unreachable or returns a non-2xx; callers should
 * catch and fall back to the LLM path.
 */
export async function extractViaLayout(
  buffer: Buffer,
  mimeType: string,
  filename: string = "upload",
): Promise<ExtractionResult> {
  const t0 = Date.now();
  const analysis = await analyzeViaSidecar(buffer, mimeType, filename);

  // Convert Docling raw output → canonical intermediate. From here on, no
  // downstream code touches SidecarRegion / raw HTML strings directly.
  const doc = fromDocling(analysis as DoclingResponse, { filename, version: "docling" });

  const totalRegions = doc.pages.reduce((sum, p) => sum + p.blocks.length, 0);
  const totalTableCount = doc.pages.reduce((sum, p) => sum + p.blocks.filter((b) => b.kind === "table").length, 0);
  console.log(
    `[extract:layout] canonical doc built: ${doc.pages.length} page(s), ${totalRegions} block(s), ${totalTableCount} table(s) — strategyChain=${doc.meta.strategyChain.join("→")}`,
  );

  // Extract test rows from every table block. Walk pages so we know which
  // page each table belongs to — populated as `source_page` on every test
  // for provenance in the review UI.
  const tests: ExtractedTest[] = [];
  let skippedTables = 0;
  let skippedRows = 0;

  for (const page of doc.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "table") continue;
      if (block.rows.length < 2) { skippedTables++; continue; }
      const headerRow = block.rows.find((r) => r.isHeader) ?? block.rows[0];
      const dataRows = block.rows.filter((r) => r !== headerRow);
      const cols = mapColumns(headerRow.cells.map((c) => c.text));
      if (!cols) {
        skippedTables++;
        continue;
      }
      for (const row of dataRows) {
        const cellText = row.cells.map((c) => c.text);
        const test = parseRow(cellText, cols);
        if (test) {
          test.source_page = page.pageNum;
          tests.push(test);
        } else {
          skippedRows++;
        }
      }
    }
  }

  // Metadata extractor reads directly from the canonical doc — the topText
  // helper concatenates the first pages including linearized table cells,
  // which is exactly what the header-metadata regexes need.
  const metadata = extractMetadataFromCanonical(doc);

  console.log(
    `[extract:layout] parsed tests=${tests.length}, skipped_tables=${skippedTables}, skipped_rows=${skippedRows}, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  return { tests, report: metadata };
}
