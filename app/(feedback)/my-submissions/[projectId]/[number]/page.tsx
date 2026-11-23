import { FeedbackDetail, feedbackDetailSelect } from "@/components/feedback-detail";
import { PublicContributorForm } from "@/components/public-contributor-form";
import { publicFeedbackPath } from "@/lib/public-project-paths";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { publicSubmissionStatus } from "@/lib/public-submission-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My submission", robots: { index: false, follow: false } };
export default async function MySubmissionPage({ params, searchParams }: { params: Promise<{ projectId: string; number: string }>; searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser();
  const { projectId, number } = await params;
  if (!/^[1-9]\d{0,9}$/.test(number)) notFound();
  const row = await prisma.publicSubmission.findFirst({
    where: { userId: user.id, idea: { projectId, number: Number(number), source: "public", isDeleted: false } },
    select: { idea: { select: feedbackDetailSelect } },
  });
  if (!row) notFound();
  const { idea } = row;
  const submissionPath = `/my-submissions/${encodeURIComponent(projectId)}/${idea.number}`;
  if ((await searchParams).view === "confirmation") {
    const ref = { orgSlug: idea.project.organisation.slug, projectSlug: idea.project.slug };
    return <div className="w-full pb-6"><PublicContributorForm project={idea.project} {...ref} signedIn privateTracking={false} returnHref={publicFeedbackPath(ref)} initialSubmission={{ title: idea.title, trackingPath: submissionPath, status: publicSubmissionStatus(idea) }} /></div>;
  }
  return <FeedbackDetail idea={idea} confirmationHref={`${submissionPath}?view=confirmation`} />;
}
