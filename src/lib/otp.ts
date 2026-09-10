import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendWhatsApp, sendSms, twilioDemoMode } from "@/lib/twilio";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const DEMO_OTP = process.env.DEMO_OTP_CODE ?? "123456";

function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[^\d+]/g, "");
  // If no country code and it's 10 digits, assume India (+91)
  if (!trimmed.startsWith("+") && trimmed.length === 10) return `+91${trimmed}`;
  if (!trimmed.startsWith("+")) return `+${trimmed}`;
  return trimmed;
}

function isDemoPhone(phone: string): boolean {
  // Any phone starting with +1555, +91000, or exactly +919999999999 is treated as demo
  return phone.startsWith("+1555") || phone.startsWith("+91000") || phone === "+919999999999";
}

function hashCode(phone: string, code: string): string {
  return crypto.createHash("sha256").update(`${phone}|${code}`).digest("hex");
}

function randomCode(): string {
  return String(crypto.randomInt(100_000, 1_000_000));
}

export async function requestOtp(rawPhone: string): Promise<{ phone: string; demo: boolean; sentCodeForDev?: string }> {
  const phone = normalizePhone(rawPhone);
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw new Error("Invalid phone number. Use format +91XXXXXXXXXX.");
  }

  const useDemo = twilioDemoMode || isDemoPhone(phone);
  const code = useDemo ? DEMO_OTP : randomCode();

  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.phoneOtp.create({
    data: {
      phone,
      codeHash: hashCode(phone, code),
      expiresAt,
    },
  });

  if (!useDemo) {
    const message = `Your Ayus verification code is ${code}. It expires in 10 minutes. Reply STOP to opt out.`;
    try {
      await sendWhatsApp(phone, message);
    } catch (err) {
      console.warn("[otp] WhatsApp send failed, trying SMS:", err instanceof Error ? err.message : err);
      await sendSms(phone, message).catch((err2) => {
        console.warn("[otp] SMS send failed too:", err2 instanceof Error ? err2.message : err2);
      });
    }
  } else {
    console.log(`[otp:DEMO] phone=${phone} code=${code}`);
  }

  // Surface the code to the UI so it can pre-fill the input. Always safe in dev.
  // In production we only do this for demo logins AND only when explicitly opted
  // in via DEMO_OTP_AUTOFILL=true — so real OTPs are never leaked to the client.
  const autofill =
    useDemo &&
    (process.env.NODE_ENV !== "production" || process.env.DEMO_OTP_AUTOFILL === "true");

  return {
    phone,
    demo: useDemo,
    sentCodeForDev: autofill ? code : undefined,
  };
}

/**
 * Verify a code for a phone. Returns the normalized phone if success.
 * Throws on failure (unknown code, expired, too many attempts).
 */
export async function verifyOtp(rawPhone: string, code: string): Promise<string> {
  const phone = normalizePhone(rawPhone);
  const cleanCode = code.trim().replace(/\s/g, "");

  const recent = await prisma.phoneOtp.findFirst({
    where: { phone, verifiedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!recent) throw new Error("No active code. Please request a new one.");

  if (recent.attempts >= MAX_ATTEMPTS) {
    throw new Error("Too many attempts. Please request a new code.");
  }

  const expectedHash = hashCode(phone, cleanCode);
  const matches = expectedHash === recent.codeHash;

  await prisma.phoneOtp.update({
    where: { id: recent.id },
    data: {
      attempts: { increment: 1 },
      verifiedAt: matches ? new Date() : undefined,
    },
  });

  if (!matches) throw new Error("Incorrect code.");

  return phone;
}

export { normalizePhone };
