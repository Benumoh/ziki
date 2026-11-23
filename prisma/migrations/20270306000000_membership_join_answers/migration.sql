-- Join questions (#join-questions): what a member without an agent is good at, and when they were asked.
-- Null `joinAnsweredAt` means still to ask, so every member, new or already here, is asked once.
ALTER TABLE "Membership" ADD COLUMN "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "joinAnsweredAt" TIMESTAMP(3);
