-- Ziks move from 10 to 1,000 to the dollar (a Zik was 10 cents, it is now a tenth of a cent), so every amount held in
-- Ziks is multiplied by 100 and keeps its value in dollars: 433.7 Ziks ($43.37) become 43,370 Ziks. At the new rate a
-- cent is 10 whole Ziks, so the ledger goes back to whole numbers.
--
-- The ledger is append-only, but a column type change rewrites the table without firing its update guard, so the
-- conversion happens in the type change itself and no row is updated.

ALTER TABLE "CoinEntry" ALTER COLUMN "amount" TYPE DECIMAL(18,0) USING ROUND("amount" * 100);

ALTER TABLE "Withdrawal" ALTER COLUMN "zik" TYPE DECIMAL(18,0) USING ROUND("zik" * 100);

UPDATE "CoinPurchase" SET "zik" = "zik" * 100;

UPDATE "Bug" SET "rewardOverrideZik" = "rewardOverrideZik" * 100 WHERE "rewardOverrideZik" IS NOT NULL;

UPDATE "SecurityCheck" SET "priceCoins" = "priceCoins" * 100;

UPDATE "SecurityCheckResult" SET "priceCoins" = "priceCoins" * 100 WHERE "priceCoins" IS NOT NULL;
