/**
 * Seed the `diseases` table from a WHO ICD-10 CSV.
 *
 * WHO does not publish a canonical ICD-10 CSV under a free download — the
 * official distribution is the ClaML XML on the ICD-10 site. Practical
 * public sources that ship as usable CSVs:
 *
 *   • https://github.com/k4m4/icd10-codes  (MIT, WHO ICD-10 2019, code + description)
 *   • CDC ICD-10-CM Order File               (US clinical modification, more codes)
 *   • Your own hand-curated file             (start with ~30-50 most-relevant diseases)
 *
 * Expected file: `./ionic/icd10.csv` (override with --file=<path>).
 *
 * Column auto-detection — the seed accepts any of these header spellings:
 *   code:        code | Code | CODE | icd10_code | ICD10_CODE
 *   description: description | Description | DESC | name | Name
 *   category:    category | chapter | Chapter        (optional)
 *
 * Rerunnable:
 *   npm run diseases:seed                    # inserts only new rows (skipDuplicates)
 *   npm run diseases:seed -- --truncate      # wipes table first, then reseeds
 *   npm run diseases:seed -- --file=my.csv   # use a different source file
 *
 * IMPORTANT — this is a reference vocabulary, not a diagnostic tool. Loading
 * the table does not imply any user has any of these conditions. Diagnosis
 * flows through Rule + physician review, never through the disease table alone.
 */

import "dotenv/config";
import path from "node:path";
import { existsSync, createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { prisma } from "../src/lib/prisma";

const BATCH_SIZE = 1000;

type Row = {
  icd10Code: string;
  icd10Name: string;
  commonName: string;
  category: string | null;
};

function nullIfEmpty(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

function pickCol(rec: Record<string, string>, ...candidates: string[]): string | null {
  for (const c of candidates) {
    if (rec[c] !== undefined) {
      const v = nullIfEmpty(rec[c]);
      if (v) return v;
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const truncate = args.includes("--truncate");
  const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length);
  const csvPath = fileArg
    ? path.resolve(process.cwd(), fileArg)
    : path.join(process.cwd(), "ionic", "icd10.csv");

  if (!existsSync(csvPath)) {
    console.error(`\n❌ ICD-10 CSV not found at: ${csvPath}\n`);
    console.error("Download options:");
    console.error("  • https://github.com/k4m4/icd10-codes/raw/master/icd10.csv");
    console.error("  • CDC ICD-10-CM: https://www.cms.gov/medicare/icd-10/2024-icd-10-cm");
    console.error("  • Or hand-author a starter file with columns: code,description[,category]\n");
    console.error("Then place it at ionic/icd10.csv (or pass --file=<path>).\n");
    process.exit(1);
  }

  if (truncate) {
    console.log("[diseases-seed] --truncate: wiping diseases first…");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "diseases" CASCADE`);
  }

  console.log(`[diseases-seed] streaming ${path.basename(csvPath)}…`);
  const parser = createReadStream(csvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  );

  let batch: Row[] = [];
  let total = 0;
  let inserted = 0;
  let skippedNoCode = 0;
  let batchIndex = 0;

  async function flush() {
    if (batch.length === 0) return;
    // createMany with skipDuplicates → idempotent reruns; only new codes land.
    const result = await prisma.disease.createMany({ data: batch, skipDuplicates: true });
    inserted += result.count;
    batchIndex++;
    if (batchIndex % 5 === 0) {
      console.log(`  · batch ${batchIndex}  total=${total.toLocaleString()}  inserted=${inserted.toLocaleString()}`);
    }
    batch = [];
  }

  for await (const rec of parser) {
    const code = pickCol(rec, "code", "Code", "CODE", "icd10_code", "ICD10_CODE");
    const desc = pickCol(rec, "description", "Description", "DESC", "name", "Name", "long_description");
    const category = pickCol(rec, "category", "Category", "chapter", "Chapter");

    if (!code || !desc) {
      skippedNoCode++;
      continue;
    }

    batch.push({
      icd10Code: code,
      icd10Name: desc,
      // commonName defaults to the ICD name; curate later with friendlier
      // versions (e.g. "E11.9 → Type 2 Diabetes Mellitus" instead of the
      // official "Type 2 diabetes mellitus without complications").
      commonName: desc,
      category,
    });
    total++;

    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const dbCount = await prisma.disease.count();
  console.log(
    `\n[diseases-seed] done — csv rows=${total.toLocaleString()}  newly inserted=${inserted.toLocaleString()}  diseases total=${dbCount.toLocaleString()}`,
  );
  if (skippedNoCode > 0) {
    console.log(`  ⚠ skipped ${skippedNoCode} row(s) missing code or description — check CSV headers`);
  }
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
