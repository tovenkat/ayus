-- AlterTable: org attribution for consults recorded on-behalf-of a patient
ALTER TABLE "DoctorNote" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "DoctorNote" ADD COLUMN "recordedById" TEXT;
CREATE INDEX "DoctorNote_organizationId_visitDate_idx" ON "DoctorNote"("organizationId", "visitDate");
ALTER TABLE "DoctorNote" ADD CONSTRAINT "DoctorNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
