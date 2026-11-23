import type { Metadata } from "next";
import { requireOrgList } from "@/lib/project-route";
import { IssuesList } from "../[project]/issues/_list/issues-list";
import { queryOf } from "../[project]/issues/_list/route-page";

type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Your work" };

/**
 * `/<org>/overview`: the Overview across every project of the organisation (#overview-url), where every list link
 * lands. Its tabs and Status filter are the work's stages (#work-feed).
 */
export default async function OrgOverviewPage({ params, searchParams }: Props) {
  const { org } = await params;
  const query = await searchParams;
  const resolved = await requireOrgList(org, `/${org}/overview${queryOf(query)}`);
  return (
    <IssuesList
      org={resolved.org}
      slug={resolved.project}
      everyProject
      status="your_work"
      returnTo={`/${org}/overview${queryOf(query)}`}
      searchParams={Promise.resolve(query)}
    />
  );
}
