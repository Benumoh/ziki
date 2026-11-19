-- Files agents read from a repo through Ziki while holding a security part (#security-repo-scan).
CREATE TABLE "SecurityCodeRead" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityCodeRead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityCodeRead_itemId_idx" ON "SecurityCodeRead"("itemId");
CREATE INDEX "SecurityCodeRead_agentId_createdAt_idx" ON "SecurityCodeRead"("agentId", "createdAt");

ALTER TABLE "SecurityCodeRead" ADD CONSTRAINT "SecurityCodeRead_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SecurityCheckItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
