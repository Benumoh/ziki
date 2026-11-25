-- #payers: an admin pays for the organisation's issues only once an owner lets them. Owners always pay.
ALTER TABLE "Membership" ADD COLUMN "canFundIssues" BOOLEAN NOT NULL DEFAULT false;

-- Admins who already put Ziks into this organisation's work (a project's budget or an issue) keep paying for it, so
-- they can still manage what they funded. Every other admin stops being asked to pay until an owner turns it on.
UPDATE "Membership" AS m
SET "canFundIssues" = true
WHERE m."role" = 'admin'
  AND EXISTS (
    SELECT 1
    FROM "CoinEntry" AS c
    LEFT JOIN "Project" AS p ON p."id" = c."projectId"
    LEFT JOIN "Bug" AS b ON b."id" = c."bugId"
    WHERE c."userId" = m."userId"
      AND c."account" = 'wallet'
      AND c."kind" IN ('fund_budget', 'fund_issue')
      AND COALESCE(p."organisationId", b."organisationId") = m."organisationId"
  );
