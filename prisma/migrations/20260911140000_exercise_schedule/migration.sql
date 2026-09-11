-- Exercise Planner: weekly workout schedule (mirrors DietSchedule).
DO $$ BEGIN
  CREATE TYPE "ExerciseType" AS ENUM ('CARDIO','STRENGTH','FLEXIBILITY','BALANCE','YOGA','WALK','SPORT','REST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "ExerciseSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "exerciseType" "ExerciseType" NOT NULL,
  "name" TEXT NOT NULL,
  "time" TEXT NOT NULL,
  "durationMin" INTEGER,
  "intensity" TEXT,
  "targetAreas" TEXT[],
  "daysOfWeek" INTEGER[],
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isFavorite" BOOLEAN NOT NULL DEFAULT false,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExerciseSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ExerciseSchedule_userId_active_idx" ON "ExerciseSchedule"("userId","active");
DO $$ BEGIN
  ALTER TABLE "ExerciseSchedule" ADD CONSTRAINT "ExerciseSchedule_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
