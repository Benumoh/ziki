-- Ziks to one decimal (#earnings-in-ziks): earnings move into the wallet exactly as earned, so a wallet can hold 6.7
-- Ziks. Buying, funding and budgets stay whole Ziks; ledger rows and withdrawals may carry a tenth. Every existing
-- whole amount converts as it is (a type change rewrites the table without firing the append-only triggers).
ALTER TABLE "CoinEntry" ALTER COLUMN "amount" TYPE DECIMAL(14,1);
ALTER TABLE "Withdrawal" ALTER COLUMN "zik" TYPE DECIMAL(14,1);
