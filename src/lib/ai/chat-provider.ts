/**
 * Chat Provider Factory — async singletons for chat and embedding.
 */

import type { ChatProvider } from "./types";
import { loadAIConfig } from "./config";

let cloudInstance: ChatProvider | null = null;
let cloudPromise: Promise<ChatProvider> | null = null;

async function getCloudProvider(): Promise<ChatProvider> {
  if (cloudInstance) return cloudInstance;
  if (!cloudPromise) {
    cloudPromise = (async () => {
      const config = loadAIConfig();
      if (!config.internetLlm || !config.internetLlmApiKey) {
        throw new Error("[cloud] INTERNET_LLM requires a valid provider and API key");
      }
      const { CloudChatProvider } = await import("./cloud-chat");
      const provider = new CloudChatProvider(
        config.internetLlm,
        config.internetLlmApiKey,
        config.internetLlmModel ?? undefined
      );
      cloudInstance = provider;
      return provider;
    })();
  }
  return cloudPromise;
}

type Role = "chat" | "extract" | "ocr";
const roleInstances = new Map<Role, ChatProvider>();
const rolePromises = new Map<Role, Promise<ChatProvider>>();

function modelForRole(role: Role): string {
  const config = loadAIConfig();
  if (role === "ocr") return config.ocrModel ?? config.extractModel;
  if (role === "extract") return config.extractModel;
  return config.chatModel;
}

async function createProviderForRole(role: Role): Promise<ChatProvider> {
  const config = loadAIConfig();
  if (config.internetLlm) return getCloudProvider();
  if (config.useOllama) {
    const { OllamaChatProvider } = await import("./ollama-chat");
    return new OllamaChatProvider(config.ollamaHost, modelForRole(role));
  }
  throw new Error("No AI provider configured. Set INTERNET_LLM or OLLAMA_HOST in .env");
}

function getProviderForRole(role: Role): Promise<ChatProvider> {
  const existing = roleInstances.get(role);
  if (existing) return Promise.resolve(existing);
  let pending = rolePromises.get(role);
  if (!pending) {
    pending = createProviderForRole(role).then((p) => {
      roleInstances.set(role, p);
      return p;
    });
    rolePromises.set(role, pending);
  }
  return pending;
}

export async function getChatProvider(): Promise<ChatProvider> {
  return getProviderForRole("chat");
}

export async function getExtractProvider(): Promise<ChatProvider> {
  return getProviderForRole("extract");
}

export async function getOcrProvider(): Promise<ChatProvider> {
  return getProviderForRole("ocr");
}

export async function preloadExtractModel(): Promise<void> {
  try {
    const provider = await getExtractProvider();
    if (provider.preload) await provider.preload();
  } catch {}
}

export async function disposeChatProvider(): Promise<void> {
  for (const [, instance] of roleInstances) {
    await instance.dispose();
  }
  roleInstances.clear();
  rolePromises.clear();
}

export async function disposeCloudProvider(): Promise<void> {
  if (cloudInstance) { await cloudInstance.dispose(); cloudInstance = null; cloudPromise = null; }
}
