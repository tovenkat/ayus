/**
 * Cloud Chat Provider
 *
 * Implements ChatProvider for cloud LLM APIs (Gemini, OpenAI, Claude) and for
 * self-hosted OpenAI-compatible endpoints (vLLM). Uses official SDKs with lazy
 * dynamic imports so only the configured provider's SDK is loaded at runtime.
 */

import type { ChatProvider, ChatMessage, ChatOptions, ChatResponse, DocumentBlock, ExtractionOptions } from "./types";
import type { CloudProvider } from "./config";

const DEFAULT_MODELS: Record<CloudProvider, string> = {
  GEMINI: "gemini-2.5-flash",
  OPENAI: "gpt-4o-mini",
  CLAUDE: "claude-sonnet-4-20250514",
  VLLM: "vllm-model",            // placeholder — real model id must be supplied by the caller
  LLAMACPP: "llamacpp-model",    // placeholder — llama-server accepts any id when only one model is loaded
};

const MAX_RETRIES = 4;
const BASE_DELAY = 800; // ms; exponential backoff with jitter (≈0.8s→6.4s)

/**
 * Is this error worth retrying? Retry rate-limits (429) and server/overload
 * errors (5xx incl. 503 "high demand" on preview models), plus transient
 * network faults. The Gemini/OpenAI/Anthropic SDKs sometimes surface a numeric
 * `.status`, sometimes only a message — check both.
 */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b(429|5\d\d)\b|unavailable|overloaded|high demand|rate limit|resource exhausted|timeout|timed out|econnreset|etimedout|fetch failed|socket hang up/.test(msg);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type ImageMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Detect MIME type from base64 magic bytes. */
function guessMimeType(base64: string): ImageMimeType {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("R0lGO")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

async function withRetry<T>(fn: () => Promise<T>, label = "cloud"): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isTransient(err)) throw err;
      // Exponential backoff with jitter so retries don't thundering-herd a
      // model that's already under load.
      const delay = Math.round(BASE_DELAY * 2 ** attempt * (0.75 + Math.random() * 0.5));
      console.warn(`[${label}] transient error — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms:`, err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ── Gemini adapter ───────────────────────────────────────────────────────────

async function geminiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<ChatResponse> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemMessages.length
      ? systemMessages.map((m) => m.content).join("\n\n")
      : undefined,
    generationConfig: {
      temperature: options?.temperature ?? undefined,
      maxOutputTokens: 65536,
      ...(options?.format === "json" ? { responseMimeType: "application/json" } : {}),
    },
  });

  const contents = nonSystem.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [
      { text: m.content },
      ...(m.images ?? []).map((img) => ({
        inlineData: { mimeType: guessMimeType(img), data: img },
      })),
    ],
  }));

  const result = await withRetry(() => genModel.generateContent({ contents }));
  const text = result.response.text();
  return { content: text, done: true };
}

async function* geminiStream(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions
): AsyncGenerator<string, void, unknown> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemMessages.length
      ? systemMessages.map((m) => m.content).join("\n\n")
      : undefined,
    generationConfig: {
      temperature: options?.temperature ?? undefined,
      maxOutputTokens: 65536,
      ...(options?.format === "json" ? { responseMimeType: "application/json" } : {}),
    },
  });

  const contents = nonSystem.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [
      { text: m.content },
      ...(m.images ?? []).map((img) => ({
        inlineData: { mimeType: guessMimeType(img), data: img },
      })),
    ],
  }));

  // Retry the connection/first-token step (where 503s land); once tokens are
  // streaming we don't retry, to avoid re-emitting partial output.
  const result = await withRetry(() => genModel.generateContentStream({ contents }), "gemini-stream");
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

// ── OpenAI adapter ───────────────────────────────────────────────────────────

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function toOpenAIMessages(messages: ChatMessage[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return messages.map((m): any => {
    if (!m.images?.length) {
      return { role: m.role, content: m.content };
    }
    const parts: OpenAIContentPart[] = [
      { type: "text" as const, text: m.content },
      ...m.images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: `data:${guessMimeType(img)};base64,${img}` },
      })),
    ];
    return { role: m.role, content: parts };
  });
}

async function openaiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions,
  baseURL?: string,
): Promise<ChatResponse> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL });

  const result = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages: toOpenAIMessages(messages),
      temperature: options?.temperature ?? undefined,
      ...(options?.format === "json" ? { response_format: { type: "json_object" as const } } : {}),
    })
  );

  return { content: result.choices[0]?.message?.content ?? "", done: true };
}

async function* openaiStream(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions,
  baseURL?: string,
): AsyncGenerator<string, void, unknown> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL });

  const stream = await client.chat.completions.create({
    model,
    messages: toOpenAIMessages(messages),
    temperature: options?.temperature ?? undefined,
    ...(options?.format === "json" ? { response_format: { type: "json_object" as const } } : {}),
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

// ── Claude adapter ───────────────────────────────────────────────────────────

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageMimeType; data: string } };

function toClaudeMessages(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const formatted = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (!m.images?.length) {
        return { role: m.role as "user" | "assistant", content: m.content };
      }
      const blocks: ClaudeContentBlock[] = [
        ...m.images.map((img) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: guessMimeType(img),
            data: img,
          },
        })),
        { type: "text" as const, text: m.content },
      ];
      return { role: m.role as "user" | "assistant", content: blocks };
    });

  return { system: system || undefined, messages: formatted };
}

