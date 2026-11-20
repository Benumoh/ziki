-- Live · Confirmed (#live-confirmed): a person's "Looks fine" on live work moves it from the Work Feed to Delivered.
-- Additive: nothing is confirmed yet.
ALTER TABLE "Bug" ADD COLUMN "liveConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Bug" ADD COLUMN "liveConfirmedById" TEXT;
