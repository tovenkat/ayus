/**
 * Wiki Data Queries
 *
 * Server-side data fetching for wiki pages.
 */

import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DocumentListItem = {
  id: string;
  slug: string;
  title: string;
  docType: string;
  wordCount: number;
  summary: string | null;
  updatedAt: Date;
  tags: string[];
};

export type DocumentDetail = {
  id: string;
  slug: string;
  title: string;
  docType: string;
  rawContent: string;
  summary: string | null;
  wordCount: number;
  frontmatter: Record<string, unknown> | null;
  aliases: string[];
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  outgoingLinks: { slug: string; title: string | null; resolved: boolean }[];
  backlinks: { slug: string; title: string; snippet: string }[];
};

export type TagWithCount = {
  name: string;
  count: number;
};

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all documents for a user, optionally filtered by tag or search query.
 */
export async function listDocuments(
  userId: string,
  options?: { tag?: string; search?: string; limit?: number; offset?: number }
): Promise<{ documents: DocumentListItem[]; total: number }> {
  const { tag, search, limit = 50, offset = 0 } = options ?? {};

  const where: Record<string, unknown> = { userId };

  if (tag) {
    where.tags = { some: { tag: { name: tag } } };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { rawContent: { contains: search, mode: "insensitive" } },
    ];
  }

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: {
        tags: { include: { tag: { select: { name: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.document.count({ where }),
  ]);

  return {
    documents: documents.map((doc) => ({
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      docType: doc.docType,
      wordCount: doc.wordCount,
      summary: doc.summary,
      updatedAt: doc.updatedAt,
      tags: doc.tags.map((dt) => dt.tag.name),
    })),
    total,
  };
}

/**
 * Get a single document with all metadata, tags, outgoing links, and backlinks.
 */
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Wikilinks like [[Lab Report — February 23, 2026]] are slug-ified to
 * "lab-report-february-23-2026". The actual Document is stored as
 * "lab-reports-2026-02-23". This parses the human date into ISO form so we
 * can look up the prefixed slug directly.
 */
function labReportDateFromSlug(slug: string): string | null {
  const match = slug.match(/^lab-reports?-([a-z]+)-(\d{1,2})(?:st|nd|rd|th)?-(\d{4})$/i);
  if (!match) return null;
  const m = MONTHS.indexOf(match[1].toLowerCase());
  if (m === -1) return null;
  return `${match[3]}-${String(m + 1).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

/** Build the list of slug candidates to try for a raw wikilink slug. */
function slugCandidatesFor(rawSlug: string): string[] {
  const candidates: string[] = [rawSlug];
  for (const prefix of ["entities-", "lab-reports-", "topics-", "encounters-", "prescriptions-", "journal-"]) {
    candidates.push(`${prefix}${rawSlug}`);
  }
  const isoDate = labReportDateFromSlug(rawSlug);
  if (isoDate) candidates.push(`lab-reports-${isoDate}`);
  return candidates;
}

export async function getDocument(
  userId: string,
  slug: string
): Promise<DocumentDetail | null> {
  const include = {
    tags: { include: { tag: { select: { name: true } } } },
    outgoingLinks: {
      include: { target: { select: { slug: true, title: true } } },
    },
    incomingLinks: {
      include: {
        source: { select: { slug: true, title: true, rawContent: true } },
      },
    },
  } as const;

  // Try every candidate slug (raw, prefixed, lab-report-date-parsed).
  let doc: Awaited<ReturnType<typeof prisma.document.findUnique<{
    where: { userId_slug: { userId: string; slug: string } };
    include: typeof include;
  }>>> = null;
  for (const candidate of slugCandidatesFor(slug)) {
    doc = await prisma.document.findUnique({
      where: { userId_slug: { userId, slug: candidate } },
      include,
    });
    if (doc) break;
  }

  // Last-ditch: slug suffix / title match.
  if (!doc) {
    doc = await prisma.document.findFirst({
      where: {
        userId,
        OR: [
          { slug: { endsWith: `-${slug}` } },
          { title: { equals: slug, mode: "insensitive" } },
        ],
      },
      include,
    });
  }

  if (!doc) return null;

  // Build backlink snippets — extract context around the [[link]] in source doc
  const backlinks = doc.incomingLinks.map((link) => {
    const sourceContent = link.source.rawContent;
    const snippet = extractSnippet(sourceContent, slug, doc.title);
    return {
      slug: link.source.slug,
      title: link.source.title,
      snippet,
    };
  });

  // Resolve outgoing links that have no targetId yet by prefix / suffix matching.
  // This handles the case where wikilinks target "homocysteine" but the actual
  // entity page is stored as "entities-homocysteine".
  const unresolvedSlugs = doc.outgoingLinks
    .filter((l) => !l.targetId)
    .map((l) => l.targetSlug);

  const slugCandidates = new Set<string>();
  for (const raw of unresolvedSlugs) {
    for (const cand of slugCandidatesFor(raw)) {
      slugCandidates.add(cand);
    }
  }

  const resolvedDocs = slugCandidates.size > 0
    ? await prisma.document.findMany({
        where: { userId: doc.userId, slug: { in: Array.from(slugCandidates) } },
        select: { slug: true, title: true },
      })
    : [];

  const bySlug = new Map(resolvedDocs.map((d) => [d.slug, d]));
  const findLateResolution = (rawSlug: string): { slug: string; title: string } | null => {
    for (const cand of slugCandidatesFor(rawSlug)) {
      const hit = bySlug.get(cand);
      if (hit) return hit;
    }
    return null;
  };

  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    docType: doc.docType,
    rawContent: doc.rawContent,
    summary: doc.summary,
    wordCount: doc.wordCount,
    frontmatter: doc.frontmatter as Record<string, unknown> | null,
    aliases: doc.aliases,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    tags: doc.tags.map((dt) => dt.tag.name),
    outgoingLinks: doc.outgoingLinks.map((link) => {
      if (link.target) {
        return { slug: link.target.slug, title: link.target.title, resolved: true };
      }
      const late = findLateResolution(link.targetSlug);
      if (late) {
        return { slug: late.slug, title: late.title, resolved: true };
      }
      return { slug: link.targetSlug, title: null, resolved: false };
    }),
    backlinks,
  };
}

/**
 * Extract a snippet of text surrounding a [[wikilink]] reference.
 */
function extractSnippet(content: string, targetSlug: string, targetTitle: string): string {
  // Try to find [[Target]] or [[Target|...]] in the content
  const patterns = [
    new RegExp(`\\[\\[${escapeRegex(targetTitle)}(?:\\|[^\\]]+)?\\]\\]`, "i"),
    new RegExp(`\\[\\[${escapeRegex(targetSlug)}(?:\\|[^\\]]+)?\\]\\]`, "i"),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      const start = Math.max(0, match.index - 80);
      const end = Math.min(content.length, match.index + match[0].length + 80);
      let snippet = content.slice(start, end).replace(/\n+/g, " ").trim();
      if (start > 0) snippet = "..." + snippet;
      if (end < content.length) snippet = snippet + "...";
      return snippet;
    }
  }

  // Fallback: first 150 chars
  return content.slice(0, 150).replace(/\n+/g, " ").trim() + "...";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Get all tags with document counts.
 */
export async function listTags(userId: string): Promise<TagWithCount[]> {
  const tags = await prisma.tag.findMany({
    where: {
      documents: { some: { document: { userId } } },
    },
    include: {
      _count: {
        select: {
          documents: { where: { document: { userId } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return tags
    .map((tag) => ({
      name: tag.name,
      count: tag._count.documents,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Get stats for dashboard.
 */
export async function getWikiStats(userId: string) {
  const [docCount, tagCount, linkCount, unresolvedLinks] = await Promise.all([
    prisma.document.count({ where: { userId } }),
    prisma.documentTag.count({ where: { document: { userId } } }),
    prisma.wikiLink.count({ where: { source: { userId } } }),
    prisma.wikiLink.count({ where: { source: { userId }, targetId: null } }),
  ]);

  return { docCount, tagCount, linkCount, unresolvedLinks };
}
