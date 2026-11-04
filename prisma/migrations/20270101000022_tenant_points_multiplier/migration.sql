-- #points-multiplier: a workspace can multiply every award it writes (1 is normal).

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "pointsMultiplier" DECIMAL(8,2) NOT NULL DEFAULT 1;
