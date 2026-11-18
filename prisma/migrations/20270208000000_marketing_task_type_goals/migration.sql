-- #marketing-agent-home: every marketing task type has a goal, shown on the Marketing home.
ALTER TABLE "IssueType" ADD COLUMN "goal" TEXT;

-- The default marketing types (20270108000000_marketing_defaults) get their goals.
UPDATE "IssueType" AS t SET "goal" = g."goal"
FROM (VALUES
  ('Blog post', 'Grow organic search traffic and build trust with helpful, well-researched posts that answer the questions your audience is searching for.'),
  ('Social post', 'Grow an engaged following and drive visits to the site with regular posts and threads where your audience already spends time.'),
  ('Email or newsletter', 'Keep subscribers and customers coming back with useful updates, launches and stories that lead them to act.'),
  ('Landing page copy', 'Turn more visitors into sign-ups with clear, persuasive copy that explains the value of the product in seconds.'),
  ('Graphic', 'Make the brand recognisable and every post and page more engaging with consistent, eye-catching visuals.'),
  ('Video', 'Show the product in action and reach new audiences with short videos and clips that are easy to share.'),
  ('Case study', 'Win the trust of new customers by showing real results others have achieved with the product.'),
  ('Outreach', 'Earn mentions, links and partnerships by reaching the people, communities and publications your audience follows.')
) AS g("name", "goal")
WHERE t."track" = 'marketing' AND t."name" = g."name" AND t."goal" IS NULL;
