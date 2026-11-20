import { requireOrgList } from "@/lib/project-route";
import { queryOf } from "../[project]/issues/_list/route-page";
import { WorkQueue } from "../[project]/queue/work-queue";

export const metadata = { title: "Work queue" };

/** `/<org>/queue`: the work queue across every project of the organisation, its default (#work-queue, #project-filter). */
export default async function OrgWorkQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org } = await params;
  const query = await searchParams;
  const resolved = await requireOrgList(org, `/${org}/queue${queryOf(query)}`);
  return <WorkQueue org={resolved.org} slug={resolved.project} everyProject query={query} />;
}
