-- Backfill columns that were added to TestCanonical in schema.prisma during
-- an earlier session but never migrated. All nullable — no data risk.

ALTER TABLE "TestCanonical" ADD COLUMN "test_purpose"        TEXT;
ALTER TABLE "TestCanonical" ADD COLUMN "high_interpretation" TEXT;
ALTER TABLE "TestCanonical" ADD COLUMN "low_interpretation"  TEXT;
ALTER TABLE "TestCanonical" ADD COLUMN "clinical_use"        TEXT;
ALTER TABLE "TestCanonical" ADD COLUMN "related_diseases"    TEXT;
