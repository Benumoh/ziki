ALTER TABLE "PullRequestReport"
ADD COLUMN "mergedAt" TIMESTAMP(3);

ALTER TABLE "Bug"
ADD COLUMN "pullRequestLinkedAt" TIMESTAMP(3);

UPDATE "Bug" AS bug
SET "pullRequestLinkedAt" = (
  SELECT MAX(delivery."updatedAt")
  FROM "Delivery" AS delivery
  WHERE delivery."bugId" = bug."id"
    AND delivery."pullRequestUrl" = bug."pullRequestUrl"
)
WHERE bug."pullRequestUrl" IS NOT NULL;
