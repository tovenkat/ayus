/**
 * Text Chunker
 *
 * Splits document text into overlapping chunks for embedding.
 * Respects paragraph and sentence boundaries where possible.
 */

export type TextChunk = {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
};

const DEFAULT_CHUNK_SIZE = 1500; // chars (~375 tokens)
const DEFAULT_OVERLAP = 200; // chars of overlap between chunks

/**
 * Split text into chunks at paragraph/sentence boundaries.
 */
export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): TextChunk[] {
  if (!text.trim()) return [];

  // If text fits in one chunk, return it
  if (text.length <= chunkSize) {
    return [{ index: 0, content: text.trim(), charStart: 0, charEnd: text.length }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to break at paragraph boundary
    if (end < text.length) {
      const paraBreak = text.lastIndexOf("\n\n", end);
      if (paraBreak > start + chunkSize * 0.3) {
        end = paraBreak + 2;
      } else {
        // Try sentence boundary
        const sentBreak = text.lastIndexOf(". ", end);
        if (sentBreak > start + chunkSize * 0.3) {
          end = sentBreak + 2;
        }
      }
    }

    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        charStart: start,
        charEnd: end,
      });
    }

    // Move forward, backing up by overlap amount
    start = end - overlap;
    if (start >= text.length) break;
    // Prevent infinite loop
    if (start <= chunks[chunks.length - 1]?.charStart) {
      start = end;
    }
  }

  return chunks;
}
