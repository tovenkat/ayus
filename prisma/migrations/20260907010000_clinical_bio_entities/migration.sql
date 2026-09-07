-- AlterTable: GLiNER-BioMed entities extracted from narrative clinical text
ALTER TABLE "ClinicalReport" ADD COLUMN "bio_entities" JSONB;
