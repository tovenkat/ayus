-- DietSchedule: presentation metadata + user-state flags
--
-- Additive-only. Applied via raw SQL because the DB carries a hand-managed
-- pgvector table Prisma migrate would try to reset.

ALTER TABLE "DietSchedule"
  ADD COLUMN "image_url"     TEXT,
  ADD COLUMN "cuisine_tags"  TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN "prep_minutes"  INTEGER,
  ADD COLUMN "recipe_url"    TEXT,
  ADD COLUMN "locked"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_favorite"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hidden"        BOOLEAN NOT NULL DEFAULT false;
