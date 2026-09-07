import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { verifyOtp, normalizePhone } from "@/lib/otp";

const emailLoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const phoneLoginSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(4),
  name: z.string().optional(), // only provided on registration
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "user";
}

function cleanName(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "undefined" || lower === "null") return null;
  return trimmed.slice(0, 80);
}

async function ensureUserForPhone(phone: string, name?: string) {
  const safeName = cleanName(name);
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    const placeholderEmail = `${phone.replace("+", "")}@phone.local`;
    user = await prisma.user.create({
      data: {
        phone,
        phoneVerified: new Date(),
        name: safeName,
        email: placeholderEmail,
      },
    });

    // Auto-provision org + seed vault (same as email signup)
    const { PRICING } = await import("@/lib/pricing");
    const freeTier = PRICING.FREE;
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const baseSlug = slugify(safeName ?? phone.replace("+", ""));
    let slug = baseSlug;
    let suffix = 0;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    try {
      const { seedVault } = await import("@/lib/vault");
      await seedVault(user.id);
    } catch (err) {
      console.warn(`[auth] seedVault failed for ${user.id}:`, err instanceof Error ? err.message : err);
    }

    await prisma.organization.create({
      data: {
        name: safeName ?? phone,
        slug,
        type: "INDIVIDUAL",
        members: { create: { userId: user.id, role: "OWNER" } },
        subscription: {
          create: {
            tier: "FREE",
            status: "TRIAL",
            reportsPerMonth: freeTier.reportsPerMonth,
            trialEndsAt: trialEnd,
            periodStart: now,
            periodEnd: trialEnd,
          },
        },
      },
    });
  } else if (safeName && !cleanName(user.name ?? undefined)) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { name: safeName, phoneVerified: new Date() },
    });
  } else if (!user.phoneVerified) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerified: new Date() },
    });
  }
  return user;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      id: "phone",
      name: "phone",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        code: { label: "OTP", type: "text" },
        name: { label: "Name", type: "text" },
      },
      async authorize(credentials) {
        const parsed = phoneLoginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        try {
          const phone = await verifyOtp(parsed.data.phone, parsed.data.code);
          const user = await ensureUserForPhone(phone, parsed.data.name?.trim() || undefined);
          return { id: user.id, email: user.email, name: user.name, phone: user.phone ?? undefined };
        } catch (err) {
          console.warn("[auth:phone] verify failed:", err instanceof Error ? err.message : err);
          return null;
        }
      },
    }),
    Credentials({
      id: "credentials",
      name: "credentials",
      credentials: {
        email: { label: "Email or User ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = emailLoginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const identifier = parsed.data.email.trim();

        let user = identifier.includes("@")
          ? await prisma.user.findUnique({ where: { email: identifier } })
          : null;

        if (!user && !identifier.includes("@")) {
          user =
            (await prisma.user.findUnique({ where: { id: identifier } })) ??
            (await prisma.user.findUnique({ where: { email: `${identifier}@userid.local` } }));
        }

        if (!user || !user.passwordHash) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});

export { normalizePhone };
