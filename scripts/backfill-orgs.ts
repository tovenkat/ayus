import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { PRICING } from "@/lib/pricing";

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

async function main() {
  const users = await prisma.user.findMany({
    where: { orgMemberships: { none: {} } },
    select: { id: true, email: true, name: true },
  });

  console.log(`Backfilling orgs for ${users.length} user(s)`);

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const freeTier = PRICING.FREE;

  for (const u of users) {
    const baseSlug = toSlug(u.email.split("@")[0] ?? u.id);
    let slug = baseSlug;
    let suffix = 0;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const org = await prisma.organization.create({
      data: {
        name: u.name ?? u.email,
        slug,
        type: "INDIVIDUAL",
        members: {
          create: { userId: u.id, role: "OWNER" },
        },
        subscription: {
          create: {
            tier: "FREE",
            status: "TRIAL",
            reportsPerMonth: freeTier.reportsPerMonth,
            trialEndsAt: periodEnd,
            periodStart: now,
            periodEnd,
          },
        },
      },
    });
    console.log(`  ${u.email} → ${org.slug}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
