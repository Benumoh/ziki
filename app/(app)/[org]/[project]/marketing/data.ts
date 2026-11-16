import "server-only";
import type { Prisma, Status } from "@prisma/client";
import type { IdeaListRow } from "@/components/ideas-list";
import { HOME_GROUP_LIMIT, HOME_GROUPS, type HomeTaskGroup, type HomeTaskType, type MarketingHomeData } from "@/components/marketing/home/model";
import { TASK_TABS, type TaskRow, type TasksBoardData, type TaskView } from "@/components/marketing/tasks/model";
import { duplicatesWhere } from "@/lib/duplicates";
import { ideaVotes, isBadIdea } from "@/lib/idea-rejection";
import { ideaVoteTotals, NO_VOTES } from "@/lib/idea-vote-totals";
import { issueHref } from "@/lib/issue-ref";
import { stateLabel } from "@/lib/labels";
import { getBugOrderBy } from "@/lib/issues-sort";
import { getIdeaOrderBy } from "@/lib/list-sort";
import { MARKETING_TRACK } from "@/lib/marketing/track";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { calculatePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { ideaPath } from "@/lib/project-paths";
import type { ProjectContext } from "@/lib/project-route";
import { workflowFor } from "@/lib/workflow";

/**
 * Where delivered work rests. A claim can be released after delivering, so the
 * delivery says who did it. Work reopened for bids isn't here: its last worker
 * has no part in it any more.
 */
const DELIVERED_STATUSES: Status[] = ["done", "resolved", "closed"];

/** The caller must resolve access with requireProject; every read stays in that organisation and project. */
export async function readTasksBoard({ project, organisationId, user }: ProjectContext, view: TaskView): Promise<TasksBoardData> {
  const issueScope: Prisma.BugWhereInput = {
    organisationId,
    projectId: project.id,
    isDeleted: false,
    ...MARKETING_TRACK,
    ...duplicatesWhere(false),
  };
  const proposalScope: Prisma.IdeaWhereInput = {
    organisationId,
    projectId: project.id,
    isDeleted: false,
    ...MARKETING_TRACK,
    status: "open",
  };

  const [grouped, proposed, workflow] = await Promise.all([
    prisma.bug.groupBy({ by: ["status"], where: issueScope, _count: { _all: true } }),
    prisma.idea.count({ where: proposalScope }),
    workflowFor(project.id),
  ]);
  const counts = Object.fromEntries(TASK_TABS.map((tab) => [
    tab.param,
    tab.status === null ? proposed : (grouped.find((row) => row.status === tab.status)?._count._all ?? 0),
  ])) as TasksBoardData["counts"];

  const { tab } = view;
  const pagination = calculatePagination({ page: view.page ?? undefined, totalCount: counts[tab.param] });
  const paging = { skip: pagination.skip, take: pagination.take };

  let list: TasksBoardData["list"];
  if (tab.status === null) {
    const threshold = workflow.ideaThreshold;
    const rows = await prisma.idea.findMany({
      where: proposalScope,
      orderBy: getIdeaOrderBy(view.proposalSort),
      ...paging,
      select: {
        id: true, number: true, title: true, score: true, createdAt: true, updatedAt: true,
        // Its newest verdict, for the Last update column.
        verdicts: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
        reporter: { select: { name: true } },
        _count: { select: { verdicts: true } },
      },
    });
    const ids = rows.map((row) => row.id);
    const [totals, mine] = await Promise.all([
      ideaVoteTotals(prisma, ids),
      prisma.ideaVerdict.findMany({ where: { ideaId: { in: ids }, onBehalfOfUserId: user.id }, select: { ideaId: true } }),
    ]);
    const approvedByMe = new Set(mine.map((verdict) => verdict.ideaId));
    const ideas: IdeaListRow[] = rows.map((row) => {
      const votes = totals.get(row.id) ?? NO_VOTES;
      const newestVerdict = row.verdicts[0]?.updatedAt;
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        score: row.score,
        threshold,
        createdAt: row.createdAt,
        reporterName: row.reporter.name,
        verdicts: row._count.verdicts,
        good: votes.good,
        badVotes: votes.bad,
        bad: isBadIdea(ideaVotes([{ opinion: "good", votes: votes.good }, { opinion: "bad", votes: votes.bad }, { opinion: "neutral", votes: votes.neutral }]), threshold),
        approvedByMe: approvedByMe.has(row.id),
        lastUpdateAt: newestVerdict && newestVerdict > row.updatedAt ? newestVerdict : row.updatedAt,
      };
    });
    list = { kind: "proposals", ideas, sort: view.proposalSort };
  } else {
    const tasks = await prisma.bug.findMany({
      where: { ...issueScope, status: tab.status },
      orderBy: getBugOrderBy(view.taskSort),
      ...paging,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        substatus: true,
        closeReason: true,
        voteCount: true,
        revisionCount: true,
        updatedAt: true,
        reward: true,
        rewardEstimateCount: true,
        rewardFixedAt: true,
        project: { select: { slug: true, organisation: { select: { slug: true } } } },
        type: { select: { name: true } },
        assignee: { select: { name: true } },
        // The claim working on it, or an offer waiting to be accepted.
        claims: {
          where: { status: { in: ["active", "offered"] }, releasedAt: null },
          orderBy: { createdAt: "desc" },
          take: 2,
          select: { status: true, claimedAt: true, createdAt: true, agent: { select: { name: true } }, beneficiary: { select: { name: true } } },
        },
        deliveries: { orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1, select: { agent: { select: { name: true } } } },
        _count: { select: { comments: true, bids: { where: OPEN_BID_WHERE } } },
      },
    });
    const rows: TaskRow[] = tasks.map((task) => {
      const active = task.claims.find((claim) => claim.status === "active");
      const offer = task.claims.find((claim) => claim.status === "offered");
      const deliverer = DELIVERED_STATUSES.includes(task.status) ? task.deliveries[0]?.agent.name : null;
      return {
        id: task.id,
        number: task.number,
        title: task.title,
        href: issueHref(task),
        status: task.status,
        substatus: task.substatus,
        closeReason: task.closeReason,
        importance: task.voteCount,
        reward: Number(task.reward),
        rewardEstimates: task.rewardEstimateCount,
        rewardFixed: Boolean(task.rewardFixedAt),
        typeName: task.type?.name ?? null,
        agentName: active?.agent.name ?? offer?.agent.name ?? deliverer ?? null,
        work: active || task.status === "in_progress"
          ? { person: active?.beneficiary.name ?? task.assignee?.name ?? null, since: active ? (active.claimedAt ?? active.createdAt) : null }
          : null,
        offeredTo: task.substatus === "open" && offer ? (offer.beneficiary.name ?? "someone") : null,
        revision: task.status === "in_progress" && task.revisionCount > 0 ? `Revision ${task.revisionCount} of ${workflow.revisionLimit}` : null,
        bids: task._count.bids,
        comments: task._count.comments,
        updatedAt: task.updatedAt,
      };
    });
    list = { kind: "tasks", rows, sort: view.taskSort };
  }

  return {
    tab,
    counts,
    sortParam: view.sortParam,
    list,
    pagination: {
      page: pagination.page,
      totalPages: pagination.totalPages,
      totalCount: pagination.totalCount,
      from: pagination.from,
      to: pagination.to,
    },
  };
}

