/**
 * Seed a fleet of dummy accounts across all four plans, so the multi-plan
 * UX can be exercised in dev.
 *
 * All phones use the `+91000…` demo pattern (see src/lib/otp.ts:isDemoPhone).
 * That means the OTP is ALWAYS the value of `DEMO_OTP_CODE` (default `123456`),
 * regardless of Twilio configuration. Real SMS is never sent.
 *
 * Idempotent — rows are keyed by phone / slug, so reruns update nothing new
 * unless a row is missing.
 *
 * Usage:
 *   npm run dummy:seed
 *   npm run dummy:seed -- --print   # just re-print the phones, don't touch DB
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { OrgType } from "@prisma/client";

const DEMO_OTP = process.env.DEMO_OTP_CODE ?? "123456";

type PersonalSpec = { phone: string; name: string };
type OrgSpec = {
  phone: string;
  name: string;      // primary user's name
  orgType: OrgType;
  orgName: string;   // organization display name
  slug: string;
};

// Personal (Individual) accounts. Realistic Indian names covering different
// scripts a search should be able to hit.
const PERSONAL: PersonalSpec[] = [
  { phone: "+910000000001", name: "Aarav Sharma" },
  { phone: "+910000000002", name: "Priya Iyer" },
  { phone: "+910000000003", name: "Rahul Kumar" },
  { phone: "+910000000004", name: "Sneha Patel" },
  { phone: "+910000000005", name: "Vikram Reddy" },
];

// Organization-owning accounts — one per non-personal plan.
const ORG_ACCOUNTS: OrgSpec[] = [
  {
    phone: "+910000000010",
    name: "Meera Nair",
    orgType: "DIAGNOSTIC_CENTER",
    orgName: "Bluebell Diagnostics",
    slug: "bluebell-diagnostics",
  },
  {
    phone: "+910000000020",
    name: "Dr. Arjun Menon",
    orgType: "CLINIC",
    orgName: "Menon Family Clinic",
    slug: "menon-family-clinic",
  },
  {
    phone: "+910000000030",
    name: "Dr. Suresh Iyengar",
    orgType: "HOSPITAL",
    orgName: "Sri Venkateswara Hospital",
    slug: "sri-venkateswara-hospital",
  },
];

async function ensureUser(phone: string, name: string) {
  const placeholderEmail = `${phone.replace("+", "")}@phone.local`;
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({
      data: { phone, name, email: placeholderEmail, phoneVerified: new Date() },
    });
    console.log(`  + user ${phone} — ${name}  (id=${user.id.slice(0, 8)})`);
  } else {
    if (user.name !== name) {
      user = await prisma.user.update({ where: { id: user.id }, data: { name } });
    }
    console.log(`  = user ${phone} — ${name}  (exists)`);
  }
  return user;
}

async function ensureIndividualOrg(userId: string, name: string, slug: string) {
  const existing = await prisma.organizationMember.findFirst({
    where: { userId, organization: { type: "INDIVIDUAL" } },
    include: { organization: true },
  });
  if (existing) return existing.organization;

  const { PRICING } = await import("../src/lib/pricing");
  const tier = PRICING.FREE;
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return prisma.organization.create({
    data: {
      name,
      slug: await uniqueSlug(slug),
      type: "INDIVIDUAL",
      members: { create: { userId, role: "OWNER" } },
      subscription: {
        create: {
          tier: "FREE",
          status: "TRIAL",
          reportsPerMonth: tier.reportsPerMonth,
          trialEndsAt: trialEnd,
          periodStart: now,
          periodEnd: trialEnd,
        },
      },
    },
  });
}

async function ensureBusinessOrg(userId: string, spec: OrgSpec) {
  // Find any pre-existing org of the target type owned by this user.
  const existing = await prisma.organizationMember.findFirst({
    where: { userId, organization: { type: spec.orgType } },
    include: { organization: true },
  });
  if (existing) {
    console.log(`  = org  ${spec.orgName}  (${spec.orgType}, exists)`);
    return existing.organization;
  }

  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  // Pick a plausible starter tier per org type for the trial. The Subscription
  // model is required (Organization → Subscription is a required relation for
  // billing gating), so the seed lands one whether or not the plan is real yet.
  const tierByType: Record<OrgType, "CLINIC_STARTER" | "DIAGNOSTIC_CENTER" | "HOSPITAL_SITE" | "FREE"> = {
    INDIVIDUAL: "FREE",
    CLINIC: "CLINIC_STARTER",
    DIAGNOSTIC_CENTER: "DIAGNOSTIC_CENTER",
    HOSPITAL: "HOSPITAL_SITE",
    ENTERPRISE: "FREE",
  };
  const tier = tierByType[spec.orgType];

  const org = await prisma.organization.create({
    data: {
      name: spec.orgName,
      slug: await uniqueSlug(spec.slug),
      type: spec.orgType,
      members: { create: { userId, role: "OWNER" } },
      subscription: {
        create: {
          tier,
          status: "TRIAL",
          reportsPerMonth: 500, // generous trial
          trialEndsAt: trialEnd,
          periodStart: now,
          periodEnd: trialEnd,
        },
      },
    },
  });
  console.log(`  + org  ${spec.orgName}  (${spec.orgType}, tier=${tier})`);
  return org;
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 0;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    n++;
    slug = `${base}-${n}`;
    if (n > 100) throw new Error(`could not find a free slug for ${base}`);
  }
  return slug;
}

function printSummary() {
  const line = (label: string, phone: string, name: string) =>
    console.log(`  ${label.padEnd(11)}  ${phone}   OTP ${DEMO_OTP}   ${name}`);

  console.log("\n═════════════════════════════════════════════════════════════════════════");
  console.log(" Dummy accounts — log in with these phone numbers + OTP code");
  console.log("═════════════════════════════════════════════════════════════════════════\n");
  console.log(`  ${"plan".padEnd(11)}  ${"phone".padEnd(14)}   ${"otp".padEnd(10)}   name / org`);
  console.log(`  ${"----".padEnd(11)}  ${"-----".padEnd(14)}   ${"---".padEnd(10)}   ----------`);
  for (const p of PERSONAL) line("individual", p.phone, p.name);
  for (const o of ORG_ACCOUNTS) line(o.orgType.toLowerCase().replace("_", " "), o.phone, `${o.name} · ${o.orgName}`);
  console.log("\n  Log in flow:");
  console.log(`   1. Go to /login`);
  console.log(`   2. Enter the phone number (with +91 prefix)`);
  console.log(`   3. Enter OTP ${DEMO_OTP}`);
  console.log(`   4. You're in — sidebar and dashboard show the plan-specific UI.\n`);
}

async function main() {
  const printOnly = process.argv.includes("--print");
  if (printOnly) {
    printSummary();
    return;
  }

  console.log("[dummy-seed] seeding …\n");

  console.log(" Personal (Individual)");
  for (const spec of PERSONAL) {
    const user = await ensureUser(spec.phone, spec.name);
    await ensureIndividualOrg(user.id, spec.name, `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-personal`);
  }

  console.log("\n Organization owners");
  for (const spec of ORG_ACCOUNTS) {
    const user = await ensureUser(spec.phone, spec.name);
    // Every non-personal owner ALSO gets a personal Individual org so they
    // have their own private space; then the business org tips the account
    // kind (earliest-created membership wins in account-kind.ts). Ordering:
    // create business org FIRST so it becomes the "primary" membership.
    await ensureBusinessOrg(user.id, spec);
    // Personal org second — becomes their fallback space but doesn't flip kind
    // because it's the LATER membership.
    await ensureIndividualOrg(user.id, spec.name, `${spec.slug}-personal`);
  }

  printSummary();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
