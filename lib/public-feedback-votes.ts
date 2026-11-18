import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { findPublicIssue } from "@/lib/public-issues";
import type { PublicProjectRef } from "@/lib/public-project-paths";

export const FEEDBACK_VISITOR_COOKIE = "ziki-feedback-visitor";
export function feedbackVisitorHash(visitor: string): string {
  return createHash("sha256").update(`public-feedback:${visitor}`).digest("hex");
}

/** Customer interest is independent of Vote, IdeaVerdict, importance and workflow gates. */
export async function publicFeedbackVoteState(ref: PublicProjectRef, number: number, visitor: string | null) {
  const data = await findPublicIssue(ref, number);
  if (!data) return null;
  const visitorHash = visitor ? feedbackVisitorHash(visitor) : null;
  const vote = visitorHash ? await prisma.publicFeedbackVote.findUnique({
      where: { bugId_visitorHash: { bugId: data.issue.id, visitorHash } }, select: { id: true },
    }) : null;
  return { bugId: data.issue.id, count: data.issue._count.publicFeedbackVotes, voted: Boolean(vote) };
}

export async function setPublicFeedbackVote(bugId: string, visitor: string, voted: boolean) {
  const visitorHash = feedbackVisitorHash(visitor);
  if (voted) {
    await prisma.publicFeedbackVote.upsert({
      where: { bugId_visitorHash: { bugId, visitorHash } },
      create: { bugId, visitorHash }, update: {},
    });
  } else {
    await prisma.publicFeedbackVote.deleteMany({ where: { bugId, visitorHash } });
  }
  return { count: await prisma.publicFeedbackVote.count({ where: { bugId } }), voted };
}
