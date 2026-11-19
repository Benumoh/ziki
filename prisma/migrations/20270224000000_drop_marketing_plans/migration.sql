-- Marketing plans are removed (#marketing-assets replaces them on the Marketing page): their tables and enums go.
-- Nothing reads them any more. This deletes any plans already saved.

-- DropForeignKey
ALTER TABLE "MarketingPlan" DROP CONSTRAINT "MarketingPlan_projectId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlan" DROP CONSTRAINT "MarketingPlan_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanRevision" DROP CONSTRAINT "MarketingPlanRevision_planId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanRevision" DROP CONSTRAINT "MarketingPlanRevision_createdById_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanRevision" DROP CONSTRAINT "MarketingPlanRevision_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivity" DROP CONSTRAINT "MarketingPlanActivity_planId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivityRevision" DROP CONSTRAINT "MarketingPlanActivityRevision_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivityRevision" DROP CONSTRAINT "MarketingPlanActivityRevision_activityId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivityDecision" DROP CONSTRAINT "MarketingPlanActivityDecision_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivityDecision" DROP CONSTRAINT "MarketingPlanActivityDecision_activityId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivityDecision" DROP CONSTRAINT "MarketingPlanActivityDecision_decidedById_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivityDecisionEvent" DROP CONSTRAINT "MarketingPlanActivityDecisionEvent_decisionId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingPlanActivityDecisionEvent" DROP CONSTRAINT "MarketingPlanActivityDecisionEvent_actorId_fkey";

-- DropTable
DROP TABLE "MarketingPlan";

-- DropTable
DROP TABLE "MarketingPlanRevision";

-- DropTable
DROP TABLE "MarketingPlanActivity";

-- DropTable
DROP TABLE "MarketingPlanActivityRevision";

-- DropTable
DROP TABLE "MarketingPlanActivityDecision";

-- DropTable
DROP TABLE "MarketingPlanActivityDecisionEvent";

-- DropEnum
DROP TYPE "MarketingPlanRevisionStatus";

-- DropEnum
DROP TYPE "MarketingPlanActivityDecisionValue";

