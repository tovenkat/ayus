/**
 * Markdown Rendering Utilities
 *
 * Pre-processes Obsidian-flavored markdown for react-markdown:
 * - Converts [[wikilinks]] to standard markdown links
 * - Marks unresolved links with a CSS class
 */

import { toSlug } from "@/lib/ingestion/parsers/markdown";

type LinkResolution = {
  /** Set of slugs that exist as documents */
  resolvedSlugs: Set<string>;
};

/**
 * Convert [[wikilinks]] to standard markdown links.
 *
 * [[Target]]        → [Target](/wiki/target)
 * [[Target|Display]] → [Display](/wiki/target)
 *
 * Unresolved links get wrapped in a span with class "wikilink-unresolved"
 * via an HTML inline element (requires rehype-raw).
 */
export function processWikilinks(
  content: string,
  resolution: LinkResolution
): string {
  return content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, display?: string) => {
      const slug = toSlug(target.trim());
      const label = (display ?? target).trim();
      const isResolved = resolution.resolvedSlugs.has(slug);

      if (isResolved) {
        return `[${label}](/wiki/${slug})`;
      }

      // Unresolved: render as HTML span (needs rehype-raw)
      return `<span class="wikilink-unresolved" title="Page not found: ${target.trim()}">${label}</span>`;
    }
  );
}

/**
 * Strip wikilink syntax for plain-text contexts (search snippets, etc.)
 */
export function stripWikilinks(content: string): string {
  return content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, display?: string) => (display ?? target).trim()
  );
}

/**
 * Extract first paragraph as summary (for cards).
 */
export function extractSummary(content: string, maxLength: number = 200): string {
  const stripped = stripWikilinks(content)
    .replace(/^#+\s+.*/gm, "") // remove headings
    .replace(/^[-*]\s+/gm, "") // remove list markers
    .replace(/!\[.*?\]\(.*?\)/g, "") // remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // inline links → text
    .replace(/[*_~`]/g, "") // remove formatting chars
    .trim();

  const firstPara = stripped.split(/\n\n+/)[0]?.trim() ?? "";
  if (firstPara.length <= maxLength) return firstPara;
  return firstPara.slice(0, maxLength).replace(/\s+\S*$/, "") + "...";
}
