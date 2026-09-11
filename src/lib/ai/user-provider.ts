import type { ChatProvider } from "./types";
import type { AiProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { DEFAULT_MODEL_IDS, findModel } from "@/lib/pricing";
import { loadAIConfig } from "./config";

export type ResolvedAiSettings = {
  provider: AiProvider;
  model: string;
  apiKey: string | null; // null → use system env key or local ollama
  baseURL: string | null; // only set for VLLM (per-user override or VLLM_BASE_URL env)
  source: "privacyMode" | "user" | "org" | "env" | "default" | "extractionLocal";
  userId: string;
  organizationId: string | null;
};

async function resolveForRole(userId: string, role: "extract" | "ocr" | "chat"): Promise<ResolvedAiSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      privacyMode: true,
      cloudExtractionOptIn: true,
      aiProvider: true,
      aiModel: true,
      byokKeyEncrypted: true,
      vllmBaseUrl: true,
      llamaCppBaseUrl: true,
      orgMemberships: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
          organization: {
            select: {
              id: true,
              defaultAiProvider: true,
              defaultAiModel: true,
              byokKeyEncrypted: true,
            },
          },
        },
      },
    },
  });

  if (!user) throw new Error(`User ${userId} not found`);

  const org = user.orgMemberships[0]?.organization ?? null;
  const config = loadAIConfig();

  // 1. Privacy mode → force local
  if (user.privacyMode) {
    return {
      provider: "OLLAMA_LOCAL",
      model: role === "ocr" ? (config.ocrModel ?? config.extractModel) : role === "extract" ? config.extractModel : config.chatModel,
      apiKey: null,
      baseURL: null,
      source: "privacyMode",
      userId,
      organizationId: org?.id ?? null,
    };
  }

  // Helpers for the two OpenAI-compatible self-hosted providers.
  const baseURLFor = (p: AiProvider, userVllm?: string | null, userLlama?: string | null): string | null => {
    if (p === "VLLM") return (userVllm ?? config.vllmBaseUrl) || null;
    if (p === "LLAMACPP") return (userLlama ?? config.llamaCppBaseUrl) || null;
    return null;
  };

  // For OLLAMA_LOCAL, pick the role-specific env model (EXTRACT_MODEL /
  // OCR_MODEL / CHAT_MODEL) instead of the tier-based DEFAULT_MODEL_IDS entry
  // (which is "qwen2.5:7b-instruct" — a chat model, not the extract model).
  // Matches the behavior of the privacyMode + default-fallback branches.
  const ollamaRoleModel = (): string =>
    role === "ocr"      ? (config.ocrModel ?? config.extractModel)
    : role === "extract" ? config.extractModel
    :                     config.chatModel;

  const modelFor = (p: AiProvider, explicit?: string | null): string => {
    if (explicit) return explicit;
    if (p === "OLLAMA_LOCAL") return ollamaRoleModel();
    if (p === "VLLM") return config.vllmDefaultModel ?? DEFAULT_MODEL_IDS.VLLM;
    if (p === "LLAMACPP") return config.llamaCppDefaultModel ?? DEFAULT_MODEL_IDS.LLAMACPP;
    return DEFAULT_MODEL_IDS[p];
  };

  const localSettings = (source: ResolvedAiSettings["source"]): ResolvedAiSettings => ({
    provider: "OLLAMA_LOCAL",
    model: ollamaRoleModel(),
    apiKey: null,
    baseURL: null,
    source,
    userId,
    organizationId: org?.id ?? null,
  });

  // Resolve the candidate provider (user > org > env > local default).
  let candidate: ResolvedAiSettings;
  if (user.aiProvider) {
    // 2. User preference
    candidate = {
      provider: user.aiProvider,
      model: modelFor(user.aiProvider, user.aiModel),
      apiKey: user.byokKeyEncrypted ? decryptSecret(user.byokKeyEncrypted) : systemKeyFor(user.aiProvider),
      baseURL: baseURLFor(user.aiProvider, user.vllmBaseUrl, user.llamaCppBaseUrl),
      source: "user",
      userId,
      organizationId: org?.id ?? null,
    };
  } else if (org?.defaultAiProvider) {
    // 3. Org default
    candidate = {
      provider: org.defaultAiProvider,
      model: modelFor(org.defaultAiProvider, org.defaultAiModel),
      apiKey: org.byokKeyEncrypted ? decryptSecret(org.byokKeyEncrypted) : systemKeyFor(org.defaultAiProvider),
      baseURL: baseURLFor(org.defaultAiProvider),
      source: "org",
      userId,
      organizationId: org.id,
    };
  } else if (config.internetLlm) {
    // 4. Env fallback
    const provider = config.internetLlm as AiProvider;
    candidate = {
      provider,
      model: config.internetLlmModel ?? modelFor(provider),
      apiKey: config.internetLlmApiKey,
      baseURL: baseURLFor(provider),
      source: "env",
      userId,
      organizationId: org?.id ?? null,
    };
  } else {
    // 5. Default → local Ollama
    candidate = localSettings("default");
  }

  // PHI guard: document extraction/OCR processes the RAW report (maximal PHI),
  // so it stays LOCAL even when a third-party cloud provider is configured —
  // unless the user explicitly opted in (cloudExtractionOptIn). Self-hosted
  // providers (Ollama/vLLM/llama.cpp) are the user's own infra, so they're
  // exempt. Chat/diet/prep always honor the configured provider.
  const isExtraction = role === "extract" || role === "ocr";
  const isThirdPartyCloud =
    candidate.provider !== "OLLAMA_LOCAL" &&
    candidate.provider !== "VLLM" &&
    candidate.provider !== "LLAMACPP";
  // Allow cloud extraction when the user opted in OR the deployment enabled it
  // globally (CLOUD_EXTRACTION=true) — otherwise pin extraction/OCR local (PHI).
  const cloudExtractionAllowed = user.cloudExtractionOptIn || config.cloudExtraction;
  if (isExtraction && isThirdPartyCloud && !cloudExtractionAllowed) {
    return localSettings("extractionLocal");
  }

  return candidate;
}

