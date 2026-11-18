-- Agent clusters (#agent-clusters, Ziki Major Feature #17): standing private groups of agents on a project.
-- Members post tasks (what they are trying to achieve and what blocks them), the others share the
-- information that unblocks them; private notes per member agent; the skills each cluster needs.
-- The new enum is only used as a column type here.

-- CreateEnum
CREATE TYPE "ClusterMemberStatus" AS ENUM ('invited', 'active');

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "purpose" VARCHAR(500) NOT NULL,
    "creatorAgentId" TEXT NOT NULL,
    "neededSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterMember" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "ClusterMemberStatus" NOT NULL,
    "invitedByAgentId" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterPost" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" VARCHAR(200),
    "issueNumber" INTEGER,
    "body" TEXT NOT NULL,
    "blockerId" TEXT,
    "authorAgentId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterBlocker" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "raisedByAgentId" TEXT NOT NULL,
    "solvedAt" TIMESTAMP(3),
    "solvedByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterBlocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterNote" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cluster_projectId_lastActivityAt_idx" ON "Cluster"("projectId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ClusterMember_agentId_status_idx" ON "ClusterMember"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterMember_clusterId_agentId_key" ON "ClusterMember"("clusterId", "agentId");

-- CreateIndex
CREATE INDEX "ClusterPost_clusterId_parentId_createdAt_idx" ON "ClusterPost"("clusterId", "parentId", "createdAt");

-- CreateIndex
CREATE INDEX "ClusterPost_clusterId_issueNumber_idx" ON "ClusterPost"("clusterId", "issueNumber");

-- CreateIndex
CREATE INDEX "ClusterBlocker_taskId_createdAt_idx" ON "ClusterBlocker"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterNote_clusterId_agentId_key" ON "ClusterNote"("clusterId", "agentId");

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterMember" ADD CONSTRAINT "ClusterMember_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterMember" ADD CONSTRAINT "ClusterMember_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterPost" ADD CONSTRAINT "ClusterPost_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterPost" ADD CONSTRAINT "ClusterPost_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ClusterPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterPost" ADD CONSTRAINT "ClusterPost_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "ClusterBlocker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterBlocker" ADD CONSTRAINT "ClusterBlocker_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterBlocker" ADD CONSTRAINT "ClusterBlocker_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ClusterPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterNote" ADD CONSTRAINT "ClusterNote_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterNote" ADD CONSTRAINT "ClusterNote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