async function claudeChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<ChatResponse> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const { system, messages: formatted } = toClaudeMessages(messages);

  // Use streaming to avoid 10-minute timeout on long requests. Retry the whole
  // request on transient errors (the reviewer pass depends on this call).
  const response = await withRetry(() =>
    client.messages
      .stream({
        model,
        max_tokens: 32768,
        temperature: options?.temperature ?? undefined,
        system,
        messages: formatted,
      })
      .finalMessage(),
    "claude",
  );

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return { content: text, done: true };
}

async function* claudeStream(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions
): AsyncGenerator<string, void, unknown> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const { system, messages: formatted } = toClaudeMessages(messages);

  const stream = client.messages.stream({
    model,
    max_tokens: 32768,
    temperature: options?.temperature ?? undefined,
    system,
    messages: formatted,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

// ── Claude structured extraction (tool_use + document blocks) ───────────────

async function claudeExtract(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  documents: DocumentBlock[],
  options: ExtractionOptions
): Promise<ChatResponse> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  // Build user content blocks: documents first, then text instruction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = [];

  for (const doc of documents) {
    if (doc.mediaType === "application/pdf") {
      // Native PDF document block — Claude reads the PDF directly
      contentBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: doc.data,
        },
        title: doc.title ?? "Lab Report",
      });
    } else if (doc.mediaType.startsWith("image/")) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: doc.mediaType as ImageMimeType,
          data: doc.data,
        },
      });
    }
  }

  contentBlocks.push({ type: "text", text: userContent });

  const toolName = options.schemaName ?? "extract_lab_report";

  // Use streaming to avoid 10-minute timeout on long requests
  const stream = client.messages.stream({
    model,
    max_tokens: 32768,
    temperature: options.temperature ?? 0,
    system: systemPrompt,
    messages: [{ role: "user", content: contentBlocks }],
    tools: [
      {
        name: toolName,
        description: "Extract structured lab report data from the provided document.",
        input_schema: options.schema as { type: "object"; [k: string]: unknown },
      },
    ],
    tool_choice: { type: "tool" as const, name: toolName },
  });

  const result = await stream.finalMessage();

  // Extract the tool_use block — with tool_choice forcing a specific tool,
  // the response always contains exactly one tool_use block
  const toolBlock = result.content.find((b) => b.type === "tool_use");
  if (toolBlock && toolBlock.type === "tool_use") {
    // toolBlock.input is already a parsed JSON object
    return { content: JSON.stringify(toolBlock.input), done: true };
  }

  // Fallback: if somehow no tool_use block, try text blocks
  const text = result.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  return { content: text, done: true };
}

// ── CloudChatProvider ────────────────────────────────────────────────────────

export class CloudChatProvider implements ChatProvider {
  private provider: CloudProvider;
  private model: string;
  private apiKey: string;
  private baseURL: string | undefined;

  constructor(provider: CloudProvider, apiKey: string, model?: string, baseURL?: string) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model ?? DEFAULT_MODELS[provider];
    this.baseURL = baseURL;
    console.log(
      `[cloud] Initialized ${provider} provider (model: ${this.model}${baseURL ? `, baseURL: ${baseURL}` : ""})`,
    );
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    switch (this.provider) {
      case "GEMINI":
        return geminiChat(this.apiKey, this.model, messages, options);
      case "OPENAI":
        return openaiChat(this.apiKey, this.model, messages, options);
      case "CLAUDE":
        return claudeChat(this.apiKey, this.model, messages, options);
      case "VLLM":
        // vLLM speaks the OpenAI protocol — reuse the openai adapter with a custom baseURL.
        return openaiChat(this.apiKey, this.model, messages, options, this.baseURL);
      case "LLAMACPP":
        // llama.cpp's `llama-server` is also OpenAI-compatible — same code path.
        return openaiChat(this.apiKey, this.model, messages, options, this.baseURL);
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    switch (this.provider) {
      case "GEMINI":
        yield* geminiStream(this.apiKey, this.model, messages, options);
        break;
      case "OPENAI":
        yield* openaiStream(this.apiKey, this.model, messages, options);
        break;
      case "CLAUDE":
        yield* claudeStream(this.apiKey, this.model, messages, options);
        break;
      case "VLLM":
        yield* openaiStream(this.apiKey, this.model, messages, options, this.baseURL);
        break;
      case "LLAMACPP":
        yield* openaiStream(this.apiKey, this.model, messages, options, this.baseURL);
        break;
    }
  }

  async extract(
    systemPrompt: string,
    userContent: string,
    documents: DocumentBlock[],
    options: ExtractionOptions
  ): Promise<ChatResponse> {
    // Only Claude gets the native tool_use + document blocks path
    if (this.provider === "CLAUDE") {
      return claudeExtract(
        this.apiKey,
        this.model,
        systemPrompt,
        userContent,
        documents,
        options
      );
    }

    // For OpenAI/Gemini: convert documents to text/images and use chat()
    const images = documents
      .filter((d) => d.mediaType.startsWith("image/"))
      .map((d) => d.data);

    return this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent, ...(images.length > 0 ? { images } : {}) },
      ],
      { format: "json", temperature: options.temperature ?? 0 }
    );
  }

  async dispose(): Promise<void> {
    // Cloud clients are stateless HTTP — nothing to dispose
  }
}
