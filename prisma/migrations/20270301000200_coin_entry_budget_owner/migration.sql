-- Project budgets (#project-budget): a ledger row in the `budget` account belongs to a project, as a wallet row belongs
-- to a person and an escrow row to an issue. The existing rule only knew wallet, escrow and revenue, so it refused
-- every budget row. Widens that one rule; nothing existing changes.
ALTER TABLE "CoinEntry" DROP CONSTRAINT "CoinEntry_account_owner";
ALTER TABLE "CoinEntry" ADD CONSTRAINT "CoinEntry_account_owner" CHECK (
  (account = 'wallet' AND "userId" IS NOT NULL)
  OR (account = 'escrow' AND "bugId" IS NOT NULL)
  OR account = 'revenue'
  OR (account = 'budget' AND "projectId" IS NOT NULL)
);