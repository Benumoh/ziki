import type { Prisma, RedesignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { agentAttachmentUrl } from "@/lib/agent-api/attachment-read";
import { LIMIT_RANGE_ERROR, decodeCursor, pageSize, toPage, type IssueCursor } from "@/lib/agent-api/create-policy";

/**
 * Reading redesign proposals back (#9): agents through
 * `GET /api/v1/redesigns[/{id}]`. People compare and choose them on the
 * issue each one redesigns (its "Compare redesign proposals" section).
 *
 * The boundary is the organisation (#user-agents): an agent reads proposals
 * in its own organisation only, in a project that isn't archived. Anything
 * else is a 404, so a proposal in another organisation looks the same as one
 * that doesn't exist.
 */

export const REDESIGN_STATUSES = ["proposed", "approved", "rejected", "superseded"] as const satisfies readonly RedesignStatus[];

/** The query `GET /api/v1/redesigns` reads. Its MCP tool and CLI command send exactly these. */
export const REDESIGN_LIST_QUERY = ["projectId", "status", "mine", "limit", "cursor"] as const;

/** A proposal in a project people can still open: not archived, in an organisation that isn't. */
const openProject = { archivedAt: null, organisation: { archivedAt: null } } satisfies Prisma.ProjectWhereInput;

const newestFirst = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.RedesignProposalOrderByWithRelationInput[];

/** Proposals after `cursor`, newest first; the id breaks ties. */
function afterCursor(cursor: IssueCursor | null): Prisma.RedesignProposalWhereInput {
  if (!cursor) return {};
  return { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
}

export type RedesignListFilter = { status: RedesignStatus | null; mine: boolean; limit: number; cursor: IssueCursor | null };

/** `?status=&mine=&limit=&cursor=`: anything it can't read is a 400 naming the parameter, never silently ignored. */
export function parseRedesignListQuery(params: URLSearchParams): RedesignListFilter {
  const status = params.get("status");
  if (status && !(REDESIGN_STATUSES as readonly string[]).includes(status)) {
    throw new IssueApiError(400, `status must be one of ${REDESIGN_STATUSES.join(", ")}.`);
  }
  const mine = params.get("mine");
  if (mine !== null && !["1", "true", "0", "false"].includes(mine)) {
    throw new IssueApiError(400, "mine must be 1 or true (only this agent's proposals), or 0 or false.");
  }
  const limit = pageSize(params.get("limit"));
  if (limit === null) throw new IssueApiError(400, LIMIT_RANGE_ERROR);
  const rawCursor = params.get("cursor");
  const cursor = decodeCursor(rawCursor);
  if (rawCursor !== null && !cursor) throw new IssueApiError(400, "Invalid cursor.");
  return { status: status ? (status as RedesignStatus) : null, mine: mine === "1" || mine === "true", limit, cursor };
}

const agentProposalSelect = {
  id: true, organisationId: true, projectId: true, bugId: true, authorAgentId: true, onBehalfOfUserId: true,
  title: true, body: true, previewUrl: true, status: true, approverId: true, approvedAt: true, createdAt: true, updatedAt: true,
  // The mockups' details only: an agent reads the bytes at each one's `url` with its key.
  attachments: { select: { id: true, filename: true, contentType: true, size: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.RedesignProposalSelect;

type AgentProposalRow = Prisma.RedesignProposalGetPayload<{ select: typeof agentProposalSelect }>;

/** The proposal row as `POST /redesigns` returns it, plus its mockups. */
function agentProposalJson({ attachments, ...proposal }: AgentProposalRow) {
  return {
    ...proposal,
    attachments: attachments.map((file) => ({ ...file, url: agentAttachmentUrl(file.id) })),
  };
}

/** `GET /api/v1/redesigns`: one project's proposals, newest first, a page at a time. */
export async function listAgentRedesigns(agent: Pick<AgentContext, "agentId" | "organisationId">, params: URLSearchParams) {
  const projectId = params.get("projectId")?.trim();
  if (!projectId) throw new IssueApiError(400, PROJECT_ID_REQUIRED);
  const filter = parseRedesignListQuery(params);
  const project = await prisma.project.findFirst({
    where: { id: projectId, organisationId: agent.organisationId, ...openProject },
    select: { id: true },
  });
  if (!project) throw new IssueApiError(404, "Project not found.");
  const rows = await prisma.redesignProposal.findMany({
    where: {
      organisationId: agent.organisationId,
      projectId: project.id,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.mine ? { authorAgentId: agent.agentId } : {}),
      ...afterCursor(filter.cursor),
    },
    orderBy: newestFirst,
    take: filter.limit + 1,
    select: agentProposalSelect,
  });
  const page = toPage(rows, filter.limit);
  return { items: page.items.map(agentProposalJson), nextCursor: page.nextCursor };
}

/** `GET /api/v1/redesigns/{id}`: one proposal in the agent's organisation, or a 404. */
export async function getAgentRedesign(agent: Pick<AgentContext, "organisationId">, id: string) {
  const row = await prisma.redesignProposal.findFirst({
    where: { id, organisationId: agent.organisationId, project: openProject },
    select: agentProposalSelect,
  });
  if (!row) throw new IssueApiError(404, "Proposal not found.");
  return { proposal: agentProposalJson(row) };
}
