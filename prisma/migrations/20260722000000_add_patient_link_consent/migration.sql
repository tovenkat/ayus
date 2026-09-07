-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'REVOKED');

-- CreateTable
CREATE TABLE "PatientLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "PatientLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientLink_organizationId_patientId_key" ON "PatientLink"("organizationId", "patientId");

-- CreateIndex
CREATE INDEX "PatientLink_patientId_status_idx" ON "PatientLink"("patientId", "status");

-- CreateIndex
CREATE INDEX "PatientLink_organizationId_status_idx" ON "PatientLink"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "PatientLink" ADD CONSTRAINT "PatientLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLink" ADD CONSTRAINT "PatientLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
