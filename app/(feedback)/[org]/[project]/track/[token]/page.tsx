import { FeedbackDetail, feedbackDetailSelect } from "@/components/feedback-detail";
import { PublicContributorForm } from "@/components/public-contributor-form";
import { optionalUser } from "@/lib/auth-helpers";
import { publicSubmissionStatus } from "@/lib/public-submission-status";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findFeedbackProject, publicTrackingTokenHash } from "@/lib/public-projects";
import { publicFeedbackPath, publicIssueDetailPath } from "@/lib/public-project-paths";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track a public report", robots: { index: false, follow: false } };

export default async function PublicTrackingPage({ params, searchParams }: { params: Promise<{ org: string; project: string; token: string }>; searchParams: Promise<{ view?: string }> }) {
  const { org, project: projectSlug, token } = await params;
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) notFound();
  const ref = { orgSlug: org, projectSlug };
  const project = await findFeedbackProject(ref);
  if (!project) notFound();
  const backHref = publicFeedbackPath(ref);
  const idea = await prisma.idea.findFirst({
    where: { projectId: project.id, publicTrackingTokenHash: publicTrackingTokenHash(token), source: "public", isDeleted: false },
    select: feedbackDetailSelect,
  });
  if (!idea) notFound();
  const trackingPath = `/${encodeURIComponent(org)}/${encodeURIComponent(projectSlug)}/track/${encodeURIComponent(token)}`;
  if ((await searchParams).view === "confirmation") {
    const user = await optionalUser();
    return <div className="w-full pb-6"><PublicContributorForm project={project} orgSlug={org} projectSlug={projectSlug} signedIn={Boolean(user)} returnHref={backHref} initialSubmission={{ title: idea.title, trackingPath, status: publicSubmissionStatus(idea) }} /></div>;
  }
  return <FeedbackDetail idea={idea} trackingPath={trackingPath} confirmationHref={`${trackingPath}?view=confirmation`} issueHref={idea.issue && project.visibility === "public" ? publicIssueDetailPath(ref, idea.issue.number) : undefined} />;
}
