/**
 * Canonical structured document — the single intermediate representation
 * every extraction path (Docling sidecar, pdf-parse, image OCR, future
 * backends) produces before downstream parsing.
 *
 * Before this: each backend returned its own shape (Docling → SidecarResponse
 * with regions + HTML strings; pdf-parse → PageText[]; images → raw text).
 * Downstream code was doubly bound — to the backend AND to shape-specific
 * quirks. Adding a new backend meant threading it through every consumer.
 *
 * After this: backends emit a CanonicalDocument. Downstream code (row
 * parser, metadata extractor, quality scorer, RAG chunker, LLM prompt
 * builder) only ever reads canonical. Backends can be swapped, added, or
 * tuned without touching consumers.
 *
 * Coordinates are optional but preserved when the backend provides them —
 * bboxes are in the source coordinate system (Docling gives PDF-user-units
 * relative to page origin). Provenance is required on every block so a
 * downstream anomaly can be traced back to the extractor + version + region
 * of origin.
 */

// ─── Core types ────────────────────────────────────────────────────────────

/** Bounding box `[x0, y0, x1, y1]` in the source page's coordinate system. */
export type Bbox = [x0: number, y0: number, x1: number, y1: number];

export type ExtractorId = "docling" | "pdf-parse" | "vision-llm" | "manual";

export type Provenance = {
  extractor: ExtractorId;
  extractorVersion?: string;      // e.g. "docling/2.113.0"
  sourceRegionId?: string;        // opaque ID from the backend, when available
  extractedAt: string;            // ISO timestamp
  confidence?: number;            // 0-1; backend's own confidence if it emits one
};

// ─── Blocks ────────────────────────────────────────────────────────────────

export type BlockKind =
  | "title"          // report heading, section title
  | "header"         // page header (repeat-on-every-page banner)
  | "footer"         // page footer
  | "text"           // body paragraph
  | "list_item"
  | "caption"        // figure/table caption
  | "table"
  | "figure"
  | "key_value";     // "Sample Type: Serum" style patient meta

export type TextBlock = {
  kind: Exclude<BlockKind, "table" | "figure" | "key_value">;
  bbox?: Bbox;
  text: string;
  provenance: Provenance;
};

export type KeyValueBlock = {
  kind: "key_value";
  bbox?: Bbox;
  key: string;
  value: string;
  provenance: Provenance;
};

export type TableCell = {
  text: string;
  colIdx: number;
  rowIdx: number;
  colspan?: number;
  rowspan?: number;
  bbox?: Bbox;
};

export type TableRow = {
  isHeader: boolean;
  cells: TableCell[];
};

export type TableBlock = {
  kind: "table";
  bbox?: Bbox;
  rows: TableRow[];
  /** Original HTML preserved for backends that emit it — never the source of truth. */
  sourceHtml?: string;
  provenance: Provenance;
};

export type FigureBlock = {
  kind: "figure";
  bbox?: Bbox;
  caption?: string;
  provenance: Provenance;
};

export type CanonicalBlock = TextBlock | KeyValueBlock | TableBlock | FigureBlock;

// ─── Pages + document ──────────────────────────────────────────────────────

export type CanonicalPage = {
  pageNum: number;                // 1-indexed
  width?: number;                 // page dimensions in source units when known
  height?: number;
  blocks: CanonicalBlock[];
};

export type CanonicalDocument = {
  meta: {
    filename?: string;
    mimeType: string;
    numPages: number;
    createdAt: string;            // ISO
    strategyChain: ExtractorId[]; // ordered list of extractors that contributed
  };
  pages: CanonicalPage[];
};

// ─── Type guards ───────────────────────────────────────────────────────────

