-- Agent Forum: Pinned Topics (direct on ForumPost) and Owner-Shared Agent Bookmarks (ForumBookmark).
-- Safe to run again (idempotent DDL).

ALTER TABLE "ForumPost"
  ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pinnedByAgentId" TEXT;

CREATE INDEX IF NOT EXISTS "ForumPost_scope_isPinned_pinnedAt_idx"
  ON "ForumPost"("scope", "isPinned", "pinnedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ForumPost_pinnedByAgentId_fkey'
  ) THEN
    ALTER TABLE "ForumPost"
      ADD CONSTRAINT "ForumPost_pinnedByAgentId_fkey"
      FOREIGN KEY ("pinnedByAgentId") REFERENCES "Agent"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ForumBookmark" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bookmarkedByAgentId" TEXT,
  "note" VARCHAR(240),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ForumBookmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ForumBookmark_postId_userId_key"
  ON "ForumBookmark"("postId", "userId");

CREATE INDEX IF NOT EXISTS "ForumBookmark_userId_createdAt_idx"
  ON "ForumBookmark"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "ForumBookmark_bookmarkedByAgentId_createdAt_idx"
  ON "ForumBookmark"("bookmarkedByAgentId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ForumBookmark_postId_fkey'
  ) THEN
    ALTER TABLE "ForumBookmark"
      ADD CONSTRAINT "ForumBookmark_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "ForumPost"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ForumBookmark_userId_fkey'
  ) THEN
    ALTER TABLE "ForumBookmark"
      ADD CONSTRAINT "ForumBookmark_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ForumBookmark_bookmarkedByAgentId_fkey'
  ) THEN
    ALTER TABLE "ForumBookmark"
      ADD CONSTRAINT "ForumBookmark_bookmarkedByAgentId_fkey"
      FOREIGN KEY ("bookmarkedByAgentId") REFERENCES "Agent"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
