import { prisma } from "@/lib/prisma";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { projectFirstTarget, requireOrg } from "@/lib/project-route";
import { issuesPath, orgRef } from "@/lib/project-paths";
import { NewProjectButton } from "./new-project-form";
import { organisationSoloBlock, SOLO_BLOCK_MESSAGE } from "@/lib/projects/solo";

type Props = { params: Promise<{ org: string }> };

export const metadata = { title: "Projects" };

/**
 * `/<org>` opens the organisation's work: a project's Overview, whose lists
 * show every project by default (#project-filter). There is no separate
 * projects page; the Projects list lives in the organisation's settings. With
 * no project yet, it offers to create the first one.
 *
 * An old `/<project>` address (from before organisations were in URLs,
 * #project-urls) goes on to that project's issue list.
 */
export default async function OrganisationHome({ params }: Props) {
  const { org } = await params;
  const { user, organisation } = await requireOrg(org);
  if (!organisation) {
    const target = await projectFirstTarget(user, `/${org}/ideas`);
    if (target) permanentRedirect(target);
    notFound();
  }
  const first = await prisma.project.findFirst({
    where: { organisationId: organisation.id, archivedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  // The Overview across every project (#project-filter).
  if (first) redirect(issuesPath(orgRef(organisation.slug), "your_work"));
  // #solo: a new project can be Solo only while nobody else works in the organisation.
  const soloBlocked = await organisationSoloBlock(prisma, organisation.id);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 py-16 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">No projects yet</h1>
      <p className="text-sm text-zk-text2">
        A project is one product inside {organisation.name}, such as a web app. Create the first one to start.
      </p>
      <div className="flex justify-center">
        <NewProjectButton orgSlug={organisation.slug} soloBlockedReason={soloBlocked ? SOLO_BLOCK_MESSAGE[soloBlocked] : null} />
      </div>
    </div>
  );
}
