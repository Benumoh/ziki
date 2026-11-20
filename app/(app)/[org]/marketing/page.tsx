import type { Metadata } from "next";
import { MarketingChat } from "@/components/marketing/home/marketing-chat";
import { MarketingHome } from "@/components/marketing/home/marketing-home";
import type { MarketingHomeData } from "@/components/marketing/home/model";
import { LoadError } from "@/components/load-error";
import { logLoadFailure } from "@/lib/load-error";
import { prisma } from "@/lib/prisma";
import { projectRef } from "@/lib/project-paths";
import { requireOrgMarketing, requireProject } from "@/lib/project-route";
import { toSingleQueryParam } from "@/lib/search";
import { queryOf } from "../[project]/issues/_list/route-page";
import { readMarketingHome } from "./data";

export const metadata: Metadata = { title: "Marketing" };

type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `/<org>/marketing`: where Marketing opens (#marketing-agent-home, #org-marketing). Marketing belongs to the
 * organisation, not a project: the marketing task types across the top (`?type=` picks one), the picked type's
 * work from every project, and the marketing agent above it. The agent
 * works on the organisation's main project's site, and tasks filed from it go there.
 */
export default async function OrgMarketingPage({ params, searchParams }: Props) {
  const { org } = await params;
  const query = await searchParams;
  const resolved = await requireOrgMarketing(org, queryOf(query));
  const context = await requireProject(resolved.org, resolved.project);
  const typeId = toSingleQueryParam(query.type) ?? null;
  const project = await prisma.project.findUnique({ where: { id: context.project.id }, select: { siteUrl: true, marketingUrl: true } });
  let data: MarketingHomeData;
  try {
    data = await readMarketingHome(context, typeId);
  } catch (error) {
    return <LoadError title="Marketing could not be loaded" reference={logLoadFailure("[marketing home] query failed", error)} />;
  }
  const slug = projectRef(resolved.org, resolved.project);
  // The chat, then the work, in one column like the main list.
  return (
    <div className="mx-auto w-full max-w-[920px]">
      <MarketingChat slug={slug} projectId={context.project.id} siteUrl={project?.marketingUrl ?? project?.siteUrl ?? null} />
      <MarketingHome slug={slug} data={data} status={toSingleQueryParam(query.status) ?? null} />
    </div>
  );
}
