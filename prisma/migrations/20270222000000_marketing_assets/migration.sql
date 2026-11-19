-- #marketing-assets: a marketing type's assets (a landing page, a video), with issues and ideas under them.
CREATE TABLE "MarketingAsset" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingAsset_typeId_name_key" ON "MarketingAsset"("typeId", "name");
CREATE INDEX "MarketingAsset_organisationId_typeId_idx" ON "MarketingAsset"("organisationId", "typeId");

ALTER TABLE "MarketingAsset" ADD CONSTRAINT "MarketingAsset_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingAsset" ADD CONSTRAINT "MarketingAsset_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "IssueType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Bug" ADD COLUMN "assetId" TEXT;
CREATE INDEX "Bug_assetId_idx" ON "Bug"("assetId");
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MarketingAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Idea" ADD COLUMN "assetId" TEXT;
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MarketingAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
