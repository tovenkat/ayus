/**
 * LOINC lookup — resolves a lab test name to its LOINC code via the canonical
 * layer: a name matches a TestCanonical (or one of its synonyms), and the
 * canonical carries the LOINC (loinc_num, seeded from the Regenstrief download).
 *
 * Cached in-memory (name/synonym → loincNum) since the canonical table is
 * seed-only and changes rarely. Mirrors biomarker-resolver's caching.
 */

import { prisma } from "@/lib/prisma";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,()/\\]/g, " ").replace(/\s+/g, " ").trim();
}

let cache: { byName: Map<string, string>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadCache(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.byName;

  const canonicals = await prisma.testCanonical.findMany({
    where: { loincNum: { not: null } },
    select: { name: true, loincNum: true, synonyms: { select: { rawName: true } } },
  });

  const byName = new Map<string, string>();
  for (const c of canonicals) {
    if (!c.loincNum) continue;
    byName.set(normalize(c.name), c.loincNum);
    for (const s of c.synonyms) byName.set(normalize(s.rawName), c.loincNum);
  }
  cache = { byName, loadedAt: Date.now() };
  return byName;
}

/** Resolve a raw/normalized test name to a LOINC code, or null on no match. */
export async function findLoincForTestName(name: string): Promise<{ loincNum: string } | null> {
  if (!name || !name.trim()) return null;
  const byName = await loadCache();
  const loincNum = byName.get(normalize(name));
  return loincNum ? { loincNum } : null;
}

/** True once the LOINC reference table has been seeded. */
export async function isLoincAvailable(): Promise<boolean> {
  const n = await prisma.loincTerm.count();
  return n > 0;
}
