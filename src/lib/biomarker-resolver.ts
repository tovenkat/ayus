/**
 * Resolve an extracted lab test name to a canonical TestCanonical row, plus the
 * organ systems it belongs to. Used by the extraction pipeline to attach organ
 * grouping to results, and by the dashboard to render organ-view panels.
 *
 * Matching strategy (in priority order):
 *   1. Exact match against TestCanonical.name (case-insensitive)
 *   2. Exact match against TestSynonym.rawName (case-insensitive)
 *   3. Loose match: normalized comparison after stripping punctuation and
 *      collapsing whitespace — helps with "S. Creatinine" vs "S Creatinine"
 *   4. Return null — caller should keep the raw name and skip organ linking
 *
 * Deliberately does NOT do fuzzy/LLM matching here. Fuzzy matching belongs in
 * the extraction agent (which already has the report context) and should
 * propose new TestSynonym rows for review, not silently guess.
 */

import { prisma } from "@/lib/prisma";

export type ResolvedBiomarker = {
  canonicalId: string;
  canonicalName: string;
  category: string | null;
  organKeys: string[];
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,()/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// In-memory cache — the canonical table changes rarely (seed-only).
// Reset by re-importing the module or restarting the process.
let cache: {
  byExact: Map<string, ResolvedBiomarker>;
  loadedAt: number;
} | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — fine for dev, tune for prod

async function loadCache(): Promise<NonNullable<typeof cache>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;

  const canonicals = await prisma.testCanonical.findMany({
    include: {
      synonyms: { select: { rawName: true } },
      systems: { include: { organSystem: { select: { key: true } } } },
    },
  });

  const byExact = new Map<string, ResolvedBiomarker>();
  for (const c of canonicals) {
    const resolved: ResolvedBiomarker = {
      canonicalId: c.id,
      canonicalName: c.name,
      category: c.category,
      organKeys: c.systems.map((m) => m.organSystem.key),
    };
    byExact.set(normalize(c.name), resolved);
    for (const s of c.synonyms) {
      byExact.set(normalize(s.rawName), resolved);
    }
  }

  cache = { byExact, loadedAt: Date.now() };
  return cache;
}

/**
 * Resolve a single test name. Returns null if no match — caller decides what
 * to do (fall back to normalizedName, skip organ linking, log for later
 * synonym curation, etc.).
 */
export async function resolveBiomarker(rawName: string): Promise<ResolvedBiomarker | null> {
  if (!rawName?.trim()) return null;
  const c = await loadCache();
  return c.byExact.get(normalize(rawName)) ?? null;
}

/** Batch variant for extraction — resolves many at once with one cache load. */
export async function resolveBiomarkers(rawNames: string[]): Promise<Map<string, ResolvedBiomarker | null>> {
  const c = await loadCache();
  const out = new Map<string, ResolvedBiomarker | null>();
  for (const raw of rawNames) {
    out.set(raw, c.byExact.get(normalize(raw)) ?? null);
  }
  return out;
}

/**
 * Log a rawName that failed to resolve. Increments seenCount if we've seen it
 * before. Fire-and-forget from the caller's perspective — logs but never throws.
 * Curate with `npm run biomarkers:unresolved`.
 */
export async function logUnresolvedTestName(
  rawName: string,
  ctx: { userId?: string; reportId?: string } = {},
): Promise<void> {
  const trimmed = rawName?.trim();
  if (!trimmed) return;
  try {
    await prisma.unresolvedTestName.upsert({
      where: { rawName: trimmed },
      create: {
        rawName: trimmed,
        normalizedForm: normalize(trimmed),
        seenCount: 1,
        lastSampleUserId: ctx.userId ?? null,
        lastSampleReportId: ctx.reportId ?? null,
      },
      update: {
        seenCount: { increment: 1 },
        lastSampleUserId: ctx.userId ?? undefined,
        lastSampleReportId: ctx.reportId ?? undefined,
        lastSeenAt: new Date(),
      },
    });
  } catch (err) {
    console.warn("[biomarker-resolver] logUnresolvedTestName failed:", err instanceof Error ? err.message : err);
  }
}

/** Testing / admin hook — invalidate the in-memory cache after seeding. */
export function invalidateBiomarkerCache(): void {
  cache = null;
}
