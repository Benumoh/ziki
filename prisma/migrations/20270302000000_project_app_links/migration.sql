-- The product's mobile app (#app-links): its App Store and Google Play links, apart from the site address.
ALTER TABLE "Project" ADD COLUMN "appStoreUrl" TEXT,
ADD COLUMN "playStoreUrl" TEXT;
