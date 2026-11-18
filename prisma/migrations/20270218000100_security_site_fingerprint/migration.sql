-- What the quick scan saw of the site, so a rescan can say whether it changed since (18 Nov). Additive.
ALTER TABLE "SecurityCheck" ADD COLUMN "siteFingerprint" JSONB;
