"use server";

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requestOtp as requestOtpLib } from "@/lib/otp";

export type OtpRequestState = {
  phone?: string;
  error?: string;
  demo?: boolean;
  devCode?: string; // pre-fill OTP in dev-demo mode
};

export async function requestOtpAction(
  _prev: OtpRequestState,
  formData: FormData,
): Promise<OtpRequestState> {
  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone) return { error: "Please enter a phone number." };
  try {
    const result = await requestOtpLib(phone);
    return {
      phone: result.phone,
      demo: result.demo,
      devCode: result.sentCodeForDev,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send OTP" };
  }
}

const registerSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().min(1, "Email or User ID is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterState = {
  errors?: Record<string, string[]>;
  message?: string;
  success?: boolean;
};

export async function register(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const { name, password } = parsed.data;
  const identifier = parsed.data.email.trim();
  const isEmail = identifier.includes("@");
  const email = isEmail ? identifier : `${identifier}@userid.local`;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      errors: {
        email: [
          isEmail
            ? "An account with this email already exists"
            : "This user ID is already taken",
        ],
      },
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { PRICING } = await import("@/lib/pricing");
  const freeTier = PRICING.FREE;
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const baseSlug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "user";
  let slug = baseSlug;
  let suffix = 0;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const user = await prisma.user.create({ data: { name, email, passwordHash } });

  const { seedVault } = await import("@/lib/vault");
  await seedVault(user.id).catch((err) => {
    console.warn(`[auth] seedVault failed for ${user.id}:`, err instanceof Error ? err.message : err);
  });

  await prisma.organization.create({
    data: {
      name: name ?? email,
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

  return { success: true, message: "Account created. Please sign in." };
}
