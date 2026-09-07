/**
 * Embed Provider Factory
 *
 * Async singleton that returns the appropriate EmbedProvider
 * based on environment configuration.
 */

import type { EmbedProvider } from "./types";
import { loadAIConfig } from "./config";

let instance: EmbedProvider | null = null;
let loadPromise: Promise<EmbedProvider> | null = null;

async function create(): Promise<EmbedProvider> {
  const config = loadAIConfig();

  if (config.useOllama) {
    const { OllamaEmbedProvider } = await import("./ollama-embed");
    return new OllamaEmbedProvider(config.ollamaHost, config.embedModel);
  }

  const { LocalEmbedProvider } = await import("./local-embed");
  return new LocalEmbedProvider(config.embedModelDir);
}

export async function getEmbedProvider(): Promise<EmbedProvider> {
  if (instance) return instance;

  if (!loadPromise) {
    loadPromise = create().then((provider) => {
      instance = provider;
      return provider;
    });
  }

  return loadPromise;
}

export async function disposeEmbedProvider(): Promise<void> {
  if (instance) {
    await instance.dispose();
    instance = null;
    loadPromise = null;
  }
}
