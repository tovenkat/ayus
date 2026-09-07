import type { ChatProvider, ChatMessage, ChatOptions, ChatResponse } from "./types";

export class LocalChatProvider implements ChatProvider {
  constructor(_modelPath: string) {
    throw new Error("Local GGUF models are not supported in phr2. Use INTERNET_LLM or Ollama.");
  }

  async chat(_messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    throw new Error("Not implemented");
  }

  async *chatStream(_messages: ChatMessage[], _options?: ChatOptions): AsyncGenerator<string> {
    throw new Error("Not implemented");
  }

  async dispose(): Promise<void> {}
}
