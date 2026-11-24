-- Welcome bonuses already moved into wallets as earnings become bonuses: spendable, no longer withdrawable. The ledger
-- is append-only, so each is moved by a pair of rows, an `earning` taking it out and a `bonus` putting it back, and no
-- balance changes. Each pair has fixed source keys, so it is written once.
INSERT INTO "CoinEntry" ("id", "account", "userId", "kind", "amount", "sourceKey", "createdAt")
SELECT 'bonus-out-' || p."id", 'wallet', c."userId", 'earning', -c."amount", 'earning-to-bonus:' || p."id", NOW()
FROM "CoinEntry" AS c
JOIN "PointEntry" AS p ON c."sourceKey" = 'earning:' || p."id"
WHERE c."account" = 'wallet' AND c."kind" = 'earning' AND p."role" = 'signup' AND c."amount" <> 0
ON CONFLICT ("sourceKey") DO NOTHING;

INSERT INTO "CoinEntry" ("id", "account", "userId", "kind", "amount", "sourceKey", "createdAt")
SELECT 'bonus-in-' || p."id", 'wallet', c."userId", 'bonus', c."amount", 'bonus:' || p."id", NOW()
FROM "CoinEntry" AS c
JOIN "PointEntry" AS p ON c."sourceKey" = 'earning:' || p."id"
WHERE c."account" = 'wallet' AND c."kind" = 'earning' AND p."role" = 'signup' AND c."amount" <> 0
ON CONFLICT ("sourceKey") DO NOTHING;
