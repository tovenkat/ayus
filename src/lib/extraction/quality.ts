/**
 * Page-level extraction quality scoring.
 *
 * Replaces the earlier crude "is total text < 200 chars" heuristic. Real
 * PDFs are commonly hybrid — some pages digital, some scanned images,
 * some sparse cover pages. A blunt char count can't tell them apart.
 *
 * Signals per page (all cheap, run on the pdf-parse text):
 *   - char density         : chars of extracted text
 *   - alpha ratio          : alphabetic / total chars — OCR gibberish has low ratio
 *   - word density         : proportion of tokens that look like real words
 *   - medical hit density  : proportion of medical vocabulary (mg/dL, hemoglobin, …)
 *
 * The composite is 0-1. A verdict of `digital` → keep pdf-parse output.
 * `scanned` / `gibberish` → route through Docling OCR. `sparse` is the
 * grey zone (e.g. a cover page).
 *
 * The document-level decision aggregates: needs OCR if any page is outright
 * scanned, OR the mean score is too low, OR fewer than half the pages
 * classify as digital.
 */

const MEDICAL_MARKERS = /\b(?:mg\/dl|ng\/ml|iu\/l|mmol\/l|mcg|umol|meq\/l|g\/dl|u\/l|pg\/ml|ref(?:erence)?\s*(?:range|interval)|specimen|sample\s*(?:type|collect)|hemoglobin|glucose|creatinine|cholesterol|urea|hba1c|triglycer|bilirubin|albumin|calcium|sodium|potassium|chloride|patient|method|technology|value|units|normal|abnormal|result|test|vitamin|thyroid|report)\b/gi;

export type PageVerdict = "digital" | "sparse" | "scanned" | "gibberish";

export type PageQuality = {
  pageNum: number;
  chars: number;
  alphaRatio: number;       // 0-1
  wordCount: number;
  wordDensity: number;      // words per 100 chars
  medicalHits: number;
  medicalDensity: number;   // hits per 1000 chars
  score: number;            // 0-1 composite
  verdict: PageVerdict;
};

export type DocumentQuality = {
  pages: PageQuality[];
  numPages: number;
  meanScore: number;
  digitalPageCount: number;
  scannedPageCount: number;
  sparsePageCount: number;
  needsOcr: boolean;
  reason: string;
};

/** Score a single page's extracted text. Deterministic, pure, cheap. */
export function scorePage(pageNum: number, text: string): PageQuality {
  const chars = text.length;

  const alphaCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const alphaRatio = chars > 0 ? alphaCount / chars : 0;

  // "Word-like" tokens — start with a letter, 2-20 chars, mostly alphanumeric.
  // Gibberish OCR tokens (e.g. "Wt3~4|") don't clear this bar.
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z0-9]{1,19}$/.test(w));
  const wordCount = words.length;
  const wordDensity = chars > 0 ? (wordCount * 100) / chars : 0;

  const medicalHits = (text.match(MEDICAL_MARKERS) ?? []).length;
  const medicalDensity = chars > 0 ? (medicalHits * 1000) / chars : 0;

  // Component scores (0-1 each).
  const sChars = chars < 30 ? 0 : Math.min(1, chars / 500);   // ramps up 30→500 chars
  const sAlpha = alphaRatio;                                    // 0.0 (junk) → 1.0 (pure text)
  const sWords = Math.min(1, wordDensity / 15);                 // 15+ words per 100 chars = full credit
  const sMed   = Math.min(1, medicalDensity / 5);               // 5+ hits per 1000 chars = full credit

  // Weighted composite. Words and medical density carry the most weight
  // because they best distinguish real content from OCR noise.
  const score = 0.15 * sChars + 0.25 * sAlpha + 0.35 * sWords + 0.25 * sMed;

  let verdict: PageVerdict;
  if (chars < 30) verdict = "scanned";           // essentially empty
  else if (score < 0.35) verdict = "gibberish";  // has chars but they're junk
  else if (score < 0.55) verdict = "sparse";     // low content — probably a cover page
  else verdict = "digital";                       // healthy text-native page

  return { pageNum, chars, alphaRatio, wordCount, wordDensity, medicalHits, medicalDensity, score, verdict };
}