/**
 * The Marketing home (#marketing-agent-home): the organisation's active marketing
 * task types with this project's work in each, and the picked type's tasks and
 * ideas grouped by where they are. No type picked, or an unknown one: the first.
 */
export async function readMarketingHome({ project, organisationId }: ProjectContext, typeId: string | null): Promise<MarketingHomeData> {
  const issueScope: Prisma.BugWhereInput = { organisationId, projectId: project.id, isDeleted: false, ...MARKETING_TRACK, ...duplicatesWhere(false) };
  const ideaScope: Prisma.IdeaWhereInput = { organisationId, projectId: project.id, isDeleted: false, ...MARKETING_TRACK, status: "open" };
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
  const selected = types.find((type) => type.id === typeId) ?? types[0] ?? null;
  if (!selected) return { types, selected: null, groups: [] };

  const take = HOME_GROUP_LIMIT;
  const groups = await Promise.all(HOME_GROUPS.map(async ({ key, heading }): Promise<HomeTaskGroup> => {
    if (key === "ideas") {
      const where = { ...ideaScope, typeId: selected.id };
      const [rows, total] = await Promise.all([
        prisma.idea.findMany({ where, orderBy: { updatedAt: "desc" }, take, select: { id: true, number: true, title: true, updatedAt: true, reporter: { select: { name: true } } } }),
        prisma.idea.count({ where }),
      ]);
      return {
        key,
        heading,
        more: Math.max(0, total - rows.length),
        items: rows.map((row) => ({ id: row.id, title: row.title, href: ideaPath(project.ref, row.number), label: "Waiting for votes", agentName: row.reporter.name, updatedAt: row.updatedAt })),
      };
    }
    const where = { ...issueScope, typeId: selected.id, status: key };
    const [rows, total] = await Promise.all([
      prisma.bug.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take,
        select: {
          id: true, number: true, title: true, substatus: true, updatedAt: true,
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
      })),
    };
  }));
  return { types, selected, groups: groups.filter((group) => group.items.length > 0) };
}
