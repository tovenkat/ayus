import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { copyToRaw, writeWikiPage, appendLog, safeFileName } from "@/lib/vault";
import { toSlug } from "@/lib/ingestion/parsers/markdown";

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["'](.*)["']$/, "$1");
    if (k) out[k] = v;
  }
  return out;
}

function vaultPathFor(doc: { slug: string; title: string; rawContent: string }): string {
  const fm = parseFrontmatter(doc.rawContent);
  switch (fm.type) {
    case "master-index":
      return "index.md";
    case "lab-report-summary":
      return fm.date ? `lab-reports/${fm.date}.md` : `lab-reports/${doc.slug}.md`;
    case "biomarker-entity":
      return `entities/${toSlug(fm.title ?? doc.title)}.md`;
    default:
      return `${doc.slug}.md`;
  }
}

async function main() {
  const userIdArg = process.argv[2];
  const users = userIdArg
    ? await prisma.user.findMany({ where: { id: userIdArg }, select: { id: true } })
    : await prisma.user.findMany({ select: { id: true } });

  for (const user of users) {
    console.log(`[vault-sync] user ${user.id}`);
    let wikiCount = 0;
    let rawCount = 0;

    const docs = await prisma.document.findMany({
      where: { userId: user.id },
      select: { slug: true, title: true, rawContent: true },
    });
    for (const doc of docs) {
      const relPath = vaultPathFor(doc);
      await writeWikiPage(user.id, relPath, doc.rawContent);
      wikiCount++;
    }

    const uploads = await prisma.upload.findMany({
      where: { userId: user.id },
      select: { originalName: true, storagePath: true, sha256: true },
    });
    for (const up of uploads) {
      try {
        const buf = await storage.download(up.storagePath);
        await copyToRaw(user.id, `${up.sha256.slice(0, 12)}-${safeFileName(up.originalName)}`, buf);
        rawCount++;
      } catch (err) {
        console.warn(`  skip ${up.originalName}: ${err instanceof Error ? err.message : err}`);
      }
    }

    await appendLog(user.id, `backfill: ${wikiCount} wiki page(s), ${rawCount} raw file(s)`);
    console.log(`  wrote ${wikiCount} wiki pages, ${rawCount} raw files`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
