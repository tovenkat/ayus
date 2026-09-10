import type { AiProvider, SubscriptionTier } from "@prisma/client";

// ─── Tiers ──────────────────────────────────────────────────────────────────

export type TierDef = {
  id: SubscriptionTier;
  label: string;
  targetPersona: string;
  priceInrPerMonth: number;
  priceInrPerYear: number;
  reportsPerMonth: number;
  membersIncluded: number;
  byokAllowed: boolean;
  apiAccess: boolean;
  slaHours: number | null;
  features: string[];
};

export const PRICING: Record<SubscriptionTier, TierDef> = {
  FREE: {
    id: "FREE",
    label: "Free",
    targetPersona: "Trial / student",
    priceInrPerMonth: 0,
    priceInrPerYear: 0,
    reportsPerMonth: 5,
    membersIncluded: 1,
    byokAllowed: true,
    apiAccess: false,
    slaHours: null,
    features: [
      "Local Ollama (free) or bring your own key (BYOK)",
      "Use your own Gemini / OpenAI / Claude key — entry models",
      "5 reports / month",
      "Obsidian-compatible vault",
    ],
  },
  PERSONAL: {
    id: "PERSONAL",
    label: "Personal",
    targetPersona: "Individual patient",
    priceInrPerMonth: 99,
    priceInrPerYear: 999,
    reportsPerMonth: 30,
    membersIncluded: 1,
    byokAllowed: true,
    apiAccess: false,
    slaHours: null,
    features: [
      "Choose: Gemini Flash, OpenAI gpt-4o-mini, or Claude Haiku",
      "Bring your own key (BYOK) — use your existing Gemini / OpenAI / Claude quota",
      "30 reports / month",
      "ABHA link (roadmap)",
      "Trend charts & wiki auto-generation",
    ],
  },
  FAMILY: {
    id: "FAMILY",
    label: "Family",
    targetPersona: "Household (5 members)",
    priceInrPerMonth: 299,
    priceInrPerYear: 2999,
    reportsPerMonth: 150,
    membersIncluded: 5,
    byokAllowed: true,
    apiAccess: false,
    slaHours: null,
    features: [
      "Everything in Personal",
      "All entry-tier models: Gemini Flash / gpt-4o-mini / Claude Haiku",
      "Up to 5 members",
      "150 reports / month pooled",
      "Shared biomarker timeline across members",
    ],
  },
  CLINIC_STARTER: {
    id: "CLINIC_STARTER",
    label: "Clinic Starter",
    targetPersona: "Solo doctor / small lab",
    priceInrPerMonth: 2499,
    priceInrPerYear: 24999,
    reportsPerMonth: 1000,
    membersIncluded: 10,
    byokAllowed: true,
    apiAccess: true,
    slaHours: 48,
    features: [
      "All providers: Gemini Pro, OpenAI gpt-4o, Claude Sonnet (on demand)",
      "1,000 reports / month",
      "Up to 10 staff seats",
      "REST API access",
      "Branded patient reports",
      "GST invoicing",
    ],
  },
  DIAGNOSTIC_CENTER: {
    id: "DIAGNOSTIC_CENTER",
    label: "Diagnostic Center",
    targetPersona: "Lab chain (2–10 locations)",
    priceInrPerMonth: 9999,
    priceInrPerYear: 99999,
    reportsPerMonth: 5000,
    membersIncluded: 50,
    byokAllowed: true,
    apiAccess: true,
    slaHours: 12,
    features: [
      "All cloud providers: Gemini Pro, OpenAI gpt-4o, Claude Sonnet",
      "Priority routing (faster cold-start than Clinic Starter)",
      "5,000 reports / month",
      "Multi-location admin",
      "Up to 50 staff seats",
      "Priority support (12h SLA)",
      "Webhooks on report completion",
      "Custom branding",
    ],
  },
  HOSPITAL_SITE: {
    id: "HOSPITAL_SITE",
    label: "Hospital",
    targetPersona: "Single hospital / site",
    priceInrPerMonth: 24999,
    priceInrPerYear: 249999,
    reportsPerMonth: 20000,
    membersIncluded: 200,
    byokAllowed: true,
    apiAccess: true,
    slaHours: 6,
    features: [
      "Everything in Diagnostic Center",
      "Departments, wards & admissions",
      "Multi-doctor teams with roles",
      "20,000 reports / month",
      "Up to 200 staff seats",
      "Institution-wide population health & registries",
      "Priority support (6h SLA)",
    ],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    label: "Enterprise",
    targetPersona: "Hospital groups / health systems",
    priceInrPerMonth: 0, // negotiated
    priceInrPerYear: 0,
    reportsPerMonth: 0, // unmetered
    membersIncluded: 0, // unmetered
    byokAllowed: true,
    apiAccess: true,
    slaHours: 4,
    features: [
      "Every provider + Azure OpenAI / AWS Bedrock / Google Vertex",
      "Bring Your Own Cloud (AWS / Azure / GCP / on-prem)",
      "Unlimited reports & seats",
      "Dedicated data region",
      "DPDP + HIPAA audit pack",
      "4-hour SLA, named CSM",
      "Custom integrations (HIS / LIS / FHIR)",
    ],
  },
};

export const PUBLIC_TIERS: SubscriptionTier[] = [
  "FREE",
  "PERSONAL",
  "FAMILY",
  "CLINIC_STARTER",
  "DIAGNOSTIC_CENTER",
  "ENTERPRISE",
];

