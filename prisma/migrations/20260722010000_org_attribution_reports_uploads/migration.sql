-- AlterTable: Upload gains org attribution for upload-on-behalf-of
ALTER TABLE "Upload" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Upload" ADD COLUMN "uploadedById" TEXT;

-- AlterTable: Report gains org attribution (scopes lab dashboard views)
ALTER TABLE "Report" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "Upload_organizationId_createdAt_idx" ON "Upload"("organizationId", "createdAt");
CREATE INDEX "Report_organizationId_createdAt_idx" ON "Report"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
