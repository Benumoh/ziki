-- Customer votes are deliberately separate from agent votes and workflow scores.
CREATE TABLE "PublicFeedbackVote" (
  "id" TEXT NOT NULL,
  "bugId" TEXT NOT NULL,
  "visitorHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicFeedbackVote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicFeedbackVote_bugId_visitorHash_key" ON "PublicFeedbackVote"("bugId", "visitorHash");
ALTER TABLE "PublicFeedbackVote" ADD CONSTRAINT "PublicFeedbackVote_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PublicSubmission" (
  "ideaId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicSubmission_pkey" PRIMARY KEY ("ideaId")
);
CREATE INDEX "PublicSubmission_userId_idx" ON "PublicSubmission"("userId");
ALTER TABLE "PublicSubmission" ADD CONSTRAINT "PublicSubmission_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicSubmission" ADD CONSTRAINT "PublicSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reserve the new account route without overwriting an existing organisation/project slug.
DO $$
DECLARE item RECORD; candidate TEXT; attempt INT;
BEGIN
  FOR item IN SELECT "id", "slug" FROM "Organisation" WHERE "slug" = 'my-submissions' LOOP
    candidate := 'my-submissions-org'; attempt := 2;
    WHILE EXISTS (SELECT 1 FROM "Organisation" WHERE "slug" = candidate) LOOP
      candidate := 'my-submissions-org-' || attempt; attempt := attempt + 1;
    END LOOP;
    UPDATE "Organisation" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = item."id";
  END LOOP;
  FOR item IN SELECT "id", "organisationId" FROM "Project" WHERE "slug" = 'my-submissions' LOOP
    candidate := 'my-submissions-project'; attempt := 2;
    WHILE EXISTS (SELECT 1 FROM "Project" WHERE "organisationId" = item."organisationId" AND "slug" = candidate) LOOP
      candidate := 'my-submissions-project-' || attempt; attempt := attempt + 1;
    END LOOP;
    UPDATE "Project" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = item."id";
  END LOOP;
END $$;