// ─── AI model catalog ───────────────────────────────────────────────────────
//
// Prices in USD per 1M tokens. Verify against provider docs before billing.
// Last reviewed: 2026-04.

export type ModelDef = {
  id: string;
  label: string;
  provider: AiProvider;
  visionCapable: boolean;
  contextWindow: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  tierMin: SubscriptionTier; // lowest tier that can use this model
  role: ("extract" | "ocr" | "chat")[];
};

export const MODELS: ModelDef[] = [
  // ── Local (free at inference) ──
  {
    id: "qwen2.5:7b-instruct",
    label: "Qwen 2.5 7B (local)",
    provider: "OLLAMA_LOCAL",
    visionCapable: false,
    contextWindow: 32768,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    tierMin: "FREE",
    role: ["extract", "chat"],
  },
  {
    id: "qwen2.5vl:7b",
    label: "Qwen 2.5 VL 7B (local, vision)",
    provider: "OLLAMA_LOCAL",
    visionCapable: true,
    contextWindow: 32768,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    tierMin: "FREE",
    role: ["ocr"],
  },
  // ── Google Gemini ──
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "GEMINI",
    visionCapable: true,
    contextWindow: 1_000_000,
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.30,
    tierMin: "FREE",
    role: ["extract", "ocr", "chat"],
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "GEMINI",
    visionCapable: true,
    contextWindow: 2_000_000,
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 5.00,
    tierMin: "CLINIC_STARTER",
    role: ["extract", "ocr", "chat"],
  },
  // ── OpenAI ──
  {
    id: "gpt-4o-mini",
    label: "OpenAI gpt-4o-mini",
    provider: "OPENAI",
    visionCapable: true,
    contextWindow: 128000,
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.60,
    tierMin: "FREE",
    role: ["extract", "ocr", "chat"],
  },
  {
    id: "gpt-4o",
    label: "OpenAI gpt-4o",
    provider: "OPENAI",
    visionCapable: true,
    contextWindow: 128000,
    inputUsdPerMillion: 2.50,
    outputUsdPerMillion: 10.00,
    tierMin: "CLINIC_STARTER",
    role: ["extract", "ocr", "chat"],
  },
  // ── Anthropic Claude ──
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "CLAUDE",
    visionCapable: true,
    contextWindow: 200000,
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 1.25,
    tierMin: "FREE",
    role: ["extract", "ocr", "chat"],
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "CLAUDE",
    visionCapable: true,
    contextWindow: 200000,
    inputUsdPerMillion: 3.00,
    outputUsdPerMillion: 15.00,
    tierMin: "CLINIC_STARTER",
    role: ["extract", "ocr", "chat"],
  },
];

export const DEFAULT_MODEL_IDS: Record<AiProvider, string> = {
  OLLAMA_LOCAL: "qwen2.5:7b-instruct",
  VLLM: "vllm-model",           // placeholder; caller should supply user.aiModel or config.vllmDefaultModel
  LLAMACPP: "llamacpp-model",   // placeholder; llama-server accepts any id when a single model is loaded
  GEMINI: "gemini-2.5-flash",
  OPENAI: "gpt-4o-mini",
  CLAUDE: "claude-haiku-4-5-20251001",
  AZURE_OPENAI: "gpt-4o-mini",
  BEDROCK: "claude-haiku-4-5-20251001",
  VERTEX: "gemini-2.5-flash",
};

// ─── Cost math ──────────────────────────────────────────────────────────────

const USD_TO_INR = Number(process.env.USD_TO_INR ?? "84");
const MARGIN_MULTIPLIER = Number(process.env.PRICING_MARGIN ?? "2.0"); // 100% margin

export function findModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

export function computeCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; costInr: number; retailInr: number } {
  const model = findModel(modelId);
  if (!model) {
    return { costUsd: 0, costInr: 0, retailInr: 0 };
  }
  const inputCostUsd = (inputTokens / 1_000_000) * model.inputUsdPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * model.outputUsdPerMillion;
  const costUsd = inputCostUsd + outputCostUsd;
  const costInr = costUsd * USD_TO_INR;
  return {
    costUsd,
    costInr,
    retailInr: costInr * MARGIN_MULTIPLIER,
  };
}

export function tierAllowsModel(tier: SubscriptionTier, modelId: string): boolean {
  const model = findModel(modelId);
  if (!model) return false;
  return PUBLIC_TIERS.indexOf(tier) >= PUBLIC_TIERS.indexOf(model.tierMin);
}

export function modelsForTier(tier: SubscriptionTier): ModelDef[] {
  return MODELS.filter((m) => tierAllowsModel(tier, m.id));
}

/**
 * Estimate per-report cost for a typical Indian lab report.
 * Baseline: 8K input tokens (report text + prompt) + 2K output tokens (JSON).
 * Scanned PDFs multiply input by ~5x because vision tokens are heavier.
 */
export function estimateReportCost(
  modelId: string,
  { scanned = false }: { scanned?: boolean } = {},
): { inr: number; retailInr: number } {
  const inputTokens = scanned ? 40_000 : 8_000;
  const outputTokens = 2_000;
  const { costInr, retailInr } = computeCost(modelId, inputTokens, outputTokens);
  return { inr: costInr, retailInr };
}
