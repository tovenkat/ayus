-- LOINC data has legitimate outliers exceeding the original VARCHAR limits:
--  · system: up to 106+ chars (multi-body-region observations)
--  · display_name / consumer_name: up to ~300 chars (verbose lab names)
--
-- Postgres `VARCHAR(N)` gives no perf benefit over `TEXT` — only enforces a
-- length cap. Widen to TEXT so the full LOINC seed loads without truncation.
ALTER TABLE "loinc_terms" ALTER COLUMN "system"        TYPE TEXT;
ALTER TABLE "loinc_terms" ALTER COLUMN "units"         TYPE TEXT;
ALTER TABLE "loinc_terms" ALTER COLUMN "display_name"  TYPE TEXT;
ALTER TABLE "loinc_terms" ALTER COLUMN "consumer_name" TYPE TEXT;
