import type { FeedbackSearch } from "@/components/project-feedback-portal";
import { PublicProductOverview } from "@/components/public-product-overview";
import { optionalUser } from "@/lib/auth-helpers";
import { PublicFeedbackIdeaDetail } from "@/components/public-feedback-idea-detail";
import type { Metadata } from "next";
import Link from "next/link";
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
  searchParams: Promise<FeedbackSearch & { type?: string; idea?: string }>;
}) {
  const [{ org, project: projectSlug }, query] = await Promise.all([params, searchParams]);
  const ref = { orgSlug: org, projectSlug };
  const project = await findFeedbackProject(ref);
  if (!project) notFound();

  if (query.idea !== undefined) return <PublicFeedbackIdeaDetail project={ref} number={Number(query.idea)} />;
  if (query.type !== "problem" && query.type !== "improvement") return <PublicProductOverview product={project} />;
  const user = await optionalUser();
  const orgFeedbackHref = publicFeedbackPath(ref);

  return (
    <div className="mx-auto w-full max-w-[920px] pb-10">
      <div className="mb-3">
        <Link
          href={orgFeedbackHref}
          className="inline-flex min-h-8 items-center gap-2 text-base font-semibold text-zk-accent hover:underline"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {project.name} product
        </Link>
      </div>
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
