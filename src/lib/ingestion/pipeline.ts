/**
 * Ingestion Pipeline
 *
 * Orchestrates: parse → store document → extract tags/wikilinks → chunk → embed
 */

import { prisma } from "@/lib/prisma";
import { parseMarkdown, toSlug } from "./parsers/markdown";
import { chunkText } from "./chunker";
import type { DocType } from "@prisma/client";

export type IngestFileInput = {
  filename: string;
  content: string;
  mimeType: string;
  userId: string;
  uploadId?: string;
};

export type IngestResult = {
  documentId: string;
  slug: string;
  title: string;
  tagsCreated: number;
  chunksCreated: number;
  wikilinksCreated: number;
};

function detectDocType(mimeType: string, filename: string): DocType {
  if (filename.endsWith(".md") || mimeType === "text/markdown") return "MARKDOWN";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (filename.endsWith(".csv") || mimeType === "text/csv") return "CSV";
  if (filename.endsWith(".json") || mimeType === "application/json") return "JSON";
  return "TEXT";
}

/**
 * Ingest a single file into the wiki.
 */
export async function ingestFile(input: IngestFileInput): Promise<IngestResult> {
  const { filename, content, mimeType, userId, uploadId } = input;
  const docType = detectDocType(mimeType, filename);

  // ── Parse ────────────────────────────────────────────────────────────
  let title: string;
  let rawContent: string;
  let frontmatter: Record<string, unknown> | null = null;
  let aliases: string[] = [];
  let tags: string[] = [];
  let wikilinks: string[] = [];
  let wordCount: number;

  if (docType === "MARKDOWN") {
    const parsed = parseMarkdown(filename, content);
    title = parsed.title;
    rawContent = parsed.rawContent;
    frontmatter = parsed.frontmatter;
    aliases = parsed.aliases;
    tags = parsed.tags;
    wikilinks = parsed.wikilinks;
    wordCount = parsed.wordCount;
  } else {
    title = filename.replace(/\.[^.]+$/, "");
    rawContent = content;
    wordCount = content.split(/\s+/).filter(Boolean).length;
  }

  // ── Generate unique slug ──────────────────────────────────────────────
  let slug = toSlug(title);
  const existing = await prisma.document.findUnique({
    where: { userId_slug: { userId, slug } },
  });
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  // ── Store Document ────────────────────────────────────────────────────
  const document = await prisma.document.create({
    data: {
      userId,
      uploadId: uploadId ?? null,
      slug,
      title,
      docType,
      rawContent,
      frontmatter: frontmatter ? JSON.parse(JSON.stringify(frontmatter)) : undefined,
      aliases,
      wordCount,
    },
  });

  // ── Tags ──────────────────────────────────────────────────────────────
  let tagsCreated = 0;
  for (const tagName of tags) {
    const tag = await prisma.tag.upsert({
      where: { name: tagName },
      update: {},
      create: { name: tagName },
    });
    await prisma.documentTag.create({
      data: { documentId: document.id, tagId: tag.id },
    }).catch(() => {}); // ignore duplicate
    tagsCreated++;
  }

  // ── WikiLinks ─────────────────────────────────────────────────────────
  let wikilinksCreated = 0;
  for (const targetSlug of wikilinks) {
    const normalizedSlug = toSlug(targetSlug);
    // Try to resolve to existing document
    const target = await prisma.document.findUnique({
      where: { userId_slug: { userId, slug: normalizedSlug } },
      select: { id: true },
    });

    await prisma.wikiLink.create({
      data: {
        sourceId: document.id,
        targetId: target?.id ?? null,
        targetSlug: normalizedSlug,
      },
    });
    wikilinksCreated++;
  }

  // ── Chunk ─────────────────────────────────────────────────────────────
  const chunks = chunkText(rawContent);
  let chunksCreated = 0;

  if (chunks.length > 0) {
    await prisma.chunk.createMany({
      data: chunks.map((c) => ({
        documentId: document.id,
        index: c.index,
        content: c.content,
        charStart: c.charStart,
        charEnd: c.charEnd,
        embedded: false,
      })),
    });
    chunksCreated = chunks.length;
  }

  console.log(
    `[ingest] ${filename}: doc=${document.id}, slug=${slug}, ` +
    `tags=${tagsCreated}, links=${wikilinksCreated}, chunks=${chunksCreated}`
  );

  return {
    documentId: document.id,
    slug,
    title,
    tagsCreated,
    chunksCreated,
    wikilinksCreated,
  };
}

/**
 * After all files in a vault are ingested, resolve dangling wikilinks.
 * Links created with targetId=null may now point to documents that exist.
 */
export async function resolveWikilinks(userId: string): Promise<number> {
  const dangling = await prisma.wikiLink.findMany({
    where: {
      targetId: null,
      source: { userId },
    },
    select: { id: true, targetSlug: true },
  });

  let resolved = 0;
  for (const link of dangling) {
    const target = await prisma.document.findUnique({
      where: { userId_slug: { userId, slug: link.targetSlug } },
      select: { id: true },
    });
    if (target) {
      await prisma.wikiLink.update({
        where: { id: link.id },
        data: { targetId: target.id },
      });
      resolved++;
    }
  }

  if (resolved > 0) {
    console.log(`[ingest] Resolved ${resolved}/${dangling.length} dangling wikilinks`);
  }
  return resolved;
}

/**
 * Embed all un-embedded chunks for a user using the configured embed provider.
 */
export async function embedPendingChunks(userId: string): Promise<number> {
  const { getEmbedProvider } = await import("@/lib/ai/embed-provider");
  const { getVectorStore } = await import("@/lib/ai/vector-store");

  const embedProvider = await getEmbedProvider();
  const vectorStore = await getVectorStore();
  if (!vectorStore) return 0;

  const pending = await prisma.chunk.findMany({
    where: {
      embedded: false,
      document: { userId },
    },
    include: { document: { select: { slug: true, title: true } } },
    take: 100, // batch size
  });

  if (pending.length === 0) return 0;

  const texts = pending.map((c) => c.content);
  const vectors = await embedProvider.embed(texts);

  await vectorStore.upsert(
    "wiki_chunks",
    pending.map((chunk, i) => ({
      id: chunk.id,
      vector: vectors[i],
      text: chunk.content,
      metadata: {
        documentId: chunk.documentId,
        slug: chunk.document.slug,
        title: chunk.document.title,
        chunkIndex: chunk.index,
        userId,
      },
    }))
  );

  await prisma.chunk.updateMany({
    where: { id: { in: pending.map((c) => c.id) } },
    data: { embedded: true },
  });

  console.log(`[ingest] Embedded ${pending.length} chunks`);
  return pending.length;
}
