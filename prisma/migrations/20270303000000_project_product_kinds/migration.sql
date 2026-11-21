-- What the project is (#product-kinds): its kinds, "other" in the owner's words, and a desktop app's or game's download page.
ALTER TABLE "Project" ADD COLUMN "productKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "productOther" TEXT,
ADD COLUMN "downloadUrl" TEXT;
