import { MarketingHome } from "@/components/marketing/home/marketing-home";
import type { MarketingHomeData } from "@/components/marketing/home/model";
import { LoadError } from "@/components/load-error";
import { logLoadFailure } from "@/lib/load-error";
import { prisma } from "@/lib/prisma";
import { projectRef } from "@/lib/project-paths";
import { requireProject } from "@/lib/project-route";
import { toSingleQueryParam } from "@/lib/search";
import { readMarketingHome } from "./data";

export const metadata = { title: "Marketing" };

type Props = {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `/<slug>/marketing`: where the section opens (#marketing-agent-home). The
 * marketing task types across the top (`?type=` picks one), the picked type's
 * goal and work, and the marketing agent in a sidebar (everyone in the project, for now).
 * Anyone in the project can open it; the full tasks board is at `/marketing/tasks`.
 */
export default async function MarketingHomePage({ params, searchParams }: Props) {
  const { org, project: projectSlug } = await params;
  const context = await requireProject(org, projectSlug);
  const typeId = toSingleQueryParam((await searchParams).type) ?? null;
  const project = await prisma.project.findUnique({ where: { id: context.project.id }, select: { siteUrl: true } });
  let data: MarketingHomeData;
  try {
    data = await readMarketingHome(context, typeId);
  } catch (error) {
    return <LoadError title="Marketing could not be loaded" reference={logLoadFailure("[marketing home] query failed", error)} />;
  }
  return <MarketingHome slug={projectRef(org, projectSlug)} projectId={context.project.id} siteUrl={project?.siteUrl ?? null} data={data} />;
}
