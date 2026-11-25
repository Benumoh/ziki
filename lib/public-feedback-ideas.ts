import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { optionalUser } from "@/lib/auth-helpers";

const feedbackIdeaSelect = {
  number: true, title: true, summary: true, description: true,
  status: true, score: true, createdAt: true, updatedAt: true,
  reporter: { select: { name: true } },
  publicSubmission: { select: { user: { select: { name: true } } } },
  type: { select: { name: true } },
  issue: { select: { status: true, substatus: true } },
  project: { select: { name: true, slug: true, workflow: { select: { ideaThreshold: true } } } },
  verdicts: { select: { opinion: true, votes: true } },
  _count: { select: { verdicts: true } },
} satisfies Prisma.IdeaSelect;

export type FeedbackIdea = Prisma.IdeaGetPayload<{ select: typeof feedbackIdeaSelect }>;

/** Only customer-submitted feedback on public projects is listed externally.
 * Private reports remain reachable through their private tracking links.
 * Agent verdicts are read here; this portal never casts them on a visitor's behalf.
 */
type FeedbackOptions = {
  projectSlug?: string; projectSlugs?: string[]; query?: string; number?: number; status?: string; skip?: number; take?: number;
};
async function feedbackWhere(orgSlug: string, options: FeedbackOptions): Promise<Prisma.IdeaWhereInput> {
  const user = await optionalUser();
  const visibleProject: Prisma.ProjectWhereInput = {
    archivedAt: null,
    ...(options.projectSlug ? { slug: options.projectSlug } : options.projectSlugs ? { slug: { in: options.projectSlugs } } : {}),
    ...(user?.role === "super_admin" ? {} : { OR: [
      { visibility: "public" },
      ...(user ? [
        { memberships: { some: { userId: user.id } } },
        { organisation: { memberships: { some: { userId: user.id } } } },
      ] : []),
    ] }),
  };
  return {
      source: "public", isDeleted: false, track: "product",
      ...(["open", "converted", "rejected", "archived"].includes(options.status ?? "") ? { status: options.status as "open" | "converted" | "rejected" | "archived" } : {}),
      securityFinding: { is: null },
      organisation: { slug: orgSlug, archivedAt: null },
      project: visibleProject,
      ...(options.number !== undefined ? { number: options.number } : {}),
      ...(options.query ? { OR: [
        { title: { contains: options.query, mode: "insensitive" } },
        { summary: { contains: options.query, mode: "insensitive" } },
      ] } : {}),
  };
}
export async function listPublicFeedbackIdeas(orgSlug: string, options: FeedbackOptions = {}): Promise<FeedbackIdea[]> {
  return prisma.idea.findMany({
    where: await feedbackWhere(orgSlug, options),
    select: feedbackIdeaSelect,
    orderBy: [{ createdAt: "desc" }, { number: "desc" }],
    skip: options.skip ?? 0,
    take: options.take ?? 50,
  });
}

export async function countPublicFeedbackIdeas(orgSlug: string, options: FeedbackOptions = {}): Promise<number> {
  return prisma.idea.count({ where: await feedbackWhere(orgSlug, options) });
}

export function feedbackSubmitterName(idea: Pick<FeedbackIdea, "reporter" | "publicSubmission">): string {
  const accountName = idea.publicSubmission?.user.name?.trim();
  if (accountName) return accountName;
  const name = idea.reporter.name?.trim();
  return name && !/ public reporter$/i.test(name) ? name : "Guest";
}
