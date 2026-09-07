-- Bring DB in sync with the biomarker/organ models already declared in
-- schema.prisma. TestCanonical was created earlier but its dependents
-- (TestSynonym, OrganSystem, OrganSystemTestMap) were never migrated.
--
-- These tables enable organ-view dashboards: rawTestName → TestSynonym →
-- TestCanonical → OrganSystemTestMap → OrganSystem.

CREATE TABLE "TestSynonym" (
  "id"              TEXT PRIMARY KEY,
  "rawName"         TEXT NOT NULL UNIQUE,
  "canonicalTestId" TEXT NOT NULL,
  CONSTRAINT "TestSynonym_canonicalTestId_fkey"
    FOREIGN KEY ("canonicalTestId") REFERENCES "TestCanonical"("id") ON DELETE CASCADE
);

CREATE TABLE "OrganSystem" (
  "id"          TEXT PRIMARY KEY,
  "key"         TEXT NOT NULL UNIQUE,
  "name"        TEXT NOT NULL,
  "icon"        TEXT NOT NULL,
  "svgRegionId" TEXT NOT NULL
);

CREATE TABLE "OrganSystemTestMap" (
  "organSystemId"   TEXT NOT NULL,
  "canonicalTestId" TEXT NOT NULL,
  CONSTRAINT "OrganSystemTestMap_pkey" PRIMARY KEY ("organSystemId", "canonicalTestId"),
  CONSTRAINT "OrganSystemTestMap_organSystemId_fkey"
    FOREIGN KEY ("organSystemId")   REFERENCES "OrganSystem"("id")   ON DELETE CASCADE,
  CONSTRAINT "OrganSystemTestMap_canonicalTestId_fkey"
    FOREIGN KEY ("canonicalTestId") REFERENCES "TestCanonical"("id") ON DELETE CASCADE
);
