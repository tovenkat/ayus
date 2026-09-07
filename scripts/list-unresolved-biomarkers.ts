/**
 * List rawNames that the biomarker resolver could not match, ranked by how
 * often they've been seen. Use this to spot missing synonyms and add them to
 * `prisma/seed-biomarkers.ts`.
 *
 * Workflow:
 *   1. npm run biomarkers:unresolved                    ← see top misses
 *   2. edit prisma/seed-biomarkers.ts, add synonyms
 *   3. npm run biomarkers:seed                          ← upsert new synonyms
 *   4. npm run biomarkers:backfill                      ← retry historical rows
 *   5. optionally mark curated ones: use --curate <id>  ← removes from PENDING
 *
 * Options:
 *   --limit N       show top N (default 50)
 *   --status X      PENDING (default) | CURATED | IGNORED | ALL
 *   --curate ID     mark one row as CURATED
 *   --ignore ID     mark one row as IGNORED (never re-suggested)
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

type Args = {
  limit: number;
  status: string;
  curate: string | null;
  ignore: string | null;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { limit: 50, status: "PENDING", curate: null, ignore: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit") out.limit = Number(args[++i]);
    else if (a === "--status") out.status = args[++i].toUpperCase();
    else if (a === "--curate") out.curate = args[++i];
    else if (a === "--ignore") out.ignore = args[++i];
  }
  return out;
}

async function main() {
  const { limit, status, curate, ignore } = parseArgs();

  if (curate) {
    await prisma.unresolvedTestName.update({ where: { id: curate }, data: { status: "CURATED" } });
    console.log(`Marked ${curate} as CURATED.`);
    return;
  }
  if (ignore) {
    await prisma.unresolvedTestName.update({ where: { id: ignore }, data: { status: "IGNORED" } });
    console.log(`Marked ${ignore} as IGNORED.`);
    return;
  }

  const where = status === "ALL" ? {} : { status };
  const rows = await prisma.unresolvedTestName.findMany({
    where,
    orderBy: [{ seenCount: "desc" }, { lastSeenAt: "desc" }],
    take: limit,
  });

  if (rows.length === 0) {
    console.log(`No unresolved test names with status=${status}.`);
    return;
  }

  const idW = Math.max(...rows.map((r) => r.id.length), 4);
  const nameW = Math.max(...rows.map((r) => r.rawName.length), 8);
  console.log(
    `${"id".padEnd(idW)}  ${"seen".padStart(4)}  ${"lastSeen".padEnd(19)}  ${"rawName".padEnd(nameW)}  normalizedForm`,
  );
  console.log("-".repeat(idW + nameW + 40));
  for (const r of rows) {
    console.log(
      `${r.id.padEnd(idW)}  ${String(r.seenCount).padStart(4)}  ${r.lastSeenAt.toISOString().slice(0, 19)}  ${r.rawName.padEnd(nameW)}  ${r.normalizedForm}`,
    );
  }

  const [total, pending, curated, ignored] = await Promise.all([
    prisma.unresolvedTestName.count(),
    prisma.unresolvedTestName.count({ where: { status: "PENDING" } }),
    prisma.unresolvedTestName.count({ where: { status: "CURATED" } }),
    prisma.unresolvedTestName.count({ where: { status: "IGNORED" } }),
  ]);
  console.log(`\ntotal=${total}  pending=${pending}  curated=${curated}  ignored=${ignored}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
