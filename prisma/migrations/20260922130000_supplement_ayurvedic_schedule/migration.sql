-- Supplement Planner + Ayurveda Planner schedules (mirror ExerciseSchedule).

DO $$ BEGIN
  CREATE TYPE "SupplementType" AS ENUM ('VITAMIN','MINERAL','OMEGA','PROBIOTIC','PROTEIN','HERBAL','AMINO','ANTIOXIDANT','OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "SupplementSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "supplementType" "SupplementType" NOT NULL,
  "name" TEXT NOT NULL,
  "dose" TEXT,
  "form" TEXT,
  "timing" TEXT,
  "time" TEXT NOT NULL,
  "daysOfWeek" INTEGER[],
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isFavorite" BOOLEAN NOT NULL DEFAULT false,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplementSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupplementSchedule_userId_active_idx" ON "SupplementSchedule"("userId","active");
DO $$ BEGIN
  ALTER TABLE "SupplementSchedule" ADD CONSTRAINT "SupplementSchedule_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AyurvedicType" AS ENUM ('HERB','FORMULATION','THERAPY','ROUTINE','DIET','YOGA_PRANAYAMA','OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "AyurvedicSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ayurvedicType" "AyurvedicType" NOT NULL,
  "name" TEXT NOT NULL,
  "dosha" TEXT,
  "dose" TEXT,
  "anupana" TEXT,
  "timing" TEXT,
  "time" TEXT NOT NULL,
  "daysOfWeek" INTEGER[],
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isFavorite" BOOLEAN NOT NULL DEFAULT false,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AyurvedicSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AyurvedicSchedule_userId_active_idx" ON "AyurvedicSchedule"("userId","active");
DO $$ BEGIN
  ALTER TABLE "AyurvedicSchedule" ADD CONSTRAINT "AyurvedicSchedule_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
