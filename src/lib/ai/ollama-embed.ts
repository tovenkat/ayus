/**
 * Ollama Embedding Provider
 *
 * Wraps Ollama HTTP API for text embeddings.
 * Includes retry with exponential backoff.
 */

import type { EmbedProvider } from "./types";
import { ollamaKeepAlive } from "./config";

const EMBED_TIMEOUT = 30_000;
const MAX_RETRIES = 2;

export class OllamaEmbedProvider implements EmbedProvider {
  private baseUrl: string;
  private model: string;
  private dims: number;

  constructor(baseUrl: string, model: string, dims = 768) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.dims = dims;
  }

  async embed(input: string | string[]): Promise<number[][]> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT);

      try {
        const res = await fetch(`${this.baseUrl}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, input, keep_alive: ollamaKeepAlive() }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Ollama embed error (${res.status}): ${body}`);
        }

        const result = await res.json();
        return result.embeddings as number[][];
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  dimensions(): number {
    return this.dims;
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
