import { FeedbackProjectJoin } from "@/components/feedback-project-join";
import { listPublicFeedbackIdeas } from "@/lib/public-feedback-ideas";
import type { FeedbackSearch } from "@/components/project-feedback-portal";
import { PublicProductOverview } from "@/components/public-product-overview";
import { optionalUser } from "@/lib/auth-helpers";
import { PublicFeedbackIdeaDetail } from "@/components/public-feedback-idea-detail";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findFeedbackProject } from "@/lib/public-projects";
import { publicFeedbackPath } from "@/lib/public-project-paths";
import { PublicContributorForm } from "@/components/public-contributor-form";
import { NOINDEX } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share feedback", robots: NOINDEX };

export default async function ProjectFeedbackPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<FeedbackSearch & { type?: string; idea?: string; view?: string }>;
}) {
  const [{ org, project: projectSlug }, query] = await Promise.all([params, searchParams]);
  const ref = { orgSlug: org, projectSlug };
  const project = await findFeedbackProject(ref);
  if (!project) notFound();

  if (query.view === "join") return <FeedbackProjectJoin orgSlug={org} projectSlug={projectSlug} />;
  if (query.idea !== undefined) return <PublicFeedbackIdeaDetail project={ref} number={Number(query.idea)} />;
  if (query.view !== "share" && query.type !== "problem" && query.type !== "improvement") {
    const ideas = await listPublicFeedbackIdeas(org, { projectSlug, query: query.q?.trim().slice(0, 200), status: query.status, take: 7 });
    return <PublicProductOverview product={project} ideas={ideas} query={query.q} status={query.status} />;
  }
  const user = await optionalUser();
  const orgFeedbackHref = publicFeedbackPath(ref);

  return (
    <div className="w-full pb-6">
      <PublicContributorForm
        signedIn={Boolean(user)}
        project={project}
        orgSlug={project.organisation.slug}
        projectSlug={project.slug}
        kind={query.type === "problem" || query.type === "improvement" ? query.type : undefined}
        returnHref={orgFeedbackHref}
      />
    </div>
  );
}
