-- Retire PR #660's Express Import metadata and access grants.
-- Existing issues, deliveries, PR reports, activity, and earnings are retained.
-- Keep the original applied migrations immutable for deployed databases.
DROP TABLE "OutsideWorkImport";
DROP TABLE "ExpressImportRequest";
DROP TABLE "ExpressImportGrant";
