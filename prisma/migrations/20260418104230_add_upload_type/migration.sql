-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('LAB_REPORT', 'PRESCRIPTION', 'DISCHARGE_SUMMARY', 'DOCTOR_NOTE', 'HEALTH_NOTE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'WIKI_GENERATE';
ALTER TYPE "JobType" ADD VALUE 'LINT';

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "uploadType" "UploadType" NOT NULL DEFAULT 'OTHER';
