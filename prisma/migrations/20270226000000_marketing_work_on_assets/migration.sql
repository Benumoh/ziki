-- Every piece of marketing work sits on an asset (#marketing-assets): there is no "Other work". Marketing issues and
-- ideas with a type but no asset each gain an asset under their type, named after their title (the app does the same
-- when work is filed without one, lib/marketing/assets.ts). Work with the same type and title shares one asset, as the
-- (typeId, name) unique key requires. An asset's name is at most 80 characters, so a longer title is cut there. Work
-- without a type has no type for an asset to belong to, and stays as it is.

INSERT INTO "MarketingAsset" ("id", "organisationId", "typeId", "name", "createdAt", "updatedAt")
SELECT 'ma' || substr(md5(random()::text || clock_timestamp()::text || work."typeId" || work."name"), 1, 23),
       work."organisationId", work."typeId", work."name", now(), now()
FROM (
  SELECT DISTINCT ON ("typeId", "name") "organisationId", "typeId", "name"
  FROM (
    SELECT "organisationId", "typeId", left(btrim("title"), 80) AS "name" FROM "Bug" WHERE "track" = 'marketing' AND "assetId" IS NULL AND "typeId" IS NOT NULL
    UNION ALL
    SELECT "organisationId", "typeId", left(btrim("title"), 80) AS "name" FROM "Idea" WHERE "track" = 'marketing' AND "assetId" IS NULL AND "typeId" IS NOT NULL
  ) AS loose
  ORDER BY "typeId", "name"
) AS work
ON CONFLICT ("typeId", "name") DO NOTHING;

UPDATE "Bug" AS bug
SET "assetId" = asset."id"
FROM "MarketingAsset" AS asset
WHERE bug."track" = 'marketing' AND bug."assetId" IS NULL
  AND asset."typeId" = bug."typeId" AND asset."name" = left(btrim(bug."title"), 80) AND asset."organisationId" = bug."organisationId";

UPDATE "Idea" AS idea
SET "assetId" = asset."id"
FROM "MarketingAsset" AS asset
WHERE idea."track" = 'marketing' AND idea."assetId" IS NULL
  AND asset."typeId" = idea."typeId" AND asset."name" = left(btrim(idea."title"), 80) AND asset."organisationId" = idea."organisationId";
