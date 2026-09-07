-- llama.cpp's built-in `llama-server` binary exposes an OpenAI-compatible HTTP
-- endpoint. This migration mirrors the vLLM slot: a first-class AiProvider
-- value + a per-user base URL override.

ALTER TYPE "AiProvider" ADD VALUE IF NOT EXISTS 'LLAMACPP';

-- Per-user llama.cpp endpoint override. Falls back to LLAMACPP_BASE_URL env when null.
ALTER TABLE "User" ADD COLUMN "llamaCppBaseUrl" TEXT;
