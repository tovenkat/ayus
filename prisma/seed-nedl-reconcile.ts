/**
 * Reconciling NEDL synonym seed.
 *
 * The naive seed (seed-nedl-synonyms.ts) keys canonicals by clean_display_name,
 * which would create ~180 DUPLICATES of the curated biomarker canonicals
 * ("Hemoglobin (Hb)" vs existing "Hemoglobin") and could steal synonyms from
 * them — breaking organ/risk/follow-up views that depend on the curated set.
 *
 * This version instead:
 *   - Matches each NEDL test to an EXISTING canonical (by name / sub-parts /
 *     parenthetical abbrev, against canonical names AND existing synonyms).
 *     Match → attach NEDL synonyms there (keep curated organ maps + LOINC).
 *   - No match → create a new canonical (with the NEDL LOINC if valid).
 *   - Never reassigns a synonym already owned by a different canonical.
 *
 * Idempotent. Run: npm run nedl:reconcile
 */

import "dotenv/config";
import { createReadStream } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";
import { prisma } from "../src/lib/prisma";

const CSV_PATH = path.join(process.cwd(), "nedl_test_synonyms.csv");

type Row = { official_nedl_name: string; clean_display_name: string; inferred_loinc_code: string; synonym: string };

/** Normalize for matching: lowercase, punctuation→space, collapse. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[().,/\\+\-]/g, " ").replace(/\s+/g, " ").trim();
}

/** Candidate keys for a display name: whole, slash-parts, parenthetical abbrev. */
function candidates(display: string): string[] {
  const out = new Set<string>();
  out.add(norm(display));
  out.add(norm(display.replace(/\([^)]*\)/g, ""))); // strip parens
  for (const part of display.split("/")) out.add(norm(part));
  const paren = display.match(/\(([^)]*)\)/);
  if (paren) for (const p of paren[1].split("/")) out.add(norm(p));
  return [...out].filter(Boolean);
}

async function main() {
  // 1. Read + group NEDL rows by display name.
  const rows: Row[] = [];
  const parser = createReadStream(CSV_PATH).pipe(parse({ columns: true, skip_empty_lines: true, trim: true }));
  for await (const rec of parser) rows.push(rec as Row);

  const groups = new Map<string, { display: string; loinc: string | null; synonyms: string[] }>();
  for (const r of rows) {
    const display = r.clean_display_name?.trim();
    const syn = r.synonym?.trim();
    if (!display || !syn) continue;
    let g = groups.get(display);
    if (!g) { g = { display, loinc: r.inferred_loinc_code?.trim() || null, synonyms: [] }; groups.set(display, g); }
    if (!g.loinc && r.inferred_loinc_code?.trim()) g.loinc = r.inferred_loinc_code.trim();
    g.synonyms.push(syn);
  }

  // 2. Build lookup: normalized(canonical name | synonym rawName) → canonicalId.
  const canonicals = await prisma.testCanonical.findMany({
    select: { id: true, name: true, loincNum: true, synonyms: { select: { rawName: true } } },
  });
  const lookup = new Map<string, string>();
  for (const c of canonicals) {
    lookup.set(norm(c.name), c.id);
    for (const s of c.synonyms) lookup.set(norm(s.rawName), c.id);
  }
  // Which canonical currently owns a given rawName (for the no-steal guard).
  const synonymOwner = new Map<string, string>();
  for (const c of canonicals) for (const s of c.synonyms) synonymOwner.set(s.rawName.toLowerCase(), c.id);

  // Valid LOINC codes (guard the FK).
  const wantLoinc = [...new Set([...groups.values()].map((g) => g.loinc).filter((v): v is string => !!v))];
  const validLoinc = new Set(
    (await prisma.loincTerm.findMany({ where: { loincNum: { in: wantLoinc } }, select: { loincNum: true } })).map((r) => r.loincNum),
  );

  let matched = 0, created = 0, synAdded = 0, synSkipped = 0, loincFilled = 0;

  for (const g of groups.values()) {
    // 3. Resolve target canonical.
    let targetId: string | null = null;
    for (const c of candidates(g.display)) {
      if (lookup.has(c)) { targetId = lookup.get(c)!; break; }
    }

    if (targetId) {
      matched++;
      // Fill a missing LOINC on the existing canonical (never overwrite).
      if (g.loinc && validLoinc.has(g.loinc)) {
        const existing = canonicals.find((c) => c.id === targetId);
        if (existing && !existing.loincNum) {
          await prisma.testCanonical.update({ where: { id: targetId }, data: { loincNum: g.loinc } });
          existing.loincNum = g.loinc;
          loincFilled++;
        }
      }
    } else {
      const loincNum = g.loinc && validLoinc.has(g.loinc) ? g.loinc : null;
      const c = await prisma.testCanonical.upsert({
        where: { name: g.display },
        create: { name: g.display, loincNum },
        update: loincNum ? { loincNum } : {},
      });
      targetId = c.id;
      created++;
      lookup.set(norm(g.display), c.id); // so later groups can match it too
    }

    // 4. Attach synonyms with no-steal guard.
    for (const raw of g.synonyms) {
      const owner = synonymOwner.get(raw.toLowerCase());
      if (owner && owner !== targetId) { synSkipped++; continue; } // owned elsewhere — leave it
      if (owner === targetId) continue; // already there
      await prisma.testSynonym.upsert({
        where: { rawName: raw },
        create: { rawName: raw, canonicalTestId: targetId },
        update: { canonicalTestId: targetId },
      });
      synonymOwner.set(raw.toLowerCase(), targetId);
      synAdded++;
    }
  }

  const totalSyn = await prisma.testSynonym.count();
  const totalCanon = await prisma.testCanonical.count();
  console.log(
    `[nedl-reconcile] done — NEDL tests: ${groups.size} (matched to existing: ${matched}, new canonicals: ${created})\n` +
    `  synonyms added: ${synAdded}, skipped (owned elsewhere): ${synSkipped}, LOINC filled on existing: ${loincFilled}\n` +
    `  DB now: ${totalCanon} canonicals, ${totalSyn} synonyms`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
