-- AlterTable: denormalized LOINC code on each result (copied from canonical at ingestion)
ALTER TABLE "TestResult" ADD COLUMN "loinc_num" TEXT;

-- CreateIndex: lets exports/filters find LOINC-coded results fast
CREATE INDEX "TestResult_loinc_num_idx" ON "TestResult"("loinc_num");
