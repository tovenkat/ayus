/**
 * Seed the `loinc_terms` table from the official LOINC CSV downloads.
 *
 * Expects the CSVs at ./ionic/:
 *   LoincTableCore.csv   ← primary term table (~109k rows)
 *   ConsumerName.csv     ← plain-English aliases keyed by LOINC number
 *
 * Column mapping (LOINC → loinc_terms):
 *   LOINC_NUM         → loinc_num
 *   LONG_COMMON_NAME  → name
 *   COMPONENT         → component
 *   SYSTEM            → system
 *   SHORTNAME         → display_name
 *   ConsumerName      → consumer_name  (joined from ConsumerName.csv)
 *   (units)           → NULL  ← not present in LoincTableCore; enrich later from
 *                                the LOINC accessory Units file if needed
 *
 * Rerunnable:
 *   npm run loinc:seed             # inserts only new rows (skipDuplicates)
 *   npm run loinc:seed -- --truncate  # wipes the table first, then reseeds
 *
 * Perf: ~30 s on a warm machine (batched createMany, 1000 rows/batch).
 */

import "dotenv/config";
import path from "node:path";
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { prisma } from "../src/lib/prisma";

const IONIC_DIR = path.join(process.cwd(), "ionic");
const LOINC_CORE = path.join(IONIC_DIR, "LoincTableCore.csv");
const CONSUMER_NAME = path.join(IONIC_DIR, "ConsumerName.csv");

const BATCH_SIZE = 1000;

type Row = {
  loincNum: string;
  name: string | null;
  component: string | null;
  system: string | null;
  units: string | null;
  displayName: string | null;
  consumerName: string | null;
};

/** Read a CSV to a Map keyed by a chosen column. Blank cells become null. */
async function loadCsvToMap(
  file: string,
  keyCol: string,
  valueCol: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const parser = createReadStream(file).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  );
  for await (const rec of parser) {
    const key = rec[keyCol];
    const value = rec[valueCol];
    if (key) map.set(key, value ?? "");
  }
  return map;
}

function nullIfEmpty(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

async function main() {
  const truncate = process.argv.includes("--truncate");

  if (truncate) {
    console.log("[loinc-seed] --truncate: wiping loinc_terms first…");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "loinc_terms"`);
  }

  console.log(`[loinc-seed] loading consumer names from ${path.basename(CONSUMER_NAME)}…`);
  const consumerNames = await loadCsvToMap(CONSUMER_NAME, "LoincNumber", "ConsumerName");
  console.log(`[loinc-seed]   ${consumerNames.size.toLocaleString()} consumer names loaded`);

  console.log(`[loinc-seed] streaming core terms from ${path.basename(LOINC_CORE)}…`);
  const parser = createReadStream(LOINC_CORE).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  );

  let batch: Row[] = [];
  let total = 0;
  let inserted = 0;
  let batchIndex = 0;

  async function flush() {
    if (batch.length === 0) return;
    const result = await prisma.loincTerm.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
    batchIndex++;
    if (batchIndex % 10 === 0) {
      console.log(`  · batch ${batchIndex}  total=${total.toLocaleString()}  inserted=${inserted.toLocaleString()}`);
    }
    batch = [];
  }

  for await (const rec of parser) {
    const loincNum = nullIfEmpty(rec.LOINC_NUM);
    if (!loincNum) continue;

    batch.push({
      loincNum,
      name: nullIfEmpty(rec.LONG_COMMON_NAME),
      component: nullIfEmpty(rec.COMPONENT),
      system: nullIfEmpty(rec.SYSTEM),
      units: null, // not present in LoincTableCore; enrich from the units accessory file later
      displayName: nullIfEmpty(rec.SHORTNAME),
      consumerName: nullIfEmpty(consumerNames.get(loincNum)),
    });
    total++;

    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const dbCount = await prisma.loincTerm.count();
  console.log(
    `\n[loinc-seed] done — csv rows=${total.toLocaleString()}  newly inserted=${inserted.toLocaleString()}  loinc_terms total=${dbCount.toLocaleString()}`,
  );
  if (inserted < total && !truncate) {
    console.log(`  (rerun with --truncate to refresh existing rows)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
