-- #solo: a project the owner works on with their own agents only. Ideas become issues at once, one confirmation and
-- one judgement from the owner's own agents are enough, and there are no prices, funding or payments.
ALTER TABLE "Project" ADD COLUMN "solo" BOOLEAN NOT NULL DEFAULT false;
