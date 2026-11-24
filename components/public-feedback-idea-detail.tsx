import { notFound } from "next/navigation";
import { FeedbackDetail, feedbackDetailSelect } from "@/components/feedback-detail";
import { listPublicFeedbackIdeas } from "@/lib/public-feedback-ideas";
import { prisma } from "@/lib/prisma";
import type { PublicProjectRef } from "@/lib/public-project-paths";
export async function PublicFeedbackIdeaDetail({ project, number }: { project: PublicProjectRef; number: number }) {
  if (!Number.isSafeInteger(number) || number < 1) notFound();
  const [visible] = await listPublicFeedbackIdeas(project.orgSlug, { projectSlug: project.projectSlug, number });
  if (!visible) notFound();
  const idea = await prisma.idea.findFirst({ where: { number, project: { slug: project.projectSlug, organisation: { slug: project.orgSlug } }, source: "public", isDeleted: false }, select: feedbackDetailSelect });
  if (!idea) notFound();
  return <FeedbackDetail idea={idea} />;
}
