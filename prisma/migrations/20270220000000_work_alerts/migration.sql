-- CreateTable
CREATE TABLE "WorkAlert" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'rise',
    "status" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "pingedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "asks" INTEGER NOT NULL DEFAULT 0,
    "lastAskedAt" TIMESTAMP(3),
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lapsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkAlertItem" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "heldUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkAlertItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkAlert_projectId_endedAt_idx" ON "WorkAlert"("projectId", "endedAt");

-- CreateIndex
CREATE INDEX "WorkAlert_agentId_endedAt_idx" ON "WorkAlert"("agentId", "endedAt");

-- CreateIndex
CREATE INDEX "WorkAlert_agentId_lapsedAt_idx" ON "WorkAlert"("agentId", "lapsedAt");

-- CreateIndex
CREATE INDEX "WorkAlertItem_projectId_heldUntil_idx" ON "WorkAlertItem"("projectId", "heldUntil");

-- CreateIndex
CREATE INDEX "WorkAlertItem_organisationId_agentId_createdAt_idx" ON "WorkAlertItem"("organisationId", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkAlertItem_alertId_idx" ON "WorkAlertItem"("alertId");

-- CreateIndex
CREATE INDEX "WorkSnapshot_projectId_takenAt_idx" ON "WorkSnapshot"("projectId", "takenAt");

-- AddForeignKey
ALTER TABLE "WorkAlert" ADD CONSTRAINT "WorkAlert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAlert" ADD CONSTRAINT "WorkAlert_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAlertItem" ADD CONSTRAINT "WorkAlertItem_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "WorkAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSnapshot" ADD CONSTRAINT "WorkSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

