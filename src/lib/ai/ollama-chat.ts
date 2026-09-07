/**
 * Ollama Chat Provider
 *
 * Wraps Ollama HTTP API for both non-streaming and streaming chat.
 * Includes retry with exponential backoff.
 */

import type { ChatProvider, ChatMessage, ChatOptions, ChatResponse } from "./types";

const CHAT_TIMEOUT = 600_000; // 10 minutes for large extraction jobs
const MAX_RETRIES = 2;

export class OllamaChatProvider implements ChatProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT);

      try {
        const body: Record<string, unknown> = {
          model: this.model,
          messages,
          stream: false,
          keep_alive: "10m",
        };
        if (options?.format) body.format = options.format;
        const ollamaOpts: Record<string, unknown> = {};
        if (options?.temperature !== undefined) ollamaOpts.temperature = options.temperature;
        if (options?.num_ctx !== undefined) ollamaOpts.num_ctx = options.num_ctx;
        if (Object.keys(ollamaOpts).length > 0) body.options = ollamaOpts;

        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Ollama chat error (${res.status}): ${errBody}`);
        }

        const result = await res.json();
        return {
          content: result.message?.content ?? "",
          done: result.done ?? true,
        };
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  /**
   * Send a lightweight request to load the model into Ollama's memory.
   * Resolves once the model is loaded (Ollama returns immediately for
   * already-loaded models).
   */
  async preload(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: "hi" }],
          stream: false,
          keep_alive: "10m",
          options: { num_predict: 1 },
        }),
      });
      if (!res.ok) {
        console.warn(`[ollama] preload ${this.model}: ${res.status}`);
      }
    } catch (err) {
      console.warn(`[ollama] preload ${this.model} failed:`, err instanceof Error ? err.message : err);
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      keep_alive: "10m",
    };
    if (options?.format) body.format = options.format;
    const ollamaOpts: Record<string, unknown> = {};
    if (options?.temperature !== undefined) ollamaOpts.temperature = options.temperature;
    if (options?.num_ctx !== undefined) ollamaOpts.num_ctx = options.num_ctx;
    if (Object.keys(ollamaOpts).length > 0) body.options = ollamaOpts;

    // Use timeout only for the initial connection (prompt processing can be slow
    // for large contexts). Once streaming starts, clear it — tokens flow steadily.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }

    // Response headers received — clear the connection timeout.
    // From here on, Ollama streams tokens; no global timeout needed.
    clearTimeout(timeout);

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "Unknown error");
      throw new Error(`Ollama stream error: ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            const token = chunk.message?.content ?? "";
            if (token) yield token;
          } catch {
            // Skip unparseable NDJSON lines
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer);
          const token = chunk.message?.content ?? "";
          if (token) yield token;
        } catch {
          // Ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async dispose(): Promise<void> {
    // No resources to release for HTTP client
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }
}
