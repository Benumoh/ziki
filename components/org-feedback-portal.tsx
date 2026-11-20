"use client";

import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { feedbackTextLink, feedbackBackLink } from "@/components/feedback-portal-styles";

import { PortalSearch } from "@/components/portal-search";
import { useState } from "react";
import Link from "next/link";
import { publicFeedbackPath } from "@/lib/public-project-paths";

export type OrgFeedbackProjectCardItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  platforms?: string[];
};

export function OrgFeedbackPortal({
  orgSlug,
  orgName,
  projects,
  initialQuery = "",
  returnHref,
}: {
  orgSlug: string;
  orgName: string;
  projects: OrgFeedbackProjectCardItem[];
  initialQuery?: string;
  returnHref?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const needle = query.trim().toLowerCase();
  const filtered = projects.filter(project =>
    (!needle || [project.name, project.description, project.slug].some(value => value.toLowerCase().includes(needle)))
  );

  return (
    <div className="mx-auto -mt-1 w-full max-w-[920px] pb-6 sm:-mt-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <Link
            href={returnHref ?? `/${encodeURIComponent(orgSlug)}`}
            className={feedbackBackLink}
          >
            <span aria-hidden="true">←</span> {returnHref === "/discover" ? "Back to Discover" : "Back to projects"}
          </Link>
          <FeedbackPageHeader title="Feedback portal" identity={orgName} description="Choose a project to browse its feedback, report a problem, or suggest an improvement." />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-8 flex-1 items-center"><PortalSearch label="Search projects" placeholder="Search by project name…" value={query} onValueChange={setQuery} /></div>
          <Link href={`/${encodeURIComponent(orgSlug)}/feedback?view=ideas`} className={feedbackTextLink}>View all feedback ideas →</Link>
        </div>


        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-zk-border bg-zk-surface p-10 text-center">
            <h2 className="text-base font-semibold text-zk-text">No projects found</h2>
            <p className="mt-1 text-sm text-zk-text2">
              {needle
                ? "Try searching with a different project name."
                : "No projects are available for feedback right now."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zk-border bg-zk-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">Products available in the {orgName} feedback portal</caption>
                <thead className="border-b border-zk-border bg-zk-chip/50 text-xs font-semibold text-zk-text2">
                  <tr><th scope="col" className="px-5 py-3 sm:w-1/4">Product</th><th scope="col" className="hidden px-5 py-3 sm:table-cell">About</th><th scope="col" className="w-[148px] px-5 py-3 text-left">Explore</th></tr>
                </thead>
                <tbody className="divide-y divide-zk-divider">
                  {filtered.map(project => (
                    <tr key={project.id} className="transition hover:bg-zk-chip/40">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex items-center gap-3">
                          <div>
                            <Link href={publicFeedbackPath({ orgSlug, projectSlug: project.slug })} className="rounded-sm text-sm font-semibold text-zk-text hover:text-zk-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent">{project.name}</Link>
                            <p className="mt-1 line-clamp-2 max-w-48 text-xs text-zk-muted sm:hidden">{project.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden max-w-sm px-5 py-4 align-middle text-sm leading-6 text-zk-text2 sm:table-cell"><p className="line-clamp-2">{project.description}</p></td>
                      <td className="whitespace-nowrap px-5 py-4 text-left align-middle">
                        <Link href={publicFeedbackPath({ orgSlug, projectSlug: project.slug })} aria-label={`View details for ${project.name}`} className={feedbackTextLink}>View details <span aria-hidden="true">→</span></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
