-- Ziki plans (#ziki-coins). An owner subscribes and, while the plan is paid up, pays less for Ziks packs. The monthly
-- fee buys no Ziks, so each paid invoice is a CoinPurchase of zero Ziks (cash Stripe holds) and no ledger row.
-- CoinPurchase used to come only from a Checkout session and a pack, so both are now optional, and an invoice and a
-- plan are added beside them.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stripeCustomerId" TEXT;

-- AlterTable
ALTER TABLE "CoinPurchase" ADD COLUMN     "planId" TEXT,
ADD COLUMN     "stripeInvoiceId" TEXT,
ADD COLUMN     "subscriptionId" TEXT,
ALTER COLUMN "stripeSessionId" DROP NOT NULL,
ALTER COLUMN "packId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CoinSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "payUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoinSubscription_stripeSubscriptionId_key" ON "CoinSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "CoinSubscription_userId_idx" ON "CoinSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinPurchase_stripeInvoiceId_key" ON "CoinPurchase"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "CoinPurchase_subscriptionId_idx" ON "CoinPurchase"("subscriptionId");

-- AddForeignKey
ALTER TABLE "CoinPurchase" ADD CONSTRAINT "CoinPurchase_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CoinSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinSubscription" ADD CONSTRAINT "CoinSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A purchase always comes from a Checkout session (a pack) or an invoice (a monthly plan).
ALTER TABLE "CoinPurchase" ADD CONSTRAINT "CoinPurchase_source_check" CHECK ("stripeSessionId" IS NOT NULL OR "stripeInvoiceId" IS NOT NULL);
