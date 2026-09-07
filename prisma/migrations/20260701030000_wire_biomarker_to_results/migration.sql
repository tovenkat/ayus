-- Step 1 (results ↔ canonical): link TestResult rows to TestCanonical so organ
-- grouping and per-biomarker trend queries work.
ALTER TABLE "TestResult" ADD COLUMN "canonicalTestId" TEXT;

ALTER TABLE "TestResult"
  ADD CONSTRAINT "TestResult_canonicalTestId_fkey"
  FOREIGN KEY ("canonicalTestId") REFERENCES "TestCanonical"("id") ON DELETE SET NULL;

CREATE INDEX "TestResult_canonicalTestId_createdAt_idx"
  ON "TestResult" ("canonicalTestId", "createdAt");

-- Step 3 (unresolved-name logging): dead-letter table for rawNames that the
-- resolver could not match. Review with `npm run biomarkers:unresolved`.
CREATE TABLE "UnresolvedTestName" (
  "id"                 TEXT PRIMARY KEY,
  "rawName"            TEXT NOT NULL UNIQUE,
  "normalizedForm"     TEXT NOT NULL,
  "seenCount"          INTEGER NOT NULL DEFAULT 1,
  "lastSampleUserId"   TEXT,
  "lastSampleReportId" TEXT,
  "status"             TEXT NOT NULL DEFAULT 'PENDING',
  "firstSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "UnresolvedTestName_status_seenCount_idx"
  ON "UnresolvedTestName" ("status", "seenCount");

CREATE INDEX "UnresolvedTestName_normalizedForm_idx"
  ON "UnresolvedTestName" ("normalizedForm");
