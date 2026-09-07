/**
 * Search — combines PostgreSQL text search with LanceDB semantic search.
 */

import { prisma } from "@/lib/prisma";
import { stripWikilinks } from "@/lib/markdown-render";

export type SearchResult = {
  documentId: string;
  slug: string;
  title: string;
  snippet: string;
  score: number;
  source: "text" | "semantic";
};

/**
 * Full-text search using PostgreSQL ILIKE.
 */
async function textSearch(userId: string, query: string, limit: number): Promise<SearchResult[]> {
  const documents = await prisma.document.findMany({
    where: {
      userId,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { rawContent: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, slug: true, title: true, rawContent: true },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  return documents.map((doc) => {
    const snippet = extractSearchSnippet(doc.rawContent, query);
    // Simple scoring: title match = 1.0, content match = 0.7
    const score = doc.title.toLowerCase().includes(query.toLowerCase()) ? 1.0 : 0.7;
    return {
      documentId: doc.id,
      slug: doc.slug,
      title: doc.title,
      snippet,
      score,
      source: "text" as const,
    };
  });
}

/**
 * Semantic search using LanceDB vector similarity.
 */
async function semanticSearch(userId: string, query: string, limit: number): Promise<SearchResult[]> {
  try {
    const { getEmbedProvider } = await import("@/lib/ai/embed-provider");
    const { getVectorStore } = await import("@/lib/ai/vector-store");

    const vectorStore = await getVectorStore();
    if (!vectorStore) return [];

    const embedProvider = await getEmbedProvider();
    const [queryVector] = await embedProvider.embed(query);

    const results = await vectorStore.search("wiki_chunks", queryVector, limit * 2);

    // Filter to user's documents and deduplicate by document
    const seen = new Set<string>();
    const filtered: SearchResult[] = [];

    for (const result of results) {
      const docId = result.metadata.documentId as string;
      const docUserId = result.metadata.userId as string;
      if (docUserId !== userId || seen.has(docId)) continue;
      seen.add(docId);

      filtered.push({
        documentId: docId,
        slug: result.metadata.slug as string,
        title: result.metadata.title as string,
        snippet: stripWikilinks(result.text).slice(0, 200),
        score: result.score,
        source: "semantic",
      });

      if (filtered.length >= limit) break;
    }

    return filtered;
  } catch (err) {
    console.warn("[search] Semantic search failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Combined search: text + semantic, deduplicated, ranked.
 */
export async function search(
  userId: string,
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const [textResults, semanticResults] = await Promise.all([
    textSearch(userId, query, limit),
    semanticSearch(userId, query, limit),
  ]);

  // Merge and deduplicate by documentId, preferring text matches
  const merged = new Map<string, SearchResult>();

  for (const result of textResults) {
    merged.set(result.documentId, result);
  }

  for (const result of semanticResults) {
    if (!merged.has(result.documentId)) {
      merged.set(result.documentId, result);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function extractSearchSnippet(content: string, query: string): string {
  const stripped = stripWikilinks(content);
  const lower = stripped.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());

  if (idx === -1) {
    return stripped.slice(0, 200).replace(/\n+/g, " ").trim() + "...";
  }

  const start = Math.max(0, idx - 60);
  const end = Math.min(stripped.length, idx + query.length + 100);
  let snippet = stripped.slice(start, end).replace(/\n+/g, " ").trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < stripped.length) snippet += "...";
  return snippet;
}
