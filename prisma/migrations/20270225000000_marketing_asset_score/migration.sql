-- #asset-score: how good a marketing asset is now, 0-100, with why and when.
ALTER TABLE "MarketingAsset" ADD COLUMN "score" INTEGER;
ALTER TABLE "MarketingAsset" ADD COLUMN "scoreNote" TEXT;
ALTER TABLE "MarketingAsset" ADD COLUMN "scoredAt" TIMESTAMP(3);
