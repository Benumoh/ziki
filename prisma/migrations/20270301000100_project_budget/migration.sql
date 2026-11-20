-- Project budgets (#project-budget): which project a ledger row belongs to, whether a project pays from a budget, the
-- last warning sent about it, and a price the owner set above an issue's estimate. Additive; nothing existing changes.
ALTER TABLE "CoinEntry" ADD COLUMN "projectId" TEXT;
CREATE INDEX "CoinEntry_account_projectId_idx" ON "CoinEntry"("account", "projectId");
ALTER TABLE "CoinEntry" ADD CONSTRAINT "CoinEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "budgetEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "budgetAlert" TEXT;

ALTER TABLE "Bug" ADD COLUMN "rewardOverrideZik" INTEGER;