/**
 * RAG — Retrieval-Augmented Generation
 *
 * Retrieves relevant document chunks for the chat context.
 */

import { prisma } from "@/lib/prisma";
import { stripWikilinks } from "@/lib/markdown-render";

export type RagContext = {
  chunks: { documentId: string; slug: string; title: string; content: string }[];
  contextText: string;
};

/**
 * Retrieve relevant context for a user query.
 * Combines keyword matching with semantic search.
 */
export async function retrieveContext(
  userId: string,
  query: string,
  limit: number = 8
): Promise<RagContext> {
  const chunks: RagContext["chunks"] = [];

  // ── Semantic search via LanceDB ───────────────────────────────────────
  try {
    const { getEmbedProvider } = await import("@/lib/ai/embed-provider");
    const { getVectorStore } = await import("@/lib/ai/vector-store");

    const vectorStore = await getVectorStore();
    if (vectorStore) {
      const embedProvider = await getEmbedProvider();
      const [queryVector] = await embedProvider.embed(query);
      const results = await vectorStore.search("wiki_chunks", queryVector, limit * 2);

      for (const result of results) {
        if ((result.metadata.userId as string) !== userId) continue;
        if (chunks.length >= limit) break;

        chunks.push({
          documentId: result.metadata.documentId as string,
          slug: result.metadata.slug as string,
          title: result.metadata.title as string,
          content: result.text,
        });
      }
    }
  } catch (err) {
    console.warn("[rag] Semantic retrieval failed:", err instanceof Error ? err.message : err);
  }

  // ── Keyword fallback if semantic didn't find enough ───────────────────
  if (chunks.length < 3) {
    const keywords = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 5);

    if (keywords.length > 0) {
      const docs = await prisma.document.findMany({
        where: {
          userId,
          OR: keywords.map((k) => ({
            rawContent: { contains: k, mode: "insensitive" as const },
          })),
        },
        select: { id: true, slug: true, title: true, rawContent: true },
        take: limit - chunks.length,
      });

      const existingDocIds = new Set(chunks.map((c) => c.documentId));
      for (const doc of docs) {
        if (existingDocIds.has(doc.id)) continue;
        chunks.push({
          documentId: doc.id,
          slug: doc.slug,
          title: doc.title,
          content: stripWikilinks(doc.rawContent).slice(0, 1500),
        });
      }
    }
  }

  // ── Format context text ───────────────────────────────────────────────
  const contextText = chunks
    .map((c, i) => `[Document ${i + 1}: "${c.title}" (${c.slug})]\n${c.content}`)
    .join("\n\n---\n\n");

  return { chunks, contextText };
}
