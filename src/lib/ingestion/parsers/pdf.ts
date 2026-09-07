/**
 * PDF Text Extractor.
 *
 * pdf-parse v2 returns a TextResult with per-page text alongside the combined
 * string. We expose both — the simple `extractPdfText` for callers that just
 * want a blob, and `extractPdfTextByPage` for the upload route's quality-based
 * classification.
 */

export type PageText = { num: number; text: string };

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { pages } = await extractPdfTextByPage(buffer);
  // Join with a page-break marker so downstream regex fallbacks can still
  // identify page boundaries if needed.
  return pages.map((p) => p.text).join("\n\n").trim();
}

export async function extractPdfTextByPage(buffer: Buffer): Promise<{
  pages: PageText[];
  total: string;
  numPages: number;
}> {
  const { PDFParse } = await import("pdf-parse");
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await pdf.getText();
  const pages: PageText[] = (result.pages ?? []).map((p) => ({ num: p.num, text: p.text ?? "" }));
  return {
    pages,
    total: (result.text ?? "").trim(),
    numPages: pages.length || result.total || 1,
  };
}