function systemKeyFor(provider: AiProvider): string | null {
  switch (provider) {
    case "GEMINI": return process.env.GEMINI_API_KEY ?? null;
    case "OPENAI": return process.env.OPENAI_API_KEY ?? null;
    case "CLAUDE": return process.env.CLAUDE_API_KEY ?? null;
    case "AZURE_OPENAI": return process.env.AZURE_OPENAI_API_KEY ?? null;
    case "BEDROCK": return process.env.AWS_BEDROCK_API_KEY ?? null;
    case "VERTEX": return process.env.VERTEX_API_KEY ?? null;
    // vLLM and llama.cpp usually run without auth; return a placeholder the OpenAI SDK will accept.
    case "VLLM": return process.env.VLLM_API_KEY ?? "not-required";
    case "LLAMACPP": return process.env.LLAMACPP_API_KEY ?? "not-required";
    default: return null;
  }
}

const PROVIDER_LABEL: Record<AiProvider, string> = {
  OLLAMA_LOCAL: "Local (Ollama)",
  VLLM: "Self-hosted (vLLM)",
  LLAMACPP: "Self-hosted (llama.cpp)",
  GEMINI: "Google Gemini",
  OPENAI: "OpenAI",
  CLAUDE: "Anthropic Claude",
  AZURE_OPENAI: "Azure OpenAI",
  BEDROCK: "AWS Bedrock",
  VERTEX: "Google Vertex AI",
};

export class MissingApiKeyError extends Error {
  readonly provider: AiProvider;
  readonly source: ResolvedAiSettings["source"];
  constructor(provider: AiProvider, source: ResolvedAiSettings["source"]) {
    const label = PROVIDER_LABEL[provider] ?? provider;
    super(
      source === "user" || source === "org"
        ? `No API key for ${label}. Open Settings → AI Configuration and paste your ${label} key (or switch to Local/Privacy mode).`
        : `No API key configured for ${label}.`,
    );
    this.provider = provider;
    this.source = source;
    this.name = "MissingApiKeyError";
  }
}

export async function getProviderForUser(userId: string, role: "extract" | "ocr" | "chat"): Promise<{ provider: ChatProvider; settings: ResolvedAiSettings }> {
  let settings = await resolveForRole(userId, role);
  const config = loadAIConfig();

  // vLLM / llama.cpp: base URL is mandatory. If missing, treat like a missing API key.
  if ((settings.provider === "VLLM" || settings.provider === "LLAMACPP") && !settings.baseURL) {
    const providerLabel = settings.provider === "VLLM" ? "vLLM" : "llama.cpp";
    const envVar = settings.provider === "VLLM" ? "VLLM_BASE_URL" : "LLAMACPP_BASE_URL";
    if (settings.source === "user" || settings.source === "org") {
      throw new Error(
        `${providerLabel} selected but no base URL configured. Open Settings → AI Configuration and enter your ${providerLabel} endpoint (or set ${envVar} in .env).`,
      );
    }
    console.warn(`[ai] Falling back to local Ollama: ${settings.provider} has no base URL (source=${settings.source}).`);
    settings = {
      provider: "OLLAMA_LOCAL",
      model: role === "ocr" ? (config.ocrModel ?? config.extractModel) : role === "extract" ? config.extractModel : config.chatModel,
      apiKey: null,
      baseURL: null,
      source: "default",
      userId: settings.userId,
      organizationId: settings.organizationId,
    };
  }

  // Cloud provider chosen but no key available.
  // - If the user (or their org) explicitly chose a cloud provider → surface a clear error;
  //   silently falling back to Ollama is confusing when Ollama isn't running.
  // - If the cloud provider came only from env defaults → fall back to local Ollama.
  // vLLM and llama.cpp are skipped here because they don't need an API key.
  if (settings.provider !== "OLLAMA_LOCAL" && settings.provider !== "VLLM" && settings.provider !== "LLAMACPP" && !settings.apiKey) {
    if (settings.source === "user" || settings.source === "org") {
      throw new MissingApiKeyError(settings.provider, settings.source);
    }
    console.warn(`[ai] Falling back to local Ollama: no API key for ${settings.provider} (source=${settings.source}).`);
    const fallbackModel = role === "ocr"
      ? (config.ocrModel ?? config.extractModel)
      : role === "extract"
        ? config.extractModel
        : config.chatModel;
    settings = {
      provider: "OLLAMA_LOCAL",
      model: fallbackModel,
      apiKey: null,
      baseURL: null,
      source: "default",
      userId: settings.userId,
      organizationId: settings.organizationId,
    };
  }

  console.log(`[ai] ${role} provider resolved (${settings.source}): ${settings.provider} / ${settings.model}${settings.apiKey ? " · key=✓" : ""}${settings.baseURL ? ` · baseURL=${settings.baseURL}` : ""}`);

  if (settings.provider === "OLLAMA_LOCAL") {
    const { OllamaChatProvider } = await import("./ollama-chat");
    return { provider: new OllamaChatProvider(config.ollamaHost, settings.model), settings };
  }

  const { CloudChatProvider } = await import("./cloud-chat");
  // Map enum → CloudProvider string expected by CloudChatProvider
  const cloudProvider =
    settings.provider === "AZURE_OPENAI" ? "OPENAI"
    : settings.provider === "BEDROCK" ? "CLAUDE"
    : settings.provider === "VERTEX" ? "GEMINI"
    : settings.provider;
  return {
    provider: new CloudChatProvider(
      cloudProvider as "GEMINI" | "OPENAI" | "CLAUDE" | "VLLM" | "LLAMACPP",
      settings.apiKey ?? "not-required",
      settings.model,
      settings.baseURL ?? undefined,
    ),
    settings,
  };
}

export function getModelInfo(modelId: string) {
  return findModel(modelId);
}
