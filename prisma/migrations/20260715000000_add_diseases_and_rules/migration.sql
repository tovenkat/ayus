-- Diseases + Rules
--
-- Reference tables for disease vocabulary (ICD-10-anchored) and threshold-based
-- biomarker rules. `rules.disclaimer` has a NOT NULL default so a rule row can
-- never be inserted without a physician-consultation warning; app code that
-- surfaces rule matches to end users MUST render this text alongside the flag.
--
-- Applied via raw SQL (not `prisma migrate dev`) because the local DB carries
-- a hand-managed pgvector `VectorEntry` table that `prisma migrate` would
-- try to reset. This migration is additive-only.

-- ─── Enums ──────────────────────────────────────────────────────────────
CREATE TYPE "RuleOperator" AS ENUM ('GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'OUTSIDE_RANGE');
CREATE TYPE "RuleSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- ─── Diseases ───────────────────────────────────────────────────────────
CREATE TABLE "diseases" (
  "id"               TEXT        NOT NULL,
  "icd10_code"       TEXT,
  "icd10_name"       TEXT,
  "common_name"      TEXT        NOT NULL,
  "category"         TEXT,
  "description"      TEXT,
  "organ_system_id"  TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "diseases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diseases_icd10_code_key" ON "diseases"("icd10_code");
CREATE INDEX "diseases_category_idx" ON "diseases"("category");
CREATE INDEX "diseases_organ_system_id_idx" ON "diseases"("organ_system_id");

ALTER TABLE "diseases"
  ADD CONSTRAINT "diseases_organ_system_id_fkey"
  FOREIGN KEY ("organ_system_id") REFERENCES "OrganSystem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Rules ──────────────────────────────────────────────────────────────
CREATE TABLE "rules" (
  "id"                  TEXT           NOT NULL,
  "name"                TEXT           NOT NULL,
  "description"         TEXT,
  "canonical_test_id"   TEXT           NOT NULL,
  "operator"            "RuleOperator" NOT NULL,
  "threshold_low"       DOUBLE PRECISION,
  "threshold_high"      DOUBLE PRECISION,
  "unit"                VARCHAR(50),
  "severity"            "RuleSeverity" NOT NULL,
  "suggestion"          TEXT           NOT NULL,
  "disclaimer"          TEXT           NOT NULL DEFAULT 'This is informational only. Not a medical diagnosis. Consult a qualified physician before acting on this result.',
  "disease_id"          TEXT,
  "source"              TEXT,
  "source_url"          TEXT,
  "is_active"           BOOLEAN        NOT NULL DEFAULT true,
  "created_at"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)   NOT NULL,
  CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rules_canonical_test_id_is_active_idx" ON "rules"("canonical_test_id", "is_active");
CREATE INDEX "rules_disease_id_idx" ON "rules"("disease_id");

ALTER TABLE "rules"
  ADD CONSTRAINT "rules_canonical_test_id_fkey"
  FOREIGN KEY ("canonical_test_id") REFERENCES "TestCanonical"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rules"
  ADD CONSTRAINT "rules_disease_id_fkey"
  FOREIGN KEY ("disease_id") REFERENCES "diseases"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
