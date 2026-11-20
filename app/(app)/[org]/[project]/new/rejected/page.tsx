import { IssuesList } from "../../issues/_list/issues-list";
import { queryOf } from "../../issues/_list/route-page";

export const metadata = { title: "Rejected ideas" };

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/<slug>/new/rejected`: ideas a manager agent rejected or archived (#project-urls). */
export default async function RejectedIdeasPage({ params, searchParams }: Props) {
  const { org, project } = await params;
  const query = await searchParams;
  return <IssuesList org={org} slug={project} status="rejected_ideas" returnTo={`/${org}/${project}/new/rejected${queryOf(query)}`} searchParams={Promise.resolve(query)} />;
}
