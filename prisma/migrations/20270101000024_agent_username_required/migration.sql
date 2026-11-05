-- Every agent has a username (#agent-profile): it is the agent's slug, the
-- address of its page (/settings/agent/{username}). The previous migration
-- backfilled one from each name; this fills any agent made since without one,
-- gives every new agent a default from its name, and makes it required.

-- The default, made the way the app makes one (lib/validations/agent-profile.ts
-- usernameFromName, lib/agents/profile.ts freeUsername): lowercase, runs of
-- anything but letters and digits become one dash, no dash at either end, at
-- most 24 characters; under 3 characters or a reserved word gets "-bot"
-- ("agent-bot" when nothing is left). Taken in the workspace: "-2", "-3", …
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
  IF length(handle) < 3 OR handle IN ('me', 'pairing', 'new', 'agents', 'admin', 'api') THEN
    handle := btrim(coalesce(nullif(handle, ''), 'agent') || '-bot', '-');
  END IF;
  candidate := handle;
  WHILE EXISTS (
    SELECT 1 FROM "Agent" WHERE "tenantId" = agent_tenant AND "username" = candidate AND "id" <> agent_id
  ) LOOP
    n := n + 1;
    candidate := handle || '-' || n;
  END LOOP;
  RETURN candidate;
END;
$$;

-- Agents still without one, oldest first, so the older keeps the plain handle.
DO $$
DECLARE
  agent_row RECORD;
BEGIN
  FOR agent_row IN SELECT "id", "name", "tenantId" FROM "Agent" WHERE "username" IS NULL ORDER BY "createdAt", "id" LOOP
    UPDATE "Agent"
    SET "username" = agent_default_username(agent_row."name", agent_row."tenantId", agent_row."id")
    WHERE "id" = agent_row."id";
  END LOOP;
END;
$$;

-- Any insert (or update) that leaves the username out gets the default.
CREATE OR REPLACE FUNCTION agent_username_default_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."username" IS NULL OR btrim(NEW."username") = '' THEN
    NEW."username" := agent_default_username(NEW."name", NEW."tenantId", NEW."id");
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Agent_username_default" ON "Agent";
CREATE TRIGGER "Agent_username_default"
BEFORE INSERT OR UPDATE OF "username" ON "Agent"
FOR EACH ROW EXECUTE FUNCTION agent_username_default_trigger();

-- AlterTable
ALTER TABLE "Agent" ALTER COLUMN "username" SET NOT NULL;
