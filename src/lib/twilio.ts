/**
 * Twilio WhatsApp / SMS wrapper with demo-mode fallback.
 *
 * In demo mode (TWILIO_ACCOUNT_SID unset, or DEMO_MODE=true) every send is a
 * console.log — no external call. This lets us exercise the full flow without
 * real credentials.
 */

const DEMO = process.env.DEMO_MODE === "true" || !process.env.TWILIO_ACCOUNT_SID;
const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886"; // Twilio sandbox default
const SMS_FROM = process.env.TWILIO_SMS_FROM;

function e164(phone: string): string {
  const trimmed = phone.trim().replace(/[^\d+]/g, "");
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

async function twilioPost(params: Record<string, string>): Promise<void> {
  if (DEMO) {
    console.log("[twilio:DEMO]", params);
    return;
  }
  if (!SID || !TOKEN) throw new Error("Twilio credentials missing");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`,
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status}: ${errBody.slice(0, 200)}`);
  }
}

export async function sendWhatsApp(toPhone: string, body: string): Promise<void> {
  await twilioPost({
    From: WHATSAPP_FROM,
    To: `whatsapp:${e164(toPhone)}`,
    Body: body,
  });
}

export async function sendSms(toPhone: string, body: string): Promise<void> {
  if (!SMS_FROM && !DEMO) {
    // Fall back to WhatsApp so the OTP still gets through during setup
    await sendWhatsApp(toPhone, body);
    return;
  }
  await twilioPost({
    From: SMS_FROM ?? "+10000000000",
    To: e164(toPhone),
    Body: body,
  });
}

export const twilioDemoMode = DEMO;
