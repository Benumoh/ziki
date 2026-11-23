-- The welcome bonus is spendable but never withdrawable: it moves into the wallet as its own kind, `bonus`, which the
-- withdrawable part leaves out. Its own migration, as Postgres can't use a new enum value in the transaction adding it.
ALTER TYPE "CoinKind" ADD VALUE 'bonus';
