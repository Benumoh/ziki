import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectContext } from "@/lib/project-route";
import { workflowFor } from "@/lib/workflow";
import { archiveReasonLabel, IDEA_WITHDRAWN_REASON } from "@/lib/idea-archive";
import { calculatePagination } from "@/lib/pagination";
import type { RejectedIdea, RejectedIdeaOpinion, RejectedIdeaVerdict, RejectedIdeasResult } from "@/components/marketing/rejected-ideas/model";
import { activeIn } from "@/lib/agents/active-in";

/**
 * Marketing ideas that left the Ideas tab: rejected or archived, as the product
 * Ideas > Rejected list reads them. The caller resolves access with
 * requireProject first; every read stays inside that organisation and project and only
 * reads the marketing track.
 */
export async function readRejectedIdeas(
  { project, organisationId }: ProjectContext,
  page?: string | string[] | number,
): Promise<RejectedIdeasResult> {
  const where = {
    organisationId,
    projectId: project.id,
    isDeleted: false,
    track: "marketing",
    status: { in: ["rejected", "archived"] },
  } satisfies Prisma.IdeaWhereInput;

  const [total, workflow] = await Promise.all([prisma.idea.count({ where }), workflowFor(project.id)]);
  const pagination = calculatePagination({ page, totalCount: total });
  const rows = await prisma.idea.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: pagination.skip,
    take: pagination.take,
    select: {
      id: true,
      number: true,
      title: true,
      summary: true,
      rationale: true,
      status: true,
      score: true,
      createdAt: true,
      rejectedAt: true,
      rejectedByAgentId: true,
      archivedAt: true,
      archivedByAgentId: true,
      archiveReason: true,
      archiveDuplicateOf: true,
      type: { select: { name: true } },
      reporter: { select: { name: true } },
      verdicts: {
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          opinion: true,
          votes: true,
          summary: true,
          description: true,
          updatedAt: true,
          onBehalfOf: { select: { name: true } },
          agent: { select: { name: true } },
        },
      },
    },
  });

  // The agents named by a rejection or archive are stored by id.
  const deciderIds = [...new Set(rows.flatMap((row) => [row.rejectedByAgentId, row.archivedByAgentId]).filter((id): id is string => Boolean(id)))];
  const deciders = deciderIds.length
    ? await prisma.agent.findMany({ where: { id: { in: deciderIds }, ...activeIn(organisationId) }, select: { id: true, name: true } })
    : [];
  const deciderName = new Map(deciders.map((agent) => [agent.id, agent.name]));

  const items: RejectedIdea[] = rows.map((row) => {
    const verdicts: RejectedIdeaVerdict[] = row.verdicts.map((verdict) => ({
      id: verdict.id,
      opinion: verdict.opinion as RejectedIdeaOpinion,
      votes: verdict.votes,
      summary: verdict.summary,
      description: verdict.description,
      by: verdict.onBehalfOf.name ?? "Someone",
      agentName: verdict.agent?.name ?? null,
      updatedAt: verdict.updatedAt,
    }));
    const votes: Record<RejectedIdeaOpinion, number> = { good: 0, bad: 0, neutral: 0 };
    for (const verdict of row.verdicts) votes[verdict.opinion as RejectedIdeaOpinion] += verdict.votes;
    const withdrawn = row.archiveReason === IDEA_WITHDRAWN_REASON;
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      summary: row.summary,
      rationale: row.rationale,
      typeName: row.type?.name ?? null,
      reporterName: row.reporter?.name ?? null,
      createdAt: row.createdAt,
      score: row.score,
      threshold: workflow.ideaThreshold,
      votes,
      verdicts,
      status: row.status as RejectedIdea["status"],
      rejectedAt: row.rejectedAt,
      rejectedBy: row.rejectedAt ? deciderName.get(row.rejectedByAgentId ?? "") ?? "a manager agent" : null,
      archivedAt: row.archivedAt,
      archivedBy: row.archivedAt ? (withdrawn ? "its owner" : deciderName.get(row.archivedByAgentId ?? "") ?? "a manager agent") : null,
      archiveReason: row.archiveReason ? archiveReasonLabel(row.archiveReason, row.archiveDuplicateOf) : null,
    };
  });

  return {
    ok: true,
    items,
    total,
    page: pagination.page,
    totalPages: pagination.totalPages,
    from: pagination.from,
    to: pagination.to,
  };
}
