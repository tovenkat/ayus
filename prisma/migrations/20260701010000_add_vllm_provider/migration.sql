-- Add VLLM as a first-class AiProvider. Positioned after OLLAMA_LOCAL to keep
-- the two self-hosted options adjacent when displayed.
ALTER TYPE "AiProvider" ADD VALUE IF NOT EXISTS 'VLLM';

-- Per-user vLLM endpoint override. Falls back to VLLM_BASE_URL env var when null.
ALTER TABLE "User" ADD COLUMN "vllmBaseUrl" TEXT;
