-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARN', 'URGENT');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'SEEN', 'DISMISSED');

-- CreateTable
CREATE TABLE "BiomarkerAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "testResultId" TEXT,
    "normalizedName" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARN',
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "observedValue" TEXT,
    "previousValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "BiomarkerAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BiomarkerAlert_userId_status_createdAt_idx" ON "BiomarkerAlert"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BiomarkerAlert_userId_normalizedName_idx" ON "BiomarkerAlert"("userId", "normalizedName");
