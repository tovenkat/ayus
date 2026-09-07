-- Add specimen type to the canonical biomarker registry so a query knows
-- whether "Protein" means the serum test or the urine dipstick without
-- having to peek at the name. Uses LOINC's SYSTEM shorthand values
-- ("Ser/Plas", "Bld", "Ur", "CSF") when possible.
ALTER TABLE "TestCanonical" ADD COLUMN "specimen" VARCHAR(50);
