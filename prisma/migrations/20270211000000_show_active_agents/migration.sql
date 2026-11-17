-- #active-agents: everyone who can open a project sees its Active agents page; each person may hide it.
ALTER TABLE "User" ADD COLUMN "showActiveAgents" BOOLEAN NOT NULL DEFAULT true;
