/**
 * Seed canonical tests + synonyms from the NEDL synonym map CSV.
 *
 * Source: nedl_test_synonyms.csv (repo root) — long format, one row per
 * synonym, columns:
 *   official_nedl_name   the NEDL "Diagnostic test" name (grouping key only)
 *   clean_display_name   -> TestCanonical.name
 *   inferred_loinc_code  -> TestCanonical.loincNum (blank = leave null)
 *   synonym              -> TestSynonym.rawName
 *
 * Idempotent — safe to re-run. Upserts by natural keys (canonical name,
 * synonym rawName). Does NOT set organ maps or plausibility bounds; those
 * live in seed-biomarkers.ts. Where a clean_display_name matches a canonical
 * already seeded there, this only adds the NEDL synonyms to it.
 *
 * Run: npm run nedl:seed  (run `npm run loinc:seed` first to populate LOINC).
 */

import "dotenv/config";
import { createReadStream } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";
import { prisma } from "../src/lib/prisma";

const CSV_PATH = path.join(process.cwd(), "nedl_test_synonyms.csv");

type Row = {
  official_nedl_name: string;
  clean_display_name: string;
  inferred_loinc_code: string;
  synonym: string;
};

type Canon = {
  name: string;            // clean_display_name
  loinc: string | null;    // inferred_loinc_code ("" -> null)
  synonyms: string[];
};

async function readCsv(): Promise<Row[]> {
  const rows: Row[] = [];
  const parser = createReadStream(CSV_PATH).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  );
  for await (const rec of parser) rows.push(rec as Row);
  return rows;
}

/** Group synonym rows into one canonical per clean_display_name. */
function groupCanonicals(rows: Row[]): Canon[] {
  const byName = new Map<string, Canon>();
  const seenSynonym = new Set<string>(); // guard the DB-level @unique on rawName

  for (const r of rows) {
    const name = r.clean_display_name?.trim();
    const synonym = r.synonym?.trim();
    if (!name || !synonym) continue;

    let canon = byName.get(name);
    if (!canon) {
      const loinc = r.inferred_loinc_code?.trim() || null;
      canon = { name, loinc, synonyms: [] };
      byName.set(name, canon);
    } else if (!canon.loinc && r.inferred_loinc_code?.trim()) {
      canon.loinc = r.inferred_loinc_code.trim();
    }

    // A rawName can only belong to one canonical (unique). First writer wins;
    // warn on a cross-canonical collision so the CSV can be corrected.
    if (seenSynonym.has(synonym)) {
      const owner = [...byName.values()].find((c) => c.synonyms.includes(synonym));
      if (owner && owner.name !== name) {
        console.warn(
          `  ! duplicate synonym "${synonym}" — kept on "${owner.name}", skipped for "${name}"`,
        );
      }
      continue;
    }
    seenSynonym.add(synonym);
    canon.synonyms.push(synonym);
  }

  return [...byName.values()];
}

async function main() {
  const rows = await readCsv();
  const canonicals = groupCanonicals(rows);
  console.log(`[nedl] parsed ${rows.length} synonym rows -> ${canonicals.length} canonical tests`);

  // Pre-check LOINC presence — skip loincNum rather than fail the FK if the
  // loinc_terms table isn't populated yet (same guard as seed-biomarkers.ts).
  const wantedLoincs = Array.from(
    new Set(canonicals.map((c) => c.loinc).filter((v): v is string => !!v)),
  );
  const foundLoincs = wantedLoincs.length === 0
    ? new Set<string>()
    : new Set(
        (await prisma.loincTerm.findMany({
          where: { loincNum: { in: wantedLoincs } },
          select: { loincNum: true },
        })).map((r) => r.loincNum),
      );
  const missing = wantedLoincs.filter((l) => !foundLoincs.has(l));
  if (missing.length > 0) {
    console.warn(
      `[nedl] ${missing.length}/${wantedLoincs.length} LOINC code(s) not in loinc_terms. ` +
      `Run \`npm run loinc:seed\` first to link them. Continuing with loincNum=null for those.`,
    );
  }

  let synInserted = 0;
  for (const c of canonicals) {
    const loincNum = c.loinc && foundLoincs.has(c.loinc) ? c.loinc : null;
    const canonical = await prisma.testCanonical.upsert({
      where: { name: c.name },
      create: { name: c.name, loincNum },
      // Only fill loincNum if we have a valid one — never overwrite an
      // existing canonical's LOINC (e.g. one set by seed-biomarkers) with null.
      update: loincNum ? { loincNum } : {},
    });

    for (const raw of c.synonyms) {
      await prisma.testSynonym.upsert({
        where: { rawName: raw },
        create: { rawName: raw, canonicalTestId: canonical.id },
        update: { canonicalTestId: canonical.id },
      });
      synInserted++;
    }
  }

  const synCount = await prisma.testSynonym.count();
  const loincLinked = await prisma.testCanonical.count({ where: { loincNum: { not: null } } });
  console.log(
    `[nedl] done — canonicals=${canonicals.length}, synonyms upserted=${synInserted}, ` +
    `total synonyms in DB=${synCount}, canonicals with LOINC=${loincLinked}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
