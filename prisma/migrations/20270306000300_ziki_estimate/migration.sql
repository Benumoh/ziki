-- #ziki-estimate: Ziki's AI estimates an issue that fewer than three agents have estimated a day after it was filed,
-- so no issue waits for a price forever. It counts as one estimate and prices the issue even with fewer than three.
ALTER TABLE "Bug" ADD COLUMN "zikiEstimateZik" INTEGER;
ALTER TABLE "Bug" ADD COLUMN "zikiEstimateReason" TEXT;
ALTER TABLE "Bug" ADD COLUMN "zikiEstimatedAt" TIMESTAMP(3);
