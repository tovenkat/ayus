import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { parseMarkdown, toSlug } from "@/lib/ingestion/parsers/markdown";
import { chunkText } from "@/lib/ingestion/chunker";

function getVaultRoot(): string {
  return process.env.VAULT_ROOT ?? path.join(process.cwd(), "phr2");
}

function wikiRoot(userId: string): string {
  return path.join(getVaultRoot(), userId, "wiki");
}

export function pathToSlug(relPath: string): string {
  return toSlug(relPath.replace(/\\/g, "/").replace(/\.md$/i, "").replace(/\//g, "-"));
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(current: string, prefix: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await recurse(fullPath, rel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(rel);
      }
    }
  }
  await recurse(dir, "");
  return out;
}

/**
 * Read a markdown file from disk and upsert it into the DB cache.
 * Rebuilds chunks, tags, and wikilinks for this document.
 */
export async function indexFileFromDisk(userId: string, relPath: string): Promise<string> {
  const abs = path.join(wikiRoot(userId), relPath);
  const raw = await fs.readFile(abs, "utf8");

  const parsed = parseMarkdown(relPath, raw);
  const slug = pathToSlug(relPath);
  const docType = "MARKDOWN" as const;

  const existing = await prisma.document.findUnique({
    where: { userId_slug: { userId, slug } },
  });

  const data = {
    userId,
    slug,
    title: parsed.title,
    docType,
    rawContent: parsed.rawContent,
    frontmatter: parsed.frontmatter ? JSON.parse(JSON.stringify(parsed.frontmatter)) : undefined,
    aliases: parsed.aliases,
    wordCount: parsed.wordCount,
  };

  const document = existing
    ? await prisma.document.update({ where: { id: existing.id }, data: { ...data, updatedAt: new Date() } })
    : await prisma.document.create({ data });

  // Rebuild chunks
  await prisma.chunk.deleteMany({ where: { documentId: document.id } });
  const chunks = chunkText(parsed.rawContent);
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
  }

  // Rebuild tags
  await prisma.documentTag.deleteMany({ where: { documentId: document.id } });
  for (const tagName of parsed.tags) {
    const tag = await prisma.tag.upsert({
      where: { name: tagName },
      update: {},
      create: { name: tagName },
    });
    await prisma.documentTag.create({ data: { documentId: document.id, tagId: tag.id } }).catch(() => {});
  }

  // Rebuild outgoing wikilinks
  await prisma.wikiLink.deleteMany({ where: { sourceId: document.id } });
  for (const target of parsed.wikilinks) {
    const normalizedSlug = toSlug(target);
    const targetDoc = await prisma.document.findUnique({
      where: { userId_slug: { userId, slug: normalizedSlug } },
      select: { id: true },
    });
    await prisma.wikiLink.create({
      data: {
        sourceId: document.id,
        targetId: targetDoc?.id ?? null,
        targetSlug: normalizedSlug,
      },
    });
  }

  return document.id;
}

export async function reconcileVault(
  userId: string,
  options: { deleteMissing?: boolean } = {},
): Promise<{ indexed: number; deleted: number }> {
  const { deleteMissing = true } = options;
  const files = await walkMarkdownFiles(wikiRoot(userId));
  const slugsOnDisk = new Set<string>();

  for (const rel of files) {
    const slug = pathToSlug(rel);
    slugsOnDisk.add(slug);
    await indexFileFromDisk(userId, rel);
  }

  let deleted = 0;
  if (deleteMissing) {
    const dbDocs = await prisma.document.findMany({
      where: { userId, docType: "MARKDOWN" },
      select: { id: true, slug: true },
    });
    for (const doc of dbDocs) {
      if (!slugsOnDisk.has(doc.slug)) {
        await prisma.document.delete({ where: { id: doc.id } });
        deleted++;
      }
    }
  }

  // Resolve dangling wikilinks that now have a matching target
  const dangling = await prisma.wikiLink.findMany({
    where: { targetId: null, source: { userId } },
    select: { id: true, targetSlug: true },
  });
  for (const link of dangling) {
    const target = await prisma.document.findUnique({
      where: { userId_slug: { userId, slug: link.targetSlug } },
      select: { id: true },
    });
    if (target) {
      await prisma.wikiLink.update({ where: { id: link.id }, data: { targetId: target.id } });
    }
  }

  return { indexed: files.length, deleted };
}
