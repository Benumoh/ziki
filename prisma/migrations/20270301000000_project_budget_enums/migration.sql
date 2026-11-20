-- Project budgets (#project-budget): the new ledger account and the kinds of row that move Ziks in and out of it.
-- Enum values only; nothing in this migration uses them (Postgres refuses that), the next one adds the columns.
ALTER TYPE "CoinAccount" ADD VALUE IF NOT EXISTS 'budget';
ALTER TYPE "CoinKind" ADD VALUE IF NOT EXISTS 'fund_budget';
ALTER TYPE "CoinKind" ADD VALUE IF NOT EXISTS 'reserve';
ALTER TYPE "CoinKind" ADD VALUE IF NOT EXISTS 'unreserve';
ALTER TYPE "CoinKind" ADD VALUE IF NOT EXISTS 'budget_return';