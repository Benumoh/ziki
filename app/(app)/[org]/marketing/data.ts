import "server-only";
import type { Prisma } from "@prisma/client";
import { HOME_GROUP_LIMIT, HOME_GROUPS, type HomeTaskGroup, type HomeTaskItem, type HomeTaskType, type MarketingHomeData } from "@/components/marketing/home/model";
import { duplicatesWhere } from "@/lib/duplicates";
import { formatIssueNumber } from "@/lib/issue-number";
import { issueHref } from "@/lib/issue-ref";
import { stateLabel } from "@/lib/labels";
import { MARKETING_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";
import { ideaPath, refOf } from "@/lib/project-paths";
import type { ProjectContext } from "@/lib/project-route";

/**
 * The Marketing home (#marketing-agent-home): the organisation's active marketing
 * task types with the organisation's work in each, and the picked type's tasks and
 * ideas grouped by where they are. No type picked, or an unknown one: the first.
 */
export async function readMarketingHome({ organisationId }: ProjectContext, typeId: string | null): Promise<MarketingHomeData> {
  // Marketing belongs to the organisation (#org-marketing): its home shows every project's marketing work.
  const issueScope: Prisma.BugWhereInput = { organisationId, isDeleted: false, ...MARKETING_TRACK, ...duplicatesWhere(false) };
  const ideaScope: Prisma.IdeaWhereInput = { organisationId, isDeleted: false, ...MARKETING_TRACK, status: "open" };
  const [typeRows, issueCounts, ideaCounts] = await Promise.all([
    prisma.issueType.findMany({
      where: { organisationId, ...MARKETING_TRACK, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, goal: true },
    }),
    prisma.bug.groupBy({ by: ["typeId"], where: issueScope, _count: { _all: true } }),
    prisma.idea.groupBy({ by: ["typeId"], where: ideaScope, _count: { _all: true } }),
  ]);
  const countOf = (id: string) =>
    (issueCounts.find((row) => row.typeId === id)?._count._all ?? 0) + (ideaCounts.find((row) => row.typeId === id)?._count._all ?? 0);
  const types: HomeTaskType[] = typeRows.map((type) => ({ ...type, count: countOf(type.id) }));
  // No type, or an unknown one: the Overview (#marketing-overview), every type together.
  const selected = types.find((type) => type.id === typeId) ?? null;
  const overview = !selected;
  if (types.length === 0) return { types, selected: null, overview, groups: [], assets: [] };
  const ofType = selected ? { typeId: selected.id } : { typeId: { in: types.map((type) => type.id) } };

  const take = HOME_GROUP_LIMIT;
  const groups = await Promise.all(HOME_GROUPS.map(async ({ key, heading }): Promise<HomeTaskGroup> => {
    if (key === "ideas") {
      const where = { ...ideaScope, ...ofType };
      const [rows, total] = await Promise.all([
        prisma.idea.findMany({ where, orderBy: { updatedAt: "desc" }, take, select: { id: true, number: true, title: true, updatedAt: true, assetId: true, type: { select: { name: true } }, reporter: { select: { name: true } }, project: { select: { slug: true, organisation: { select: { slug: true } } } } } }),
        prisma.idea.count({ where }),
      ]);
      return {
        key,
        heading,
        more: Math.max(0, total - rows.length),
        items: rows.map((row) => ({ id: row.id, title: row.title, href: ideaPath(refOf(row.project), row.number), label: "Waiting for votes", agentName: row.reporter.name, updatedAt: row.updatedAt, ref: formatIssueNumber(row.number), assetId: row.assetId, typeName: row.type?.name ?? null })),
      };
    }
    const where = { ...issueScope, ...ofType, status: key };
    const [rows, total] = await Promise.all([
      prisma.bug.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take,
        select: {
          id: true, number: true, title: true, substatus: true, updatedAt: true, assetId: true, type: { select: { name: true } },
          project: { select: { slug: true, organisation: { select: { slug: true } } } },
          claims: { where: { status: { in: ["active", "offered"] }, releasedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { agent: { select: { name: true } } } },
          deliveries: { orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1, select: { agent: { select: { name: true } } } },
        },
      }),
      prisma.bug.count({ where }),
    ]);
    return {
      key,
      heading,
      more: Math.max(0, total - rows.length),
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        href: issueHref(row),
        label: stateLabel(row.substatus),
        agentName: row.claims[0]?.agent.name ?? row.deliveries[0]?.agent.name ?? null,
        updatedAt: row.updatedAt,
        ref: formatIssueNumber(row.number),
        assetId: row.assetId,
        typeName: row.type?.name ?? null,
      })),
    };
  }));
  // The assets (#marketing-assets), each listed with the work on it: the type's, or every type's on the Overview.
  const assetRows = await prisma.marketingAsset.findMany({
    where: { organisationId, ...ofType },
    orderBy: { name: "asc" },
    select: { id: true, name: true, updatedAt: true, typeId: true, score: true, scoreNote: true, type: { select: { name: true } } },
  });
  const assets = assetRows.map(({ type, ...asset }) => ({ ...asset, typeName: type.name }));
  return { types, selected, overview, groups: groups.filter((group) => group.items.length > 0), assets };
}


/** One asset's page (#marketing-assets): the asset, its type, and all the work on it, newest first. */
export type MarketingAssetPage = {
  asset: { id: string; name: string; url: string | null; typeId: string; typeName: string; score: number | null; scoreNote: string | null; scoredAt: Date | null };
  items: (HomeTaskItem & { groupKey: string; groupHeading: string })[];
};

export async function readMarketingAsset({ organisationId }: ProjectContext, assetId: string): Promise<MarketingAssetPage | null> {
  const asset = await prisma.marketingAsset.findFirst({
    where: { id: assetId, organisationId },
    select: { id: true, name: true, url: true, typeId: true, score: true, scoreNote: true, scoredAt: true, type: { select: { name: true } } },
  });
  if (!asset) return null;
  const heading = (key: string) => HOME_GROUPS.find((group) => group.key === key)?.heading ?? key;
  const [bugs, ideas] = await Promise.all([
    prisma.bug.findMany({
      where: { organisationId, assetId, isDeleted: false, ...MARKETING_TRACK, ...duplicatesWhere(false) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true, number: true, title: true, status: true, substatus: true, updatedAt: true,
        project: { select: { slug: true, organisation: { select: { slug: true } } } },
        claims: { where: { status: { in: ["active", "offered"] }, releasedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { agent: { select: { name: true } } } },
        deliveries: { orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1, select: { agent: { select: { name: true } } } },
      },
    }),
    // Ideas still waiting for votes; a converted one is its issue above.
    prisma.idea.findMany({
      where: { organisationId, assetId, isDeleted: false, ...MARKETING_TRACK, status: "open" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 200,
      select: { id: true, number: true, title: true, updatedAt: true, reporter: { select: { name: true } }, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
    }),
  ]);
  const items = [
    ...bugs.map((row) => ({
      id: row.id, title: row.title, href: issueHref(row), label: stateLabel(row.substatus),
      agentName: row.claims[0]?.agent.name ?? row.deliveries[0]?.agent.name ?? null, updatedAt: row.updatedAt,
      ref: formatIssueNumber(row.number), assetId, typeName: asset.type.name, groupKey: row.status, groupHeading: heading(row.status),
    })),
    ...ideas.map((row) => ({
      id: row.id, title: row.title, href: ideaPath(refOf(row.project), row.number), label: "Waiting for votes",
      agentName: row.reporter.name, updatedAt: row.updatedAt, ref: formatIssueNumber(row.number), assetId, typeName: asset.type.name,
      groupKey: "ideas", groupHeading: heading("ideas"),
    })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return {
    asset: { id: asset.id, name: asset.name, url: asset.url, typeId: asset.typeId, typeName: asset.type.name, score: asset.score, scoreNote: asset.scoreNote, scoredAt: asset.scoredAt },
    items,
  };
}
