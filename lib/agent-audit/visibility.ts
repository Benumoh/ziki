import { Prisma } from "@prisma/client";

/**
 * Who can read the agent audit log (#447).
 *
 * A tenant owner or admin (and the site's super admin) reads every row. An
 * agent owner reads their own agents' rows and nothing of another owner's.
 * Any other member gets 403, so nobody else ever sees raw payloads.
 */

export type AuditViewer = {
  /** Owner or admin of the current tenant, or the site's super admin. */
  isTenantAdmin: boolean;
  /** The current tenant, or null when the viewer belongs to none. */
  tenantId: string | null;
  /** Ids of the agents this viewer owns in that tenant. */
  ownedAgentIds: ReadonlyArray<string>;
};

export type AuditAccess =
  | { kind: "all"; tenantId: string }
  | { kind: "own-agents"; tenantId: string; agentIds: ReadonlyArray<string> }
  | { kind: "forbidden" };

export function auditAccess(viewer: AuditViewer): AuditAccess {
  if (!viewer.tenantId) return { kind: "forbidden" };
  if (viewer.isTenantAdmin) return { kind: "all", tenantId: viewer.tenantId };
  if (viewer.ownedAgentIds.length > 0) {
    return { kind: "own-agents", tenantId: viewer.tenantId, agentIds: [...viewer.ownedAgentIds] };
  }
  return { kind: "forbidden" };
}

export type AuditFilters = {
  agentId?: string | null;
  issueId?: string | null;
  /** Include the supplementary per-request rows (hidden by default, #575). */
  includeRequests?: boolean;
};

/**
 * The `where` for the rows `access` may read, narrowed by the page's agent and
 * issue filters. Visibility is applied in the query, so rows a viewer may not
 * see never leave the database. Throws for `forbidden`: check that first.
 *
 * Every write also logs a supplementary request row (`payload.request`), so
 * the domain row and the request row would read as the same action twice
 * (#575). Those request rows are excluded unless asked for.
 */
export function auditWhere(access: AuditAccess, filters: AuditFilters = {}): Prisma.AgentAuditEventWhereInput {
  if (access.kind === "forbidden") throw new Error("auditWhere called without access");
  const where: Prisma.AgentAuditEventWhereInput = { tenantId: access.tenantId };
  const allowedAgents = access.kind === "own-agents" ? access.agentIds : null;

  if (filters.agentId) {
    // An agent owner filtering by someone else's agent sees nothing, not that agent's rows.
    where.agentId = allowedAgents && !allowedAgents.includes(filters.agentId)
      ? { in: [] }
      : filters.agentId;
  } else if (allowedAgents) {
    where.agentId = { in: [...allowedAgents] };
  }
  if (filters.issueId) where.bugId = filters.issueId;
  if (!filters.includeRequests) {
    // Domain rows have no `request` key, so the path reads as SQL NULL and a
    // bare NOT would drop them too (NOT (NULL = true) is NULL): keep them explicitly.
    where.OR = [
      { payload: { path: ["request"], equals: Prisma.AnyNull } },
      { NOT: { payload: { path: ["request"], equals: true } } },
    ];
  }
  return where;
}
