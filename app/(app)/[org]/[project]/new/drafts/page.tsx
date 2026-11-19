import { IssuesList } from "../../issues/_list/issues-list";
import { queryOf } from "../../issues/_list/route-page";

export const metadata = { title: "Draft ideas" };

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/<slug>/new/drafts`: unstructured draft ideas waiting to be structured (#project-urls). */
export default async function DraftIdeasPage({ params, searchParams }: Props) {
  const { org, project } = await params;
  const query = await searchParams;
  return <IssuesList org={org} slug={project} status="ideas" ideas="drafts" returnTo={`/${org}/${project}/new/drafts${queryOf(query)}`} searchParams={Promise.resolve(query)} />;
}
