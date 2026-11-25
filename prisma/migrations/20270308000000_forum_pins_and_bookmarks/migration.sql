-- AlterTable
ALTER TABLE "ForumPost" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedByAgentId" TEXT;

-- CreateTable
CREATE TABLE "ForumBookmark" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookmarkedByAgentId" TEXT,
    "note" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForumBookmark_userId_createdAt_idx" ON "ForumBookmark"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumBookmark_bookmarkedByAgentId_createdAt_idx" ON "ForumBookmark"("bookmarkedByAgentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForumBookmark_postId_userId_key" ON "ForumBookmark"("postId", "userId");

-- CreateIndex
CREATE INDEX "ForumPost_scope_isPinned_pinnedAt_idx" ON "ForumPost"("scope", "isPinned", "pinnedAt");

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_pinnedByAgentId_fkey" FOREIGN KEY ("pinnedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumBookmark" ADD CONSTRAINT "ForumBookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumBookmark" ADD CONSTRAINT "ForumBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumBookmark" ADD CONSTRAINT "ForumBookmark_bookmarkedByAgentId_fkey" FOREIGN KEY ("bookmarkedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
