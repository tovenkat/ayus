/**
 * Minimal email sender — dependency-free, mirrors twilio.ts (fetch to a REST
 * provider, DEMO fallback). Uses Resend when RESEND_API_KEY is set; otherwise
 * logs the message so local/dev works without a provider.
 *
 * Config (.env):
 *   FEEDBACK_EMAIL   destination for in-app feedback (required to actually send)
 *   EMAIL_FROM       sender, e.g. "Ayus <feedback@yourdomain>" (Resend-verified)
 *   RESEND_API_KEY   Resend API key; absent → DEMO mode (console log only)
 */

const RESEND_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Ayus <onboarding@resend.dev>";
const DEMO = !RESEND_KEY;

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export type SendEmailResult = { ok: boolean; demo?: boolean; error?: string };

export function feedbackEmailTarget(): string | null {
  return process.env.FEEDBACK_EMAIL?.trim() || null;
}

/**
 * Who may triage feedback (see all + change status): the FEEDBACK_EMAIL owner,
 * plus any address in FEEDBACK_ADMIN_EMAILS (comma-separated). Case-insensitive.
 */
export function isFeedbackAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const admins = new Set(
    [process.env.FEEDBACK_EMAIL, ...(process.env.FEEDBACK_ADMIN_EMAILS ?? "").split(",")]
      .map((x) => x?.trim().toLowerCase())
      .filter((x): x is string => !!x),
  );
  return admins.has(e);
}

export async function sendEmail({ to, subject, text, replyTo }: SendEmailInput): Promise<SendEmailResult> {
  if (DEMO) {
    console.log(`[email:DEMO] (set RESEND_API_KEY to actually send)\n  to: ${to}\n  subject: ${subject}\n  reply-to: ${replyTo ?? "—"}\n  ${text.replace(/\n/g, "\n  ")}`);
    return { ok: true, demo: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text, reply_to: replyTo }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[email] Resend send failed ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, error: `provider ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
