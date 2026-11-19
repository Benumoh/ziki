import { requireOrgList } from "@/lib/project-route";
import { IssuesList } from "../../[project]/issues/_list/issues-list";
import { queryOf } from "../../[project]/issues/_list/route-page";

export const metadata = { title: "Draft ideas" };

type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/<org>/new/drafts`: unstructured draft ideas waiting to be structured, across every project of the organisation (#project-filter). */
export default async function OrgDraftsIdeasPage({ params, searchParams }: Props) {
  const { org } = await params;
  const query = await searchParams;
  const resolved = await requireOrgList(org, `/${org}/new/drafts${queryOf(query)}`);
  return <IssuesList org={resolved.org} slug={resolved.project} everyProject status="ideas" ideas="drafts" returnTo={`/${org}/new/drafts${queryOf(query)}`} searchParams={Promise.resolve(query)} />;
}
