import type { EmbedProvider } from "./types";

export class LocalEmbedProvider implements EmbedProvider {
  constructor(_modelDir: string) {
    throw new Error("Local ONNX embeddings are not supported in phr2. Use INTERNET_LLM or Ollama.");
  }

  async embed(_input: string | string[]): Promise<number[][]> {
    throw new Error("Not implemented");
  }

  dimensions(): number {
    return 0;
  }

  async dispose(): Promise<void> {}
}