export function isTable(b: CanonicalBlock): b is TableBlock { return b.kind === "table"; }
export function isText(b: CanonicalBlock): b is TextBlock {
  return b.kind === "title" || b.kind === "header" || b.kind === "footer"
      || b.kind === "text"  || b.kind === "list_item" || b.kind === "caption";
}
export function isKeyValue(b: CanonicalBlock): b is KeyValueBlock { return b.kind === "key_value"; }
export function isFigure(b: CanonicalBlock): b is FigureBlock { return b.kind === "figure"; }

// ─── Query helpers ─────────────────────────────────────────────────────────

/** Every block in reading order across every page. */
export function* iterateBlocks(doc: CanonicalDocument): Generator<{ page: CanonicalPage; block: CanonicalBlock }> {
  for (const page of doc.pages) {
    for (const block of page.blocks) yield { page, block };
  }
}

/** Filter blocks by kind — typed to narrow the block type. */
export function blocksOfKind<K extends BlockKind>(
  doc: CanonicalDocument,
  kind: K,
): Array<K extends "table" ? TableBlock : K extends "figure" ? FigureBlock : K extends "key_value" ? KeyValueBlock : TextBlock> {
  const out: CanonicalBlock[] = [];
  for (const { block } of iterateBlocks(doc)) if (block.kind === kind) out.push(block);
  return out as never;
}

/** Concatenate the text of the first N pages — used for header metadata scans. */
export function topOfDocumentText(doc: CanonicalDocument, maxPages = 2): string {
  const pieces: string[] = [];
  for (const page of doc.pages.slice(0, maxPages)) {
    for (const block of page.blocks) {
      if (isText(block)) pieces.push(block.text);
      else if (isKeyValue(block)) pieces.push(`${block.key}: ${block.value}`);
      else if (isTable(block)) {
        // Linearize table cells so header-embedded metadata (Sample Collected On
        // in a two-column patient details table) is still visible to text scans.
        for (const row of block.rows) pieces.push(row.cells.map((c) => c.text).join(" | "));
      }
    }
  }
  return pieces.filter(Boolean).join("\n");
}

/** Reconstruct plain text of the whole document for legacy consumers. */
export function toPlainText(doc: CanonicalDocument): string {
  const pieces: string[] = [];
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      if (isText(block)) pieces.push(block.text);
      else if (isKeyValue(block)) pieces.push(`${block.key}: ${block.value}`);
      else if (isTable(block)) {
        for (const row of block.rows) pieces.push(row.cells.map((c) => c.text).join("\t"));
      }
    }
    pieces.push(""); // blank line between pages
  }
  return pieces.join("\n").trim();
}

// ─── Adapters ──────────────────────────────────────────────────────────────

/** Minimal shape of Docling sidecar output — mirrors layout-strategy's type. */
type DoclingRegion = { id: string; type: string; bbox: Bbox; text: string; html?: string };
type DoclingPage = { page: number; width: number; height: number; regions: DoclingRegion[] };
export type DoclingResponse = { analysis_id: string; pages: DoclingPage[] };

const DOCLING_KIND: Record<string, BlockKind> = {
  title: "title",
  section_header: "title",
  header: "header",
  page_header: "header",
  page_footer: "footer",
  footer: "footer",
  text: "text",
  paragraph: "text",
  list_item: "list_item",
  caption: "caption",
  figure_caption: "caption",
  table: "table",
  figure: "figure",
};

