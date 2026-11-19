import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { issuesPath, orgRef, overviewPlaceFor, statusFromSegment } from "@/lib/project-paths";
import { requireOrgList } from "@/lib/project-route";
import { IssuesList } from "../../[project]/issues/_list/issues-list";
import { queryOf } from "../../[project]/issues/_list/route-page";
import { generateMetadata as projectListMetadata } from "../../[project]/issues/[status]/page";

type Props = {
  params: Promise<{ org: string; status: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { status } = await params;
  return projectListMetadata({ params: Promise.resolve({ org: "", project: "", status }) });
}

/**
 * `/<org>/issues/<status>`: an issue list across every project of the organisation, the lists' default
 * (#project-filter). A project's own pages under `issues/` (new, history, bulk close, export) are the
 * default project's.
 */
export default async function OrgIssuesStatusPage({ params, searchParams }: Props) {
  const { org, status: segment } = await params;
  const query = await searchParams;
  const resolved = await requireOrgList(org, `/${org}/issues/${segment}${queryOf(query)}`);
  const status = statusFromSegment(segment);
  if (!status) redirect(`/${encodeURIComponent(resolved.org)}/${encodeURIComponent(resolved.project)}/issues/${segment}${queryOf(query)}`);
  // A stage (open, in progress, delivered, …) is a tab and Status filter on the Overview now (#work-feed).
  if (status !== "your_work" && overviewPlaceFor(status)) redirect(issuesPath(orgRef(org), status));
  return (
    <IssuesList
      org={resolved.org}
      slug={resolved.project}
      everyProject
      status={status}
      returnTo={`/${org}/issues/${segment}${queryOf(query)}`}
      searchParams={Promise.resolve(query)}
    />
  );
}
