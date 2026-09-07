-- CreateEnum
CREATE TYPE "DateSource" AS ENUM ('SAMPLE_COLLECTED', 'REPORT_DATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ValueOperator" AS ENUM ('LT', 'GT', 'EQ', 'APPROX');

-- CreateEnum
CREATE TYPE "Interpretation" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'EXTRACT';

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "sampleCollectedOn" TIMESTAMP(3),
    "dateSource" "DateSource" NOT NULL DEFAULT 'UNKNOWN',
    "referredBy" TEXT,
    "sampleType" TEXT,
    "rawJson" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rawTestName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "observedValueRaw" TEXT NOT NULL,
    "observedValueNumeric" DOUBLE PRECISION,
    "observedValueOperator" "ValueOperator",
    "observedValueUnit" TEXT,
    "referenceIntervalRaw" TEXT,
    "referenceLow" DOUBLE PRECISION,
    "referenceHigh" DOUBLE PRECISION,
    "referenceUnit" TEXT,
    "interpretation" "Interpretation" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION NOT NULL,
    "isOutOfRange" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCanonical" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,

    CONSTRAINT "TestCanonical_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_uploadId_key" ON "Report"("uploadId");

-- CreateIndex
CREATE INDEX "Report_userId_sampleCollectedOn_idx" ON "Report"("userId", "sampleCollectedOn");

-- CreateIndex
CREATE INDEX "TestResult_userId_normalizedName_createdAt_idx" ON "TestResult"("userId", "normalizedName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestCanonical_name_key" ON "TestCanonical"("name");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
