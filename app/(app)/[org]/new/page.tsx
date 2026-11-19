import { requireOrgList } from "@/lib/project-route";
import { IssuesList } from "../[project]/issues/_list/issues-list";
import { queryOf } from "../[project]/issues/_list/route-page";

export const metadata = { title: "Ideas" };

type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/<org>/new`: new ideas across every project of the organisation (#project-filter). */
export default async function OrgIdeasPage({ params, searchParams }: Props) {
  const { org } = await params;
  const query = await searchParams;
  const resolved = await requireOrgList(org, `/${org}/new${queryOf(query)}`);
  return <IssuesList org={resolved.org} slug={resolved.project} everyProject status="ideas" returnTo={`/${org}/new${queryOf(query)}`} searchParams={Promise.resolve(query)} />;
}
