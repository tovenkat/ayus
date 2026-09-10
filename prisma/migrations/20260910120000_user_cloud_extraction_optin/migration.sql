-- Per-user opt-in to also use the cloud provider for document extraction.
-- Default false: extraction/OCR stay local (PHI) unless explicitly enabled.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cloudExtractionOptIn" BOOLEAN NOT NULL DEFAULT false;
