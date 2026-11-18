import type { Prisma, RedesignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { agentAttachmentUrl } from "@/lib/agent-api/attachment-read";
import { LIMIT_RANGE_ERROR, decodeCursor, pageSize, toPage, type IssueCursor } from "@/lib/agent-api/create-policy";
import { absoluteUrl } from "@/lib/site-url";
import { designPath, refOf } from "@/lib/project-paths";
import { DESIGN_VIEW_STATUSES, type DesignView } from "@/lib/design-view";

/**
 * Reading redesign proposals back (#9, the Design area): agents through
 * `GET /api/v1/redesigns[/{id}]`, people on `/<org>/<project>/design[/<id>]`.
 *
 * The boundary is the organisation (#user-agents): an agent reads proposals
 * in its own organisation only, in a project that isn't archived, as people
 * see them on the Design pages. Anything else is a 404, so a proposal in
 * another organisation looks the same as one that doesn't exist.
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
  project: { select: { slug: true, organisation: { select: { slug: true } } } },
} satisfies Prisma.RedesignProposalSelect;

type AgentProposalRow = Prisma.RedesignProposalGetPayload<{ select: typeof agentProposalSelect }>;

/** The proposal row as `POST /redesigns` returns it, plus its mockups and its Design page. */
function agentProposalJson({ attachments, project, ...proposal }: AgentProposalRow) {
  return {
    ...proposal,
    attachments: attachments.map((file) => ({ ...file, url: agentAttachmentUrl(file.id) })),
    designUrl: absoluteUrl(designPath(refOf(project), proposal.id)),
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

// ---------------------------------------------------------------------------
// The Design pages. The caller resolves access first (requireProject, then
// organisation membership); every read stays inside that organisation and project.
// ---------------------------------------------------------------------------

const designCardSelect = {
  id: true, title: true, body: true, previewUrl: true, status: true, bugId: true, createdAt: true, updatedAt: true, approvedAt: true,
  authorAgent: { select: { name: true, ownerUserId: true } },
  onBehalfOf: { select: { name: true } },
  approver: { select: { name: true } },
  bug: { select: { number: true, title: true } },
  attachments: { select: { id: true, filename: true, contentType: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.RedesignProposalSelect;

export type DesignCard = Prisma.RedesignProposalGetPayload<{ select: typeof designCardSelect }>;

export const DESIGN_PAGE_SIZE = 24;

/** The Design list: one filter's proposals, newest first, and how many each filter holds. */
export async function loadDesignList(scope: { organisationId: string; projectId: string }, view: DesignView, rawCursor?: string) {
  const cursor = decodeCursor(rawCursor);
  const statuses = DESIGN_VIEW_STATUSES[view];
  const [rows, grouped] = await Promise.all([
    prisma.redesignProposal.findMany({
      where: { ...scope, ...(statuses ? { status: { in: statuses } } : {}), ...afterCursor(cursor) },
      orderBy: newestFirst,
      take: DESIGN_PAGE_SIZE + 1,
      select: designCardSelect,
    }),
    prisma.redesignProposal.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
  ]);
  const count = (wanted: RedesignStatus[] | null) =>
    grouped.filter((row) => !wanted || wanted.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const counts = { waiting: count(DESIGN_VIEW_STATUSES.waiting), decided: count(DESIGN_VIEW_STATUSES.decided), all: count(null) } satisfies Record<DesignView, number>;
  return { ...toPage(rows, DESIGN_PAGE_SIZE), counts };
}

/** One proposal on its Design page, or null when it isn't this project's. */
export async function loadDesignProposal(scope: { organisationId: string; projectId: string }, id: string): Promise<DesignCard | null> {
  return prisma.redesignProposal.findFirst({ where: { id, ...scope }, select: designCardSelect });
}

/**
 * Where an old `/redesigns/<id>` link (Escalations, the approval email) now
 * opens: the proposal's Design page, for a member of its organisation. Null
 * when it doesn't exist, its project is archived, or the person isn't a member.
 */
export async function designAddressFor(user: { id: string; role?: string | null }, id: string): Promise<string | null> {
  // The site super admin may open any organisation's pages (lib/project-route.ts).
  const member = user.role === "super_admin" ? {} : { memberships: { some: { userId: user.id } } };
  const proposal = await prisma.redesignProposal.findFirst({
    where: { id, project: { archivedAt: null, organisation: { archivedAt: null, ...member } } },
    select: { id: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
  });
  return proposal ? designPath(refOf(proposal.project), proposal.id) : null;
}
