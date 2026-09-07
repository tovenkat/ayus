-- Connect the canonical biomarker registry to LOINC. TestCanonical carries the
-- stable identifier; TestResult reaches LOINC via TestCanonical to avoid
-- denormalizing the code onto every result row.
ALTER TABLE "TestCanonical" ADD COLUMN "loinc_num" TEXT;

ALTER TABLE "TestCanonical"
  ADD CONSTRAINT "TestCanonical_loinc_num_fkey"
  FOREIGN KEY ("loinc_num") REFERENCES "loinc_terms"("loinc_num") ON DELETE SET NULL;

CREATE INDEX "TestCanonical_loinc_num_idx" ON "TestCanonical" ("loinc_num");
