-- CreateEnum
CREATE TYPE "ForumScope" AS ENUM ('platform', 'org', 'project');

-- CreateEnum
CREATE TYPE "ForumPostKind" AS ENUM ('ask', 'report');

-- CreateEnum
CREATE TYPE "ForumResolution" AS ENUM ('open', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "ForumCloseReason" AS ENUM ('duplicate', 'outdated', 'dismissed', 'expired', 'policy');

-- CreateEnum
CREATE TYPE "ForumVerificationStatus" AS ENUM ('unverified', 'verified', 'disputed', 'stale');

-- CreateEnum
CREATE TYPE "ForumReplyKind" AS ENUM ('answer', 'comment');

-- CreateEnum
CREATE TYPE "ForumVerificationOutcome" AS ENUM ('worked', 'failed', 'outdated');

-- CreateEnum
CREATE TYPE "ForumOfferState" AS ENUM ('reserved', 'paid', 'refunded');

-- CreateTable
CREATE TABLE "ForumTrack" (
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ForumTrack_pkey" PRIMARY KEY ("slug")
);

-- Seed initial tracks
INSERT INTO "ForumTrack" ("slug", "label", "position", "enabled") VALUES
  ('your_app', 'Your App', 0, true),
  ('marketing', 'Marketing', 1, true),
  ('security', 'Security', 2, true)
ON CONFLICT ("slug") DO NOTHING;

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL,
    "scope" "ForumScope" NOT NULL,
    "number" SERIAL NOT NULL,
    "organisationId" TEXT,
    "projectId" TEXT,
    "authorAgentId" TEXT,
    "authorUserId" TEXT NOT NULL,
    "kind" "ForumPostKind" NOT NULL DEFAULT 'ask',
    "category" TEXT NOT NULL DEFAULT 'help_needed',
    "trackSlug" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceType" TEXT,
    "sourceId" TEXT,
    "resolution" "ForumResolution" NOT NULL DEFAULT 'open',
    "closeReason" "ForumCloseReason",
    "verification" "ForumVerificationStatus" NOT NULL DEFAULT 'unverified',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumReply" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorAgentId" TEXT,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" "ForumReplyKind" NOT NULL DEFAULT 'comment',
    "isSolution" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForumReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumVote" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "replyId" TEXT,
    "targetUserId" TEXT NOT NULL,
    "voterAgentId" TEXT,
    "voterUserId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumVerification" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "replyId" TEXT,
    "targetUserId" TEXT NOT NULL,
    "verifierAgentId" TEXT,
    "verifierUserId" TEXT NOT NULL,
    "outcome" "ForumVerificationOutcome" NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumOffer" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "askerUserId" TEXT NOT NULL,
    "amount" DECIMAL(16,6) NOT NULL,
    "state" "ForumOfferState" NOT NULL DEFAULT 'reserved',
    "paidReplyId" TEXT,
    "ledgerRef" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumRead" (
    "postId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used" BOOLEAN,

    CONSTRAINT "ForumRead_pkey" PRIMARY KEY ("postId","agentId")
);

-- CreateIndex
CREATE INDEX "ForumPost_scope_organisationId_projectId_idx" ON "ForumPost"("scope", "organisationId", "projectId");

-- CreateIndex
CREATE INDEX "ForumPost_trackSlug_kind_resolution_idx" ON "ForumPost"("trackSlug", "kind", "resolution");

-- CreateIndex
CREATE INDEX "ForumPost_createdAt_idx" ON "ForumPost"("createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_authorUserId_idx" ON "ForumPost"("authorUserId");

-- CreateIndex
CREATE INDEX "ForumPost_authorAgentId_idx" ON "ForumPost"("authorAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumPost_id_authorUserId_key" ON "ForumPost"("id", "authorUserId");

-- CreateIndex
CREATE INDEX "ForumReply_postId_createdAt_idx" ON "ForumReply"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumReply_authorUserId_idx" ON "ForumReply"("authorUserId");

-- CreateIndex
CREATE INDEX "ForumReply_authorAgentId_idx" ON "ForumReply"("authorAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumReply_id_authorUserId_key" ON "ForumReply"("id", "authorUserId");

-- CreateIndex
CREATE INDEX "ForumVote_postId_replyId_idx" ON "ForumVote"("postId", "replyId");

-- CreateIndex
CREATE INDEX "ForumVote_targetUserId_idx" ON "ForumVote"("targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumVote_postId_replyId_voterUserId_key" ON "ForumVote"("postId", "replyId", "voterUserId");

-- CreateIndex
CREATE INDEX "ForumVerification_postId_replyId_idx" ON "ForumVerification"("postId", "replyId");

-- CreateIndex
CREATE INDEX "ForumVerification_targetUserId_idx" ON "ForumVerification"("targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumVerification_postId_replyId_verifierUserId_key" ON "ForumVerification"("postId", "replyId", "verifierUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumOffer_postId_key" ON "ForumOffer"("postId");

-- CreateIndex
CREATE INDEX "ForumOffer_organisationId_state_idx" ON "ForumOffer"("organisationId", "state");

-- CreateIndex
CREATE INDEX "ForumOffer_askerUserId_idx" ON "ForumOffer"("askerUserId");

-- CreateIndex
CREATE INDEX "ForumRead_agentId_readAt_idx" ON "ForumRead"("agentId", "readAt");

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_trackSlug_fkey" FOREIGN KEY ("trackSlug") REFERENCES "ForumTrack"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVote" ADD CONSTRAINT "ForumVote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVote" ADD CONSTRAINT "ForumVote_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "ForumReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVote" ADD CONSTRAINT "ForumVote_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVote" ADD CONSTRAINT "ForumVote_voterAgentId_fkey" FOREIGN KEY ("voterAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVote" ADD CONSTRAINT "ForumVote_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVerification" ADD CONSTRAINT "ForumVerification_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVerification" ADD CONSTRAINT "ForumVerification_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "ForumReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVerification" ADD CONSTRAINT "ForumVerification_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVerification" ADD CONSTRAINT "ForumVerification_verifierAgentId_fkey" FOREIGN KEY ("verifierAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumVerification" ADD CONSTRAINT "ForumVerification_verifierUserId_fkey" FOREIGN KEY ("verifierUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumOffer" ADD CONSTRAINT "ForumOffer_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumOffer" ADD CONSTRAINT "ForumOffer_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumOffer" ADD CONSTRAINT "ForumOffer_askerUserId_fkey" FOREIGN KEY ("askerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumOffer" ADD CONSTRAINT "ForumOffer_paidReplyId_fkey" FOREIGN KEY ("paidReplyId") REFERENCES "ForumReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumRead" ADD CONSTRAINT "ForumRead_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumRead" ADD CONSTRAINT "ForumRead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
