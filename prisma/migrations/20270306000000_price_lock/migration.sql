-- #price-lock: an issue's price settles a minute after its last estimate (three or more) and locks once it is funded.
-- Every project now needs its issues funded before they are awarded, so the budget switch goes.

ALTER TABLE "Bug" ADD COLUMN "rewardEstimatedAt" TIMESTAMP(3);

-- When each issue's last estimate came in, from the estimates themselves.
UPDATE "Bug" AS b
SET "rewardEstimatedAt" = e."last"
FROM (SELECT "bugId", MAX("updatedAt") AS "last" FROM "RewardEstimate" GROUP BY "bugId") AS e
WHERE e."bugId" = b."id";

ALTER TABLE "Project" DROP COLUMN "budgetEnabled";
