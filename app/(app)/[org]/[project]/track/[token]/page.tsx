import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { feedbackTextLink, feedbackBackLink } from "@/components/feedback-portal-styles";
import { PublicContributorForm } from "@/components/public-contributor-form";
import { optionalUser } from "@/lib/auth-helpers";
import { publicSubmissionStatus } from "@/lib/public-submission-status";
import type { IdeaStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicReportProgress } from "@/components/public-report-progress";
import { stateLabel, statusLabel } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { findFeedbackProject, publicTrackingTokenHash } from "@/lib/public-projects";
import { publicFeedbackPath, publicIssueDetailPath } from "@/lib/public-project-paths";
import { feedbackSubmitterName } from "@/lib/public-feedback-ideas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track a public report", robots: { index: false, follow: false } };

const ideaStatusLabel: Record<IdeaStatus, string> = {
  open: "Awaiting triage",
  converted: "Converted to an issue",
  rejected: "Rejected",
  archived: "Archived",
};

export default async function PublicTrackingPage({ params, searchParams }: { params: Promise<{ org: string; project: string; token: string }>; searchParams: Promise<{ view?: string }> }) {
  const { org, project: projectSlug, token } = await params;
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) notFound();
  const ref = { orgSlug: org, projectSlug };
  const project = await findFeedbackProject(ref);
  if (!project) notFound();
  const backHref = publicFeedbackPath(ref);
  const idea = await prisma.idea.findFirst({
    where: { projectId: project.id, publicTrackingTokenHash: publicTrackingTokenHash(token), source: "public", isDeleted: false },
    select: {
      number: true,
      title: true,
      summary: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      reporter: { select: { name: true } },
      publicSubmission: { select: { user: { select: { name: true } } } },
      issue: { select: { number: true, status: true, substatus: true, updatedAt: true } },
    },
  });
  if (!idea) notFound();
  const trackingPath = `/${encodeURIComponent(org)}/${encodeURIComponent(projectSlug)}/track/${encodeURIComponent(token)}`;
  if ((await searchParams).view === "confirmation") {
    const user = await optionalUser();
    return <div className="mx-auto -mt-1 w-full max-w-[920px] sm:-mt-4 pb-6"><PublicContributorForm project={project} orgSlug={org} projectSlug={projectSlug} signedIn={Boolean(user)} returnHref={backHref} initialSubmission={{ title: idea.title, trackingPath, status: publicSubmissionStatus(idea) }} /></div>;
  }
  const state = idea.issue
    ? `Issue #${idea.issue.number} · ${idea.issue.substatus ? stateLabel(idea.issue.substatus) : statusLabel[idea.issue.status]}`
    : ideaStatusLabel[idea.status];
  return (
    <div className="mx-auto -mt-1 w-full max-w-[920px] sm:-mt-4 space-y-3 pb-6">
      <nav aria-label="Report navigation" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <Link href={backHref} className={feedbackBackLink}>← Back to {project.name} product</Link>
        <Link href={`${trackingPath}?view=confirmation`} className={feedbackTextLink}>View submission confirmation →</Link>
      </nav>
      <FeedbackPageHeader title="Track your report" identity={project.name} description={`Submitted by ${feedbackSubmitterName(idea)}`} />
      <PublicReportProgress title={idea.title} number={`Idea #${idea.number}`} state={state} summary={idea.summary} description={idea.description} createdAt={idea.createdAt} updatedAt={idea.issue?.updatedAt ?? idea.updatedAt} issue={idea.issue} inactive={idea.status === "rejected" || idea.status === "archived"} />
      {idea.issue && project.visibility === "public" ? <Link href={publicIssueDetailPath(ref, idea.issue.number)} className={`${feedbackTextLink} w-fit`}>View issue #{idea.issue.number}</Link> : null}
      <p className="text-center text-sm text-zk-muted">Keep your private tracking link to return to this page without signing in.</p>
    </div>
  );
}
