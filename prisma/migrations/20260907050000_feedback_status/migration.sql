-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'PLANNED', 'RESOLVED', 'DECLINED');

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "Feedback" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
