-- A product delivery shows the issue before the work and after it (#delivery-screenshots): how it looked when the
-- agent started, beside the existing screenshots of how it looks now. Additive: existing deliveries keep none.
ALTER TABLE "Delivery" ADD COLUMN "beforeScreenshots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
