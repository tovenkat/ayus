/**
 * Vector Store Factory
 *
 * Returns the configured VectorStore or null if VECTOR_DB=none.
 */

import type { VectorStore } from "./types";
import { loadAIConfig } from "./config";

let instance: VectorStore | null | undefined = undefined;
let loadPromise: Promise<VectorStore | null> | null = null;

async function create(): Promise<VectorStore | null> {
  const config = loadAIConfig();

  if (config.vectorDb === "lancedb") {
    const { LanceDBStore } = await import("./lancedb-store");
    return new LanceDBStore(config.lancedbPath);
  }

  if (config.vectorDb === "pgvector") {
    const { PgvectorStore } = await import("./pgvector-store");
    return new PgvectorStore();
  }

  return null;
}

export async function getVectorStore(): Promise<VectorStore | null> {
  if (instance !== undefined) return instance;

  if (!loadPromise) {
    loadPromise = create().then((store) => {
      instance = store;
      return store;
    });
  }

  return loadPromise;
}

export async function disposeVectorStore(): Promise<void> {
  if (instance) {
    await instance.dispose();
    instance = undefined;
    loadPromise = null;
  }
}
