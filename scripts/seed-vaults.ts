import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { seedVault } from "@/lib/vault";

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    await seedVault(u.id);
    console.log(`seeded ${u.email}`);
  }
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
