/**
 * DOCX text extraction.
 *
 * mammoth pulls the raw text out of a .docx (Word / Google Docs export). We use
 * `extractRawText` rather than the HTML converter — the extraction LLM wants
 * plain text, not markup. Tables come through as tab/newline-separated text,
 * which is enough for the biomarker extractor to see "Test  Value  Range" rows.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
