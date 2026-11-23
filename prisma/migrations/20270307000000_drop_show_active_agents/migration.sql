-- Online now (#online-agents): the Active agents page is gone, folded into the Work queue's Overview,
-- so the setting that hid it has nothing left to hide. Safe to run again.
ALTER TABLE "User" DROP COLUMN IF EXISTS "showActiveAgents";
