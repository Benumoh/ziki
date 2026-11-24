-- #price-lock: a locked price is stored, not worked out again from the estimates, so it can't drift from what is held
-- (an issue funded at 53 Ziks has 5,300 held after the move to 1,000 Ziks a dollar, while its $5.33 average now reads
-- 5,330).
ALTER TABLE "Bug" ADD COLUMN "lockedPriceZik" INTEGER;

-- Every issue already holding Ziks and not yet paid out is locked at exactly what it holds: funding locks a price, and
-- what is held is what its fixer is paid.
UPDATE "Bug" AS b
SET "lockedPriceZik" = h."held",
    "rewardFixedAt" = COALESCE(b."rewardFixedAt", NOW())
FROM (
  SELECT "bugId", SUM("amount")::INTEGER AS "held"
  FROM "CoinEntry"
  WHERE "account" = 'escrow' AND "bugId" IS NOT NULL
  GROUP BY "bugId"
  HAVING SUM("amount") > 0
) AS h
WHERE h."bugId" = b."id" AND b."payoutReleasedAt" IS NULL AND b."isDeleted" = false;
