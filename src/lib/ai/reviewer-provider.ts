/**
 * Reviewer provider — the "second opinion" model for low-confidence extraction
 * fields. Deliberately independent of the user's primary provider: the design
 * is Gemini (or local) for primary extraction, a stronger, careful model
 * (Claude by default) as the reviewer for uncertain fields only.
 *
 * Opt-in and inert unless REVIEW_LOW_CONFIDENCE=true AND a key for the chosen
 * reviewer provider is present — otherwise low-confidence rows just fall through
 * to the human review queue as before.
 */

import type { ChatProvider } from "./types";

type ReviewerProvider = "CLAUDE" | "OPENAI" | "GEMINI";

const KEY_ENV: Record<ReviewerProvider, string> = {
  CLAUDE: "CLAUDE_API_KEY",
  OPENAI: "OPENAI_API_KEY",
  GEMINI: "GEMINI_API_KEY",
};

const DEFAULT_MODEL: Record<ReviewerProvider, string> = {
  CLAUDE: "claude-sonnet-5",
  OPENAI: "gpt-4o",
  GEMINI: "gemini-2.5-pro",
};

export function getReviewerConfig(): { provider: ReviewerProvider; model: string; apiKey: string } | null {
  if ((process.env.REVIEW_LOW_CONFIDENCE ?? "").toLowerCase() !== "true") return null;
  const raw = (process.env.REVIEWER_PROVIDER ?? "CLAUDE").toUpperCase();
  const provider: ReviewerProvider = raw === "OPENAI" || raw === "GEMINI" ? raw : "CLAUDE";
  const apiKey = process.env[KEY_ENV[provider]];
  if (!apiKey) return null; // configured but no key → stay inert
  const model = process.env.REVIEW_MODEL?.trim() || DEFAULT_MODEL[provider];
  return { provider, model, apiKey };
}

/** Build the reviewer ChatProvider, or null when review is off / unconfigured. */
export async function getReviewerProvider(): Promise<{ provider: ChatProvider; provider_id: ReviewerProvider; model: string } | null> {
  const cfg = getReviewerConfig();
  if (!cfg) return null;
  const { CloudChatProvider } = await import("./cloud-chat");
  return {
    provider: new CloudChatProvider(cfg.provider, cfg.apiKey, cfg.model),
    provider_id: cfg.provider,
    model: cfg.model,
  };
}