/** Aggregate per-page scores → single document-level decision. */
export function assessDocumentQuality(pages: Array<{ num: number; text: string }>): DocumentQuality {
  if (pages.length === 0) {
    return {
      pages: [], numPages: 0, meanScore: 0,
      digitalPageCount: 0, scannedPageCount: 0, sparsePageCount: 0,
      needsOcr: true, reason: "no pages extracted",
    };
  }

  const pageScores = pages.map((p) => scorePage(p.num, p.text));
  const meanScore = pageScores.reduce((sum, p) => sum + p.score, 0) / pageScores.length;
  const digitalPageCount = pageScores.filter((p) => p.verdict === "digital").length;
  const scannedPageCount = pageScores.filter((p) => p.verdict === "scanned" || p.verdict === "gibberish").length;
  const sparsePageCount  = pageScores.filter((p) => p.verdict === "sparse").length;

  // Decision thresholds — deliberately conservative. Route to OCR when:
  //   - > 20% of pages are outright scanned/gibberish, OR
  //   - mean quality is below 0.4 (poor overall), OR
  //   - less than half the pages classify as digital
  const scannedRatio = scannedPageCount / pages.length;
  const digitalRatio = digitalPageCount / pages.length;

  let needsOcr = false;
  let reason = `${digitalPageCount}/${pages.length} pages digital, mean score ${meanScore.toFixed(2)}`;

  if (scannedRatio > 0.2) {
    needsOcr = true;
    reason = `${scannedPageCount}/${pages.length} pages scanned or gibberish (${(scannedRatio * 100).toFixed(0)}%)`;
  } else if (meanScore < 0.4) {
    needsOcr = true;
    reason = `mean quality ${meanScore.toFixed(2)} < 0.40 threshold`;
  } else if (digitalRatio < 0.5) {
    needsOcr = true;
    reason = `only ${digitalPageCount}/${pages.length} pages classify as digital`;
  }

  return {
    pages: pageScores,
    numPages: pages.length,
    meanScore,
    digitalPageCount,
    scannedPageCount,
    sparsePageCount,
    needsOcr,
    reason,
  };
}

/** Compact log line — useful for console tracing without dumping every page. */
export function summarizeQuality(q: DocumentQuality): string {
  const distribution = `digital=${q.digitalPageCount} sparse=${q.sparsePageCount} scanned=${q.scannedPageCount}`;
  const worst = q.pages.slice().sort((a, b) => a.score - b.score).slice(0, 3)
    .map((p) => `p${p.pageNum}=${p.verdict}(${p.score.toFixed(2)})`).join(" ");
  return `${distribution} · mean=${q.meanScore.toFixed(2)} · worst: ${worst}`;
}

// ─── Page-level routing decision ───────────────────────────────────────────

export type RoutingKind =
  | "text_native"    // every page has usable native text — no OCR
  | "mixed"          // some pages weak → OCR those pages, keep native text on the rest
  | "scanned";       // no usable native text — OCR the whole thing

export type DocumentRouting = {
  kind: RoutingKind;
  /** Pages whose native text is below the min-chars gate. */
  weakPages: number[];
  /** Pages with healthy native text that don't need OCR. */
  strongPages: number[];
  /** Should Docling's OCR pipeline be enabled for this document? */
  doOcr: boolean;
  reason: string;
};

/**
 * Decide the routing for a document from its per-page native text.
 *
 *   text_native → every page has >= minCharsPerPage native text. Docling
 *                 runs layout/table extraction but WITHOUT OCR (fast, cheap).
 *   mixed       → some pages are weak. Docling runs with OCR enabled;
 *                 it auto-skips pages that already have a text layer.
 *   scanned     → no usable native text. Docling runs with OCR on every page.
 *
 * `weakPages` is the list of page numbers below the threshold — useful when
 * a future backend supports per-page OCR selection (Docling today gates OCR
 * at the pipeline level, not per-page).
 */
export function classifyDocumentRouting(
  pages: Array<{ num: number; text: string }>,
  minCharsPerPage = 80,
): DocumentRouting {
  if (pages.length === 0) {
    return { kind: "scanned", weakPages: [], strongPages: [], doOcr: true, reason: "no pages" };
  }
  const weakPages: number[] = [];
  const strongPages: number[] = [];
  for (const p of pages) {
    if (p.text.trim().length < minCharsPerPage) weakPages.push(p.num);
    else strongPages.push(p.num);
  }
  if (weakPages.length === 0) {
    return {
      kind: "text_native", weakPages, strongPages,
      doOcr: false,
      reason: `all ${pages.length} pages have >= ${minCharsPerPage} chars — no OCR needed`,
    };
  }
  if (strongPages.length === 0) {
    return {
      kind: "scanned", weakPages, strongPages,
      doOcr: true,
      reason: `all ${pages.length} pages below ${minCharsPerPage} chars — full OCR`,
    };
  }
  return {
    kind: "mixed", weakPages, strongPages,
    doOcr: true,
    reason: `${weakPages.length}/${pages.length} weak pages → OCR (Docling auto-skips text-native pages)`,
  };
}

/** Pages that need OCR (native text below the threshold). */
export function pagesNeedingOcr(
  pages: Array<{ num: number; text: string }>,
  minCharsPerPage = 80,
): number[] {
  return pages.filter((p) => p.text.trim().length < minCharsPerPage).map((p) => p.num);
}
