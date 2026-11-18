import { IssuesList } from "../issues/_list/issues-list";
import { queryOf } from "../issues/_list/route-page";
import Link from "next/link";
import { FeedbackPortalPopover } from "@/components/feedback-portal-popover";
import { requireProject } from "@/lib/project-route";
import { projectPath } from "@/lib/project-paths";

export const metadata = { title: "Ideas" };

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/<slug>/ideas`: new ideas, the project's landing list (#project-urls). A search here looks through them. */
export default async function IdeasPage({ params, searchParams }: Props) {
  const { org, project } = await params;
  const query = await searchParams;
  const context = await requireProject(org, project);
  return <>
    {context.canContribute ? (
      <div className="mx-auto mb-3 flex max-w-6xl items-center justify-end gap-2">
        <FeedbackPortalPopover
          orgSlug={context.project.orgSlug}
          projectSlug={context.project.slug}
          projectName={context.project.name}
        />
        <Link href={projectPath(context.project.ref, "/features")} className="rounded-lg border border-zk-border px-3 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip">Feature plans</Link>
      </div>
    ) : null}
    <IssuesList org={org} slug={project} status="ideas" returnTo={`/${org}/${project}/ideas${queryOf(query)}`} searchParams={Promise.resolve(query)} />
  </>;
}
