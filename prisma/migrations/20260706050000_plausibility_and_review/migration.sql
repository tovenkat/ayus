-- Deterministic plausibility validation + review gating.
-- Adds per-canonical numeric bounds + expected unit, per-result plausibility
-- flag + warnings, and a review flag on Report.

ALTER TABLE "TestCanonical"
  ADD COLUMN "minValue"     DOUBLE PRECISION,
  ADD COLUMN "maxValue"     DOUBLE PRECISION,
  ADD COLUMN "expectedUnit" VARCHAR(50);

ALTER TABLE "TestResult"
  ADD COLUMN "plausibilityFlag" VARCHAR(30),
  ADD COLUMN "warnings"         TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "Report"
  ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT FALSE;

-- Query pattern: "which of a user's reports need review?"
CREATE INDEX "Report_userId_needsReview_idx"
  ON "Report" ("userId", "needsReview");
