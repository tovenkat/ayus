import { prisma } from "@/lib/prisma";
import { reconcileVault } from "@/lib/vault-reconcile";
import { embedPendingChunks } from "@/lib/ingestion/pipeline";

async function main() {
  const userIdArg = process.argv[2];
  const users = userIdArg
    ? await prisma.user.findMany({ where: { id: userIdArg }, select: { id: true } })
    : await prisma.user.findMany({ select: { id: true } });

  for (const user of users) {
    console.log(`[vault-reconcile] user ${user.id}`);
    const result = await reconcileVault(user.id);
    console.log(`  indexed ${result.indexed} file(s), deleted ${result.deleted} stale row(s)`);

    try {
      let batch = await embedPendingChunks(user.id);
      let total = batch;
      while (batch > 0) {
        batch = await embedPendingChunks(user.id);
        total += batch;
      }
      if (total > 0) console.log(`  embedded ${total} chunk(s)`);
    } catch (err) {
      console.warn(`  embedding skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
