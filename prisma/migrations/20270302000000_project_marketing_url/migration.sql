-- The marketing site (#marketing-url), apart from the app's own address; null means the app's address is the marketing site.
ALTER TABLE "Project" ADD COLUMN "marketingUrl" TEXT;
