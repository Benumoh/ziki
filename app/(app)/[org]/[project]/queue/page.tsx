import { WorkQueue } from "./work-queue";

export const metadata = { title: "Work queue" };

/** `/<org>/<project>/queue`: the work queue for one project (#work-queue). */
export default async function ProjectWorkQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org, project } = await params;
  return <WorkQueue org={org} slug={project} query={await searchParams} />;
}
