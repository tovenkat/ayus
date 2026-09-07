/**
 * Re-embed every existing chunk into the currently-configured VectorStore.
 *
 * Use when swapping vector backends (LanceDB → pgvector), when changing embed
 * models, or when you suspect the vector index has drifted from Postgres.
 *
 * Flow (per user):
 *   1. Mark every Chunk as embedded=false
 *   2. Loop embedPendingChunks(userId) until it returns 0
 *
 * Notes:
 * - This does NOT delete rows from the target store. If you're switching from
 *   LanceDB to pgvector, the old .lancedb/ dir is untouched (delete it by hand
 *   once you've verified pgvector works). Rows in the pgvector VectorEntry
 *   table with the same Chunk id get overwritten by the ON CONFLICT clause.
 * - Requires VECTOR_DB=pgvector (or lancedb) and Ollama running with the embed
 *   model available.
 *
 * Run: npm run vectors:reembed
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { embedPendingChunks } from "@/lib/ingestion/pipeline";
import { loadAIConfig } from "@/lib/ai/config";

async function main() {
  const config = loadAIConfig();
  if (config.vectorDb === "none") {
    console.error("VECTOR_DB is 'none' — nothing to embed into. Set VECTOR_DB=pgvector (or lancedb) in .env.");
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[reembed] ${users.length} user(s) · target=${config.vectorDb}`);

  let totalEmbedded = 0;
  for (const user of users) {
    const marked = await prisma.chunk.updateMany({
      where: { document: { userId: user.id } },
      data: { embedded: false },
    });
    console.log(`[reembed] user=${user.email} pending=${marked.count}`);
    if (marked.count === 0) continue;

    let userEmbedded = 0;
    while (true) {
      const n = await embedPendingChunks(user.id);
      if (n === 0) break;
      userEmbedded += n;
      process.stdout.write(`  · +${n} (${userEmbedded}/${marked.count})\n`);
    }
    totalEmbedded += userEmbedded;
  }

  console.log(`\n[reembed] done — ${totalEmbedded} chunk(s) embedded across ${users.length} user(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
