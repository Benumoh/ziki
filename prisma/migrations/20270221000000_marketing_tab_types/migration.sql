-- #marketing-tabs: the Marketing tabs are Landing Pages, Content Marketing, Social Media, Outreach, SEO and Videos.
-- Every organisation's default marketing types move to them (lib/marketing/default-task-types.ts). Types an
-- organisation made itself are left alone.

-- 1. The defaults that carry on are renamed. A name the organisation already uses (any case) is left as it is.
--    A description or goal still at the old default takes the new one; one an admin changed is kept.
UPDATE "IssueType" AS t
SET "name" = r."to",
    "description" = CASE WHEN t."description" IS NULL OR t."description" = r."oldDescription" THEN r."description" ELSE t."description" END,
    "goal" = CASE WHEN t."goal" IS NULL OR t."goal" = r."oldGoal" THEN r."goal" ELSE t."goal" END,
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('Landing page copy', 'Landing Pages',
   'Copy for a page on the website.', 'Pages and copy on the website.',
   'Turn more visitors into sign-ups with clear, persuasive copy that explains the value of the product in seconds.',
   'Turn more visitors into sign-ups with clear, persuasive pages that explain the value of the product in seconds.'),
  ('Blog post', 'Content Marketing',
   'A post on the project''s blog.', 'Blog posts, guides, case studies and newsletters.',
   'Grow organic search traffic and build trust with helpful, well-researched posts that answer the questions your audience is searching for.',
   'Grow organic traffic and build trust with helpful content that answers the questions your audience is asking.'),
  ('Social post', 'Social Media',
   'A post or thread on a social network.', 'Posts and threads on social networks.',
   'Grow an engaged following and drive visits to the site with regular posts and threads where your audience already spends time.',
   'Grow an engaged following and drive visits to the site with regular posts and threads where your audience already spends time.'),
  ('Video', 'Videos',
   'A video or short clip.', 'Videos and short clips, each made in the video studio.',
   'Show the product in action and reach new audiences with short videos and clips that are easy to share.',
   'Show the product in action and reach new audiences with short videos and clips that are easy to share.')
) AS r("from", "to", "oldDescription", "description", "oldGoal", "goal")
WHERE t."track" = 'marketing'
  AND t."name" = r."from"
  AND NOT EXISTS (
    SELECT 1 FROM "IssueType" o WHERE o."organisationId" = t."organisationId" AND lower(o."name") = lower(r."to")
  );

-- 2. Every organisation with marketing types gets SEO (one without any has none of the defaults to join).
INSERT INTO "IssueType" ("id", "organisationId", "name", "description", "goal", "isActive", "track", "updatedAt")
SELECT 'dmt_' || md5(o."id" || ':SEO'), o."id", 'SEO', 'How the site is found in search.',
       'Get found by the people searching for what you offer, by improving the site''s rankings, structure and keywords.',
       true, 'marketing'::"WorkTrack", CURRENT_TIMESTAMP
FROM "Organisation" o
WHERE EXISTS (SELECT 1 FROM "IssueType" t WHERE t."organisationId" = o."id" AND t."track" = 'marketing')
ON CONFLICT DO NOTHING;

-- 3. The defaults that end fold into the tab their work belongs to: newsletters and case studies are
--    Content Marketing, graphics are Social Media. Their tasks and ideas move there, then the old type is turned
--    off (not deleted, so nothing that names it is lost). Only where the organisation has that tab as a marketing type.
WITH folds("from", "to") AS (VALUES
  ('Email or newsletter', 'Content Marketing'),
  ('Case study', 'Content Marketing'),
  ('Graphic', 'Social Media')
), pairs AS (
  SELECT old."id" AS "oldId", new."id" AS "newId"
  FROM folds f
  JOIN "IssueType" old ON old."track" = 'marketing' AND old."name" = f."from"
  JOIN "IssueType" new ON new."track" = 'marketing' AND new."name" = f."to" AND new."organisationId" = old."organisationId"
), bugs AS (
  -- Postgres runs a data-changing WITH to completion whether or not the outer statement reads it.
  UPDATE "Bug" b SET "typeId" = p."newId" FROM pairs p WHERE b."typeId" = p."oldId"
), ideas AS (
  UPDATE "Idea" i SET "typeId" = p."newId" FROM pairs p WHERE i."typeId" = p."oldId"
)
UPDATE "IssueType" t SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
FROM pairs p
WHERE t."id" = p."oldId";

-- 4. The tabs list types oldest first: the six take their order from the organisation's first marketing type,
--    a second apart.
WITH ordered("name", "position") AS (VALUES
  ('Landing Pages', 0), ('Content Marketing', 1), ('Social Media', 2), ('Outreach', 3), ('SEO', 4), ('Videos', 5)
), base AS (
  SELECT "organisationId", min("createdAt") AS "at" FROM "IssueType" WHERE "track" = 'marketing' GROUP BY "organisationId"
)
UPDATE "IssueType" t
SET "createdAt" = base."at" + make_interval(secs => ordered."position")
FROM ordered, base
WHERE t."track" = 'marketing' AND t."name" = ordered."name" AND base."organisationId" = t."organisationId";
