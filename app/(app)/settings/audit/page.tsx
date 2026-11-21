import Link from "next/link";
import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isOrganisationAdminRole } from "@/lib/agents/membership";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { auditAccess, auditWhere } from "@/lib/agent-audit/visibility";
import { AuditLog, type AuditLogRow } from "@/components/audit-log";
import { undoAuditEventAction } from "@/app/actions/audit";
import { parseIssueRef } from "@/lib/duplicates";
import { issueHref } from "@/lib/issue-ref";
import { AUDIT_PAGE_SIZE, auditPageHref, splitAuditPage } from "@/lib/agent-audit/paging";
import { activeIn } from "@/lib/agents/active-in";

export const metadata = { title: "Agent audit log" };

type Props = {
  searchParams: Promise<{
    agent?: string | string[];
    issue?: string | string[];
    before?: string | string[];
    show?: string | string[];
  }>;
};

const single = (value: string | string[] | undefined): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim() : null;
};

/**
 * Every agent action in the organisation (#447), for its owners and admins, and for
 * an agent's owner limited to their own agents. Optional: nothing links here
 * by force. Rows start collapsed; "Show more" opens one row's details.
 */
export default async function AuditLogPage({ searchParams }: Props) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  const membership = organisationId
    ? await prisma.membership.findUnique({
        where: { organisationId_userId: { organisationId, userId: user.id } },
        select: { role: true },
      })
    : null;
  const organisation = organisationId ? { organisationId, role: membership?.role } : null;
  const owned = organisation
    ? await prisma.agent.findMany({
        where: { ownerUserId: user.id, ...activeIn(organisation.organisationId) },
        select: { id: true },
      })
    : [];

  const access = auditAccess({
    isAdminOfOrganisation: isOrganisationAdminRole(organisation?.role, user.role),
    organisationId: organisation?.organisationId ?? null,
    ownedAgentIds: owned.map((a) => a.id),
  });
  if (access.kind === "forbidden") forbidden();

  const params = await searchParams;
  const agentId = single(params.agent);
  const issueInput = single(params.issue);
  const before = single(params.before);
  // Request rows are hidden by default so each action reads once (#575).
  const includeRequests = single(params.show) === "requests";

  // #576: the issue filter takes "#123", "123", an issue link or an id.
  const ref = issueInput ? parseIssueRef(issueInput) : null;
  const issueId =
    ref && "number" in ref
      ? ((
          await prisma.bug.findFirst({
            where: { number: ref.number, organisationId: access.organisationId },
            select: { id: true },
          })
        )?.id ?? null)
      : (ref?.id ?? issueInput); // anything else is taken as an internal id, as before
  // A filter that names no issue in this organisation matches nothing, not everything.
  const noSuchIssue = Boolean(issueInput) && !issueId;

  const [events, agents] = await Promise.all([
    noSuchIssue
      ? []
      : prisma.agentAuditEvent.findMany({
          where: auditWhere(access, { agentId, issueId, includeRequests }),
          // id breaks ties so the cursor never skips or repeats a row.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: AUDIT_PAGE_SIZE + 1,
          ...(before ? { cursor: { id: before }, skip: 1 } : {}),
          select: {
            id: true,
            createdAt: true,
            action: true,
            target: true,
            agentId: true,
            bugId: true,
            payload: true,
            undoneAt: true,
            agent: { select: { name: true } },
            bug: { select: { number: true, title: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } } },
          },
        }),
    // Only the agents this viewer may filter by.
    prisma.agent.findMany({
      where:
        access.kind === "all"
          ? activeIn(access.organisationId)
          : { ...activeIn(access.organisationId), id: { in: [...access.agentIds] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const { page, olderCursor } = splitAuditPage(events);
  const rows: AuditLogRow[] = page.map((event) => ({
    id: event.id,
    createdAt: event.createdAt,
    agentName: event.agent.name,
    action: event.action,
    target: event.bug ? `#${event.bug.number} ${event.bug.title}` : event.target,
    issueHref: event.bug ? issueHref(event.bug) : null,
    agentId: event.agentId,
    bugId: event.bugId,
    payload: event.payload,
    undoneAt: event.undoneAt,
  }));
  const filtered = Boolean(agentId || issueInput || includeRequests);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-10">
      <div>
        <Link href="/settings?section=agents" className="inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-zk-accent hover:underline">
          Back to settings
        </Link>
        <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">Agent audit log</h1>
        <p className="text-sm text-zk-muted">
          {access.kind === "all"
            ? "Every agent action in this organisation, newest first."
            : "Your agents' actions, newest first."}
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-panel border border-zk-border bg-zk-surface p-5">
        <label className="text-sm">
          <span className="block font-bold text-zk-text">Agent</span>
          <select
            name="agent"
            defaultValue={agentId ?? ""}
            className="mt-1 min-h-11 rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text"
          >
            <option value="">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 pb-1 text-sm text-zk-text2">
          <input
            type="checkbox"
            name="show"
            value="requests"
            defaultChecked={includeRequests}
            className="h-4 w-4 rounded border-zk-border accent-electric-blue-strong"
          />
          Show request rows
        </label>
        <label className="text-sm">
          <span className="block font-bold text-zk-text">Issue</span>
          <input
            name="issue"
            defaultValue={issueInput ?? ""}
            placeholder="#123 or any issue"
            className="mt-1 min-h-11 rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white hover:brightness-105"
        >
          Filter
        </button>
        {filtered ? (
          <Link href="/settings/audit" className="py-2 text-sm font-bold text-zk-accent hover:underline">
            Clear
          </Link>
        ) : null}
      </form>

      <section className="rounded-panel border border-zk-border bg-zk-surface px-5">
        <AuditLog
          rows={rows}
          isAdminOfOrganisation={access.kind === "all"}
          onUndo={undoAuditEventAction}
        />
      </section>
      {noSuchIssue ? (
        <p className="text-sm text-zk-muted">No issue matches “{issueInput}” in this organisation.</p>
      ) : null}
      {before || olderCursor ? (
        <nav aria-label="Audit log pages" className="flex items-center justify-between text-sm">
          {before ? (
            <Link
              href={auditPageHref({
                agent: agentId,
                issue: issueInput,
                show: includeRequests ? "requests" : undefined,
              })}
              className="font-semibold text-zk-accent hover:underline"
            >
              ← Newest
            </Link>
          ) : (
            <span />
          )}
          {olderCursor ? (
            <Link
              href={auditPageHref({
                agent: agentId,
                issue: issueInput,
                before: olderCursor,
                show: includeRequests ? "requests" : undefined,
              })}
              className="font-medium font-semibold text-zk-accent hover:underline"
            >
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
