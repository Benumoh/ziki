-- Join questions (#join-questions): why someone joined, what they're good at and how much time they have.
-- Null `joinAnsweredAt` means still to ask, so every member, new or already here, is asked once.
ALTER TABLE "Membership" ADD COLUMN "joinReason" TEXT,
ADD COLUMN "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "weeklyTime" TEXT,
ADD COLUMN "joinAnsweredAt" TIMESTAMP(3);
