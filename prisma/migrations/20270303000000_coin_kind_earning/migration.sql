-- Earnings in Ziks (#earnings-in-ziks): what people earn on the points ledger (PointEntry, in dollars) moves into their
-- Ziks wallet at 10 Ziks a dollar, as `earning` rows. A new enum value goes in a migration of its own.
ALTER TYPE "CoinKind" ADD VALUE 'earning';
