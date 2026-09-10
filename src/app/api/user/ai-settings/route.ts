import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { findModel, tierAllowsModel } from "@/lib/pricing";

const BodySchema = z.object({
  provider: z.enum(["OLLAMA_LOCAL", "VLLM", "LLAMACPP", "GEMINI", "OPENAI", "CLAUDE", "AZURE_OPENAI", "BEDROCK", "VERTEX"]).nullable(),
  model: z.string().nullable(),
  apiKey: z.string().nullable().optional(), // raw key; empty string clears
  vllmBaseUrl: z.string().nullable().optional(), // vLLM endpoint override; empty string clears
  llamaCppBaseUrl: z.string().nullable().optional(), // llama.cpp endpoint override; empty string clears
  privacyMode: z.boolean(),
  cloudExtractionOptIn: z.boolean().optional(), // also use the cloud provider for extraction
});

const THIRD_PARTY_CLOUD = ["GEMINI", "OPENAI", "CLAUDE", "AZURE_OPENAI", "BEDROCK", "VERTEX"] as const;

/** Cheap liveness check: one tiny completion. Returns null on success, else a message. */
async function validateKey(provider: string, apiKey: string, model: string | null): Promise<string | null> {
  try {
    const { CloudChatProvider } = await import("@/lib/ai/cloud-chat");
    const cloudProvider =
      provider === "AZURE_OPENAI" ? "OPENAI"
      : provider === "BEDROCK" ? "CLAUDE"
      : provider === "VERTEX" ? "GEMINI"
      : provider;
    const { findModel, DEFAULT_MODEL_IDS } = await import("@/lib/pricing");
    const modelId = model ?? DEFAULT_MODEL_IDS[provider as keyof typeof DEFAULT_MODEL_IDS] ?? findModel(model ?? "")?.id ?? "";
    const p = new CloudChatProvider(cloudProvider as "GEMINI" | "OPENAI" | "CLAUDE", apiKey, modelId || undefined);
    await p.chat([{ role: "user", content: "ping" }], { num_predict: 1, temperature: 0 });
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.length > 180 ? msg.slice(0, 180) + "…" : msg;
  }
}

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      aiProvider: true,
      aiModel: true,
      privacyMode: true,
      byokKeyEncrypted: true,
      vllmBaseUrl: true,
      llamaCppBaseUrl: true,
      cloudExtractionOptIn: true,
      orgMemberships: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              type: true,
              defaultAiProvider: true,
              defaultAiModel: true,
              subscription: {
                select: {
                  tier: true,
                  status: true,
                  reportsPerMonth: true,
                  reportsUsed: true,
                  periodEnd: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    aiProvider: user?.aiProvider ?? null,
    aiModel: user?.aiModel ?? null,
    privacyMode: user?.privacyMode ?? false,
    hasByokKey: !!user?.byokKeyEncrypted,
    vllmBaseUrl: user?.vllmBaseUrl ?? null,
    llamaCppBaseUrl: user?.llamaCppBaseUrl ?? null,
    cloudExtractionOptIn: user?.cloudExtractionOptIn ?? false,
    organization: user?.orgMemberships[0]?.organization ?? null,
  });
}

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  // Tier check: model must be allowed for the user's subscription tier.
  // Skipped for OLLAMA_LOCAL, VLLM, LLAMACPP — all self-hosted and use free-text model
  // ids that aren't pre-registered in MODELS.
  if (body.model && body.provider !== "OLLAMA_LOCAL" && body.provider !== "VLLM" && body.provider !== "LLAMACPP") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        orgMemberships: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { organization: { select: { subscription: { select: { tier: true } } } } },
        },
      },
    });
    const tier = user?.orgMemberships[0]?.organization?.subscription?.tier ?? "FREE";
    const model = findModel(body.model);
    if (!model) return NextResponse.json({ error: `Unknown model: ${body.model}` }, { status: 400 });
    if (!tierAllowsModel(tier, body.model)) {
      return NextResponse.json(
        { error: `Model ${body.model} requires ${model.tierMin} tier or higher. You are on ${tier}.` },
        { status: 403 },
      );
    }
  }

  // Validate a newly-entered BYOK key for a third-party cloud provider with one
  // cheap test call, so the user learns immediately if it's wrong instead of on
  // their next upload/chat. (vLLM/llama.cpp/Ollama need no key → skipped.)
  if (body.apiKey && (THIRD_PARTY_CLOUD as readonly string[]).includes(body.provider ?? "")) {
    const problem = await validateKey(body.provider!, body.apiKey, body.model);
    if (problem) {
      return NextResponse.json(
        { error: `That ${body.provider} key didn't work: ${problem}` },
        { status: 400 },
      );
    }
  }

  const encryptedKey =
    body.apiKey === "" ? null : body.apiKey ? encryptSecret(body.apiKey) : undefined;

  const vllmBaseUrl =
    body.vllmBaseUrl === "" ? null : body.vllmBaseUrl ? body.vllmBaseUrl.trim() : undefined;
  const llamaCppBaseUrl =
    body.llamaCppBaseUrl === "" ? null : body.llamaCppBaseUrl ? body.llamaCppBaseUrl.trim() : undefined;

  await prisma.user.update({
    where: { id: userId },
    data: {
      aiProvider: body.provider,
      aiModel: body.model,
      privacyMode: body.privacyMode,
      ...(body.cloudExtractionOptIn !== undefined ? { cloudExtractionOptIn: body.cloudExtractionOptIn } : {}),
      ...(encryptedKey !== undefined ? { byokKeyEncrypted: encryptedKey } : {}),
      ...(vllmBaseUrl !== undefined ? { vllmBaseUrl } : {}),
      ...(llamaCppBaseUrl !== undefined ? { llamaCppBaseUrl } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
