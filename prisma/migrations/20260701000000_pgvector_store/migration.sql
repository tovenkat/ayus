-- Enable the pgvector extension. Requires `brew install pgvector` (or the
-- distro equivalent) at the OS level before this migration will succeed.
CREATE EXTENSION IF NOT EXISTS vector;

-- Vector storage table. Kept out of the Prisma model layer because Prisma
-- doesn't type-check vector operations; all access goes via $queryRaw /
-- $executeRaw from src/lib/ai/pgvector-store.ts.
--
-- Embedding dimension is 768 (nomic-embed-text via Ollama, the default in
-- src/lib/ai/ollama-embed.ts). If you switch embed models, drop and recreate
-- this table with the new dimension.
CREATE TABLE "VectorEntry" (
  "id"        TEXT PRIMARY KEY,
  "namespace" TEXT NOT NULL,
  "text"      TEXT NOT NULL,
  "metadata"  JSONB NOT NULL DEFAULT '{}'::jsonb,
  "embedding" vector(768) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "VectorEntry_namespace_idx" ON "VectorEntry" ("namespace");

-- HNSW index for cosine-similarity search (matches the search() operator `<=>`
-- with vector_cosine_ops). Built at CREATE-time when the table is empty; will
-- be maintained incrementally as rows are upserted.
CREATE INDEX "VectorEntry_embedding_idx"
  ON "VectorEntry"
  USING hnsw ("embedding" vector_cosine_ops);
