-- Usernames are unique across the platform (#agent-profile): an agent's
-- public page is /agent/{username}, so one username names one agent
-- everywhere, not one per workspace.
--
-- Before this, usernames were unique only within a workspace, and the first
-- backfill (20270101000023) didn't apply every rule the app has now. This
-- migration gives a fresh username to every agent whose current one
--   * another workspace's agent also has (the oldest agent keeps it), or
--   * the app would refuse: under 3 or over 30 characters, a reserved word,
--     or anything but lowercase letters, digits and inner dashes,
-- then makes usernames unique across the platform.
--
-- It is written to run once on a busy production database:
--   * the Agent table is locked for the length of this migration, so the old
--     container, still serving while the new one starts, can't add or rename an
--     agent between the clean-up and the unique index;
--   * a temporary index makes each "is this username free?" check a lookup,
--     not a scan, so hundreds of clashes (many agents called "Claude") stay fast;
--   * each fresh username is checked against the live table, so it can't clash
--     with one already taken, or with one given earlier in this same pass.

-- No agent is added or renamed until this migration commits.
LOCK TABLE "Agent" IN SHARE ROW EXCLUSIVE MODE;

-- Temporary: "is this username taken anywhere?" as an index lookup.
CREATE INDEX "Agent_username_lookup_tmp" ON "Agent"("username");

-- The default now checks every workspace, not only the agent's own. Lowercase,
-- runs of anything but letters and digits become one dash, no dash at either
-- end, at most 24 characters; under 3 characters or a reserved word gets
-- "-bot" ("agent-bot" when nothing is left). Taken: "-2", "-3", …
CREATE OR REPLACE FUNCTION agent_default_username(agent_name TEXT, agent_tenant TEXT, agent_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  handle TEXT;
  candidate TEXT;
  n INTEGER := 1;
BEGIN
  handle := btrim(left(btrim(regexp_replace(lower(coalesce(agent_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 24), '-');
  IF length(handle) < 3 OR handle IN ('me', 'pairing', 'new', 'agents', 'admin', 'api', 'mine', 'edit') THEN
    handle := btrim(coalesce(nullif(handle, ''), 'agent') || '-bot', '-');
  END IF;
  candidate := handle;
  WHILE EXISTS (SELECT 1 FROM "Agent" WHERE "username" = candidate AND "id" <> agent_id) LOOP
    n := n + 1;
    candidate := handle || '-' || n;
  END LOOP;
  RETURN candidate;
END;
$$;

-- Every agent that needs a fresh username, oldest first, so an older agent
-- keeps a name a newer one clashes with.
DO $$
DECLARE
  agent_row RECORD;
  fixed INTEGER := 0;
BEGIN
  FOR agent_row IN
    SELECT "id", "name", "tenantId"
    FROM (
      SELECT "id", "name", "tenantId", "createdAt", "username",
        row_number() OVER (PARTITION BY "username" ORDER BY "createdAt", "id") AS n
      FROM "Agent"
    ) ranked
    WHERE ranked.n > 1
      OR ranked."username" IS NULL
      OR length(ranked."username") < 3
      OR length(ranked."username") > 30
      OR ranked."username" IN ('me', 'pairing', 'new', 'agents', 'admin', 'api', 'mine', 'edit')
      OR ranked."username" !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    ORDER BY ranked."createdAt", ranked."id"
  LOOP
    UPDATE "Agent"
    SET "username" = agent_default_username(agent_row."name", agent_row."tenantId", agent_row."id")
    WHERE "id" = agent_row."id";
    fixed := fixed + 1;
  END LOOP;
  RAISE NOTICE 'agent usernames: % given a fresh username', fixed;
END;
$$;

-- DropIndex
DROP INDEX IF EXISTS "Agent_tenantId_username_key";

-- CreateIndex
CREATE UNIQUE INDEX "Agent_username_key" ON "Agent"("username");

-- The unique index does the lookups from here on.
DROP INDEX "Agent_username_lookup_tmp";
