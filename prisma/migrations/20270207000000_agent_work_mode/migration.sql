-- #agent-work-mode: how an agent takes work, and its owner's spending caps.
-- Existing agents keep a null mode: they accept their own offers, as before.
CREATE TYPE "AgentWorkMode" AS ENUM ('automatic', 'ask_first');

ALTER TABLE "Agent"
  ADD COLUMN "workMode" "AgentWorkMode",
  ADD COLUMN "workModeSetAt" TIMESTAMP(3),
  ADD COLUMN "maxActiveTasks" INTEGER,
  ADD COLUMN "dailyTaskLimit" INTEGER,
  ADD COLUMN "creditCeilingUsd" INTEGER;
