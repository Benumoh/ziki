import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findFeedbackProject } from "@/lib/public-projects";
import { publicOrgFeedbackPath } from "@/lib/public-project-paths";
import { PublicContributorForm } from "@/components/public-contributor-form";
import { NOINDEX } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share feedback", robots: NOINDEX };

export default async function ProjectFeedbackPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ org, project: projectSlug }, query] = await Promise.all([params, searchParams]);
  const ref = { orgSlug: org, projectSlug };
  const project = await findFeedbackProject(ref);
  if (!project) notFound();

  const orgFeedbackHref = publicOrgFeedbackPath(project.organisation.slug);

  return (
    <div className="mx-auto w-full max-w-5xl px-2 pb-10 sm:px-4">
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
          {project.organisation.name}
        </Link>
      </div>
      <PublicContributorForm
        project={project}
        orgSlug={project.organisation.slug}
        projectSlug={project.slug}
        kind={query.type === "problem" || query.type === "improvement" ? query.type : undefined}
        returnHref={orgFeedbackHref}
      />
    </div>
  );
}
