-- A code scan (#security-code-scan, 18 Nov): the website scan whose Connect code started it.
-- AlterTable
ALTER TABLE "SecurityCheck" ADD COLUMN "codeScanForId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SecurityCheck_codeScanForId_key" ON "SecurityCheck"("codeScanForId");

-- AddForeignKey
ALTER TABLE "SecurityCheck" ADD CONSTRAINT "SecurityCheck_codeScanForId_fkey" FOREIGN KEY ("codeScanForId") REFERENCES "SecurityCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
