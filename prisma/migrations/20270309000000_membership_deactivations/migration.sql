-- CreateTable
CREATE TABLE "MembershipDeactivation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joinAnsweredAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedById" TEXT,

    CONSTRAINT "MembershipDeactivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipDeactivation_userId_idx" ON "MembershipDeactivation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipDeactivation_organisationId_userId_key" ON "MembershipDeactivation"("organisationId", "userId");

-- AddForeignKey
ALTER TABLE "MembershipDeactivation" ADD CONSTRAINT "MembershipDeactivation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipDeactivation" ADD CONSTRAINT "MembershipDeactivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipDeactivation" ADD CONSTRAINT "MembershipDeactivation_deactivatedById_fkey" FOREIGN KEY ("deactivatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

