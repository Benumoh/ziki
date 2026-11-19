-- CreateEnum
CREATE TYPE "HumanApprovalDecision" AS ENUM ('approved', 'rejected');

-- AlterTable
ALTER TABLE "Bug" ADD COLUMN     "humanApprovalReason" TEXT,
ADD COLUMN     "requiresHumanApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "humanApprovalReason" TEXT,
ADD COLUMN     "requiresHumanApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "humanApprovalGuidelines" TEXT;

-- AlterTable
ALTER TABLE "ProjectWorkflow" ADD COLUMN     "humanApprovalsNeeded" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "HumanApproval" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT,
    "bugId" TEXT,
    "userId" TEXT NOT NULL,
    "decision" "HumanApprovalDecision" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HumanApproval_ideaId_idx" ON "HumanApproval"("ideaId");

-- CreateIndex
CREATE INDEX "HumanApproval_bugId_idx" ON "HumanApproval"("bugId");

-- CreateIndex
CREATE INDEX "HumanApproval_userId_idx" ON "HumanApproval"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HumanApproval_ideaId_userId_key" ON "HumanApproval"("ideaId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "HumanApproval_bugId_userId_key" ON "HumanApproval"("bugId", "userId");

-- AddForeignKey
ALTER TABLE "HumanApproval" ADD CONSTRAINT "HumanApproval_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanApproval" ADD CONSTRAINT "HumanApproval_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanApproval" ADD CONSTRAINT "HumanApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
