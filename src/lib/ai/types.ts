/**
 * AI Provider Interfaces
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

export type ChatOptions = {
  format?: "json";
  temperature?: number;
  num_ctx?: number;
  [key: string]: unknown;
};

export type ChatResponse = {
  content: string;
  done: boolean;
};

export type DocumentBlock = {
  data: string;
  mediaType: string;
  title?: string;
};

export type ExtractionOptions = {
  temperature?: number;
  schema: Record<string, unknown>;
  schemaName?: string;
};

export interface ChatProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
  preload?(): Promise<void>;
  extract?(
    systemPrompt: string,
    userContent: string,
    documents: DocumentBlock[],
    options: ExtractionOptions
  ): Promise<ChatResponse>;
  dispose(): Promise<void>;
}

export interface EmbedProvider {
  embed(input: string | string[]): Promise<number[][]>;
  dimensions(): number;
  dispose(): Promise<void>;
}

export type VectorRow = {
  id: string;
  vector: number[];
  text: string;
  metadata: Record<string, unknown>;
};

export type VectorSearchResult = {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
};

export interface VectorStore {
  upsert(table: string, rows: VectorRow[]): Promise<void>;
  search(table: string, queryVector: number[], limit: number): Promise<VectorSearchResult[]>;
  delete(table: string, ids: string[]): Promise<void>;
  dispose(): Promise<void>;
}
