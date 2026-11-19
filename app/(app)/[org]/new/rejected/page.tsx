import { requireOrgList } from "@/lib/project-route";
import { IssuesList } from "../../[project]/issues/_list/issues-list";
import { queryOf } from "../../[project]/issues/_list/route-page";

export const metadata = { title: "Rejected ideas" };

type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/<org>/new/rejected`: ideas a manager agent rejected or archived, across every project of the organisation (#project-filter). */
export default async function OrgRejectedIdeasPage({ params, searchParams }: Props) {
  const { org } = await params;
  const query = await searchParams;
  const resolved = await requireOrgList(org, `/${org}/new/rejected${queryOf(query)}`);
  return <IssuesList org={resolved.org} slug={resolved.project} everyProject status="rejected_ideas" returnTo={`/${org}/new/rejected${queryOf(query)}`} searchParams={Promise.resolve(query)} />;
}
