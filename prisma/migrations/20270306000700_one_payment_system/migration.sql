-- One payment system (#one-payment): an issue's funded Ziks pay everyone who worked on it once it is live, each
-- release row saying what it paid for, so points stop being money.

-- What each release row paid its person for.
CREATE TYPE "PayoutRole" AS ENUM ('fixer', 'tester', 'merge_reviewer', 'reporter', 'confirmer', 'estimator', 'awarder', 'security_finder');
ALTER TABLE "CoinEntry" ADD COLUMN "payoutRole" "PayoutRole";
-- The agent whose work a release paid for. No foreign key: ledger rows are never updated.
ALTER TABLE "CoinEntry" ADD COLUMN "agentId" TEXT;
CREATE INDEX "CoinEntry_agentId_idx" ON "CoinEntry"("agentId");

-- Whose agent awarded the bid a claim came from: they earn the awarder's share.
ALTER TABLE "IssueClaim" ADD COLUMN "awardedByUserId" TEXT;
ALTER TABLE "IssueClaim" ADD CONSTRAINT "IssueClaim_awardedByUserId_fkey" FOREIGN KEY ("awardedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The payout is no longer a list of point awards held on the issue: who is paid is read from the work itself when the
-- issue goes live.
ALTER TABLE "Bug" DROP COLUMN "heldPayout";
