import type { Metadata } from "next";
import { IssuesList } from "../issues/_list/issues-list";
import { queryOf } from "../issues/_list/route-page";

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Your work" };

/** `/<org>/<project>/overview`: one project's Overview (#overview-url). Its tabs and Status filter are the work's stages (#work-feed). */
export default async function ProjectOverviewPage({ params, searchParams }: Props) {
  const { org, project } = await params;
  const query = await searchParams;
  return <IssuesList org={org} slug={project} status="your_work" returnTo={`/${org}/${project}/overview${queryOf(query)}`} searchParams={Promise.resolve(query)} />;
}
