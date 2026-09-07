-- LOINC reference table. Population comes from the LOINC download
-- (https://loinc.org/downloads/) — a seed script is a separate task.
CREATE TABLE "loinc_terms" (
  "loinc_num"     TEXT PRIMARY KEY,
  "name"          TEXT,
  "component"     TEXT,
  "system"        VARCHAR(100),
  "units"         VARCHAR(100),
  "display_name"  VARCHAR(255),
  "consumer_name" VARCHAR(255)
);