/** Parse a Docling table HTML fragment into structured rows. */
function parseTableHtmlToRows(html: string): TableRow[] {
  const rows: TableRow[] = [];
  // Deliberately regex-based rather than a full HTML parser — Docling emits
  // clean <table><tr><td>… fragments, and pulling in a DOM lib for this
  // one path isn't worth the weight.
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
  const attrRe = /(colspan|rowspan)\s*=\s*"?(\d+)"?/gi;
  let rowIdx = 0;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const inner = trMatch[1];
    const cells: TableCell[] = [];
    let colIdx = 0;
    let cellMatch: RegExpExecArray | null;
    let sawTh = false;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(inner)) !== null) {
      if (cellMatch[1].toLowerCase() === "th") sawTh = true;
      const attrs = cellMatch[2] || "";
      const raw = cellMatch[3] || "";
      const text = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
                     .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
      let colspan: number | undefined;
      let rowspan: number | undefined;
      attrRe.lastIndex = 0;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(attrs)) !== null) {
        if (am[1].toLowerCase() === "colspan") colspan = parseInt(am[2], 10);
        if (am[1].toLowerCase() === "rowspan") rowspan = parseInt(am[2], 10);
      }
      cells.push({ text, colIdx, rowIdx, colspan, rowspan });
      colIdx += colspan ?? 1;
    }
    if (cells.length > 0) rows.push({ isHeader: sawTh || rowIdx === 0, cells });
    rowIdx++;
  }
  return rows;
}

export function fromDocling(response: DoclingResponse, opts: { filename?: string; version?: string } = {}): CanonicalDocument {
  const now = new Date().toISOString();
  const version = opts.version ?? "docling";
  const pages: CanonicalPage[] = response.pages.map((p) => ({
    pageNum: p.page,
    width: p.width,
    height: p.height,
    blocks: p.regions.map((r): CanonicalBlock => {
      const provenance: Provenance = {
        extractor: "docling",
        extractorVersion: version,
        sourceRegionId: r.id,
        extractedAt: now,
      };
      if (r.type === "table") {
        return {
          kind: "table",
          bbox: r.bbox,
          rows: r.html ? parseTableHtmlToRows(r.html) : [],
          sourceHtml: r.html,
          provenance,
        };
      }
      if (r.type === "figure") {
        return { kind: "figure", bbox: r.bbox, provenance };
      }
      const kind = DOCLING_KIND[r.type] ?? "text";
      // Table kind can't fall through here (handled above); narrow safely.
      return {
        kind: kind === "table" || kind === "figure" || kind === "key_value" ? "text" : kind,
        bbox: r.bbox,
        text: r.text ?? "",
        provenance,
      };
    }),
  }));
  return {
    meta: {
      filename: opts.filename,
      mimeType: "application/pdf",
      numPages: pages.length,
      createdAt: now,
      strategyChain: ["docling"],
    },
    pages,
  };
}

/** Adapter for the pdf-parse per-page result. No bboxes — pdf-parse doesn't expose them per text run. */
export function fromPdfParsePages(
  pages: Array<{ num: number; text: string }>,
  opts: { filename?: string; mimeType?: string } = {},
): CanonicalDocument {
  const now = new Date().toISOString();
  const canonicalPages: CanonicalPage[] = pages.map((p) => ({
    pageNum: p.num,
    blocks: p.text.trim().length === 0 ? [] : [{
      kind: "text",
      text: p.text,
      provenance: { extractor: "pdf-parse", extractedAt: now },
    }],
  }));
  return {
    meta: {
      filename: opts.filename,
      mimeType: opts.mimeType ?? "application/pdf",
      numPages: canonicalPages.length,
      createdAt: now,
      strategyChain: ["pdf-parse"],
    },
    pages: canonicalPages,
  };
}

/** Merge a secondary canonical doc's pages into the primary — used for hybrid extractions. */
export function mergeStrategies(primary: CanonicalDocument, secondary: CanonicalDocument): CanonicalDocument {
  const byPage = new Map<number, CanonicalBlock[]>();
  for (const p of primary.pages) byPage.set(p.pageNum, [...p.blocks]);
  for (const p of secondary.pages) {
    const existing = byPage.get(p.pageNum) ?? [];
    byPage.set(p.pageNum, [...existing, ...p.blocks]);
  }
  const mergedPages: CanonicalPage[] = [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pageNum, blocks]) => ({ pageNum, blocks }));
  return {
    meta: {
      ...primary.meta,
      numPages: mergedPages.length,
      strategyChain: [...primary.meta.strategyChain, ...secondary.meta.strategyChain],
    },
    pages: mergedPages,
  };
}
