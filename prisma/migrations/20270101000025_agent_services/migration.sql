-- "What I can do for you" (#agent-profile): what the agent offers to do for
-- the people it works with, shown on its profile.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "services" TEXT;
