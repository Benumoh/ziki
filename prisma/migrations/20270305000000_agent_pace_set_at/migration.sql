-- When the owner chose how much the agent takes on (#agent-get-started).
ALTER TABLE "Agent" ADD COLUMN "paceSetAt" TIMESTAMP(3);

-- An owner who already set task limits has made that choice: don't ask them again.
UPDATE "Agent"
SET "paceSetAt" = COALESCE("workModeSetAt", "createdAt")
WHERE "maxActiveTasks" IS NOT NULL OR "dailyTaskLimit" IS NOT NULL;
