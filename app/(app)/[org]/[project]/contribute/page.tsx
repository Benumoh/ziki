import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findPublicProject } from "@/lib/public-projects";
import { publicFeedbackPath } from "@/lib/public-project-paths";
import { PublicContributorForm } from "@/components/public-contributor-form";
import { NOINDEX } from "@/lib/seo/site";
import { optionalUser } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share feedback", robots: NOINDEX };

export default async function PublicContributePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ org, project: projectSlug }, query] = await Promise.all([params, searchParams]);
  const ref = { orgSlug: org, projectSlug };
  const project = await findPublicProject(ref, { requireGuestIntake: true });
  if (!project) notFound();
  const user = await optionalUser();

  return (
    <div className="mx-auto w-full max-w-[920px] pb-10">
      <div className="mb-3">
        <Link
          href={publicFeedbackPath(ref)}
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
          {project.name} feedback
        </Link>
      </div>
      <PublicContributorForm project={project} orgSlug={org} projectSlug={projectSlug} signedIn={Boolean(user)} kind={query.type === "problem" || query.type === "improvement" ? query.type : undefined} />
    </div>
  );
}
