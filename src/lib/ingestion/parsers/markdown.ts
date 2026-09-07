/**
 * Obsidian Markdown Parser
 *
 * Extracts frontmatter (YAML), [[wikilinks]], #tags, and clean text content.
 */

import matter from "gray-matter";

export type ParsedMarkdown = {
  title: string;
  rawContent: string;
  frontmatter: Record<string, unknown> | null;
  aliases: string[];
  tags: string[];
  wikilinks: string[]; // raw [[target]] slugs
  wordCount: number;
};

/** Extract all [[wikilinks]] from markdown text (not inside code blocks). */
function extractWikilinks(text: string): string[] {
  const links: string[] = [];
  // Remove code blocks first to avoid false positives
  const noCode = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = re.exec(noCode)) !== null) {
    const target = match[1].trim();
    if (target && !links.includes(target)) {
      links.push(target);
    }
  }
  return links;
}

/** Extract all #tags from markdown text (not inside code blocks). */
function extractTags(text: string, frontmatterTags: string[]): string[] {
  const tags = new Set(frontmatterTags.map((t) => t.toLowerCase().replace(/^#/, "")));

  const noCode = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
  const re = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
  let match;
  while ((match = re.exec(noCode)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags);
}

/** Derive title from filename or frontmatter. */
function deriveTitle(filename: string, fm: Record<string, unknown> | null): string {
  if (fm?.title && typeof fm.title === "string") return fm.title;
  // Remove .md extension and path
  return filename.replace(/\.md$/i, "").split("/").pop() ?? "Untitled";
}

/** Convert title/filename to URL-safe slug. */
export function toSlug(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseMarkdown(filename: string, raw: string): ParsedMarkdown {
  let frontmatter: Record<string, unknown> | null = null;
  let content = raw;

  try {
    const parsed = matter(raw);
    if (parsed.data && Object.keys(parsed.data).length > 0) {
      frontmatter = parsed.data;
    }
    content = parsed.content;
  } catch {
    // Not valid frontmatter — treat entire file as content
  }

  // Extract aliases from frontmatter
  const fmAliases = frontmatter?.aliases;
  const aliases: string[] = Array.isArray(fmAliases)
    ? fmAliases.filter((a): a is string => typeof a === "string")
    : typeof fmAliases === "string"
    ? [fmAliases]
    : [];

  // Extract tags from frontmatter
  const fmTags = frontmatter?.tags;
  const frontmatterTags: string[] = Array.isArray(fmTags)
    ? fmTags.filter((t): t is string => typeof t === "string")
    : typeof fmTags === "string"
    ? fmTags.split(",").map((t) => t.trim())
    : [];

  const tags = extractTags(content, frontmatterTags);
  const wikilinks = extractWikilinks(content);
  const title = deriveTitle(filename, frontmatter);
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return {
    title,
    rawContent: content,
    frontmatter,
    aliases,
    tags,
    wikilinks,
    wordCount,
  };
}
