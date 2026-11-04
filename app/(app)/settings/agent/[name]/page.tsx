import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { AGENT_INSTRUCTIONS_MAX, AGENT_MESSAGE_MAX, listAgentThread } from "@/lib/agent-messages";
import { auditWhere } from "@/lib/agent-audit/visibility";
import { isTenantAdmin } from "@/lib/agents/membership";
import { settableLevels } from "@/lib/agents/levels";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { LocalTime } from "@/components/local-time";
import { issueHref } from "@/lib/issue-ref";
import { InstructionsForm, SendMessageForm } from "./message-forms";
import { AgentActivity, AgentProfileCard, type AgentActivityItem, type AgentProfileData } from "./agent-profile";
import { AgentSettingsForm } from "./agent-settings-form";
import { AgentAvatarPicker } from "./agent-avatar-picker";
import { AgentCapacity } from "./agent-capacity";
import { agentsLink, agentsMutedClass, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Agent" };

/** How many recent actions the profile lists. */
const ACTIVITY_LIMIT = 20;

/** The name as it arrived, and decoded in case it arrived still encoded. */
function nameCandidates(raw: string): string[] {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A stray "%" that isn't an escape: the raw name is the only candidate.
  }
  return [...new Set([raw, decoded])];
}

/**
 * The agent this address names in the viewer's workspace: the viewer's own
 * first, then a teammate's (which only a team admin may then open). Names can
 * repeat on older agents, so an active agent wins, then the newest.
 */
async function findAgentIdByName(viewerId: string, rawName: string): Promise<string | null> {
  const tenantId = await currentTenantIdFor(viewerId);
  if (!tenantId) return null;
  const names = nameCandidates(rawName);
  const orderBy = [{ revokedAt: { sort: "asc" as const, nulls: "first" as const } }, { createdAt: "desc" as const }];
  const own = await prisma.agent.findFirst({
    where: { tenantId, ownerUserId: viewerId, name: { in: names } },
    orderBy,
    select: { id: true },
  });
  if (own) return own.id;
  const teammates = await prisma.agent.findFirst({
    where: { tenantId, name: { in: names } },
    orderBy,
    select: { id: true },
  });
  return teammates?.id ?? null;
}

/**
 * The agent's profile and latest activity. Call it only after the viewer has
 * passed listAgentThread's check (owner or team admin), the same people the
 * audit log shows this agent's actions to.
 */
async function loadAgentProfile(
  agentId: string,
  viewerId: string,
): Promise<{ agent: AgentProfileData; activity: AgentActivityItem[]; tenantId: string } | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      model: true,
      avatar: true,
      level: true,
      revokedAt: true,
      createdAt: true,
      ownerUserId: true,
      reputation: true,
      owner: { select: { name: true, email: true } },
      apiKeys: { select: { lastUsedAt: true, revokedAt: true, project: { select: { name: true } } } },
    },
  });
  if (!agent) return null;

  const [filed, claims, comments, events] = await Promise.all([
    prisma.bug.count({ where: { createdByAgentId: agentId } }),
    prisma.issueClaim.count({ where: { agentId } }),
    prisma.comment.count({ where: { agentId } }),
    prisma.agentAuditEvent.findMany({
      where: auditWhere({ kind: "own-agents", tenantId: agent.tenantId, agentIds: [agentId] }, { agentId }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        createdAt: true,
        action: true,
        target: true,
        undoneAt: true,
        bug: { select: { id: true, number: true, title: true, project: { select: { slug: true } } } },
      },
    }),
  ]);

  const lastUsed = agent.apiKeys
    .map((key) => key.lastUsedAt?.getTime() ?? 0)
    .reduce((latest, time) => Math.max(latest, time), 0);
  const projects = [
    ...new Set(agent.apiKeys.filter((key) => !key.revokedAt && key.project).map((key) => key.project!.name)),
  ];

  return {
    tenantId: agent.tenantId,
    agent: {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      avatar: agent.avatar,
      level: agent.level,
      revokedAt: agent.revokedAt,
      createdAt: agent.createdAt,
      ownerName: agent.ownerUserId === viewerId ? null : (agent.owner.name ?? agent.owner.email),
      lastActiveAt: lastUsed ? new Date(lastUsed) : null,
      projects,
      counts: { filed, claims, comments },
      reputation: agent.reputation,
    },
    activity: events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      action: event.action,
      target: event.target,
      bug: event.bug,
      undone: event.undoneAt !== null,
    })),
  };
}

/** One agent's page, at /settings/agent/{name}: profile, settings, activity, instructions and conversation. */
export default async function AgentPage({ params }: { params: Promise<{ name: string }> }) {
  if (!isAgentPlatformEnabled()) notFound();
  const user = await requireUser();
  const { name } = await params;
  const agentId = await findAgentIdByName(user.id, name);
  if (!agentId) notFound();
  const thread = await listAgentThread(user, agentId);
  if (!thread) notFound();
  const profile = await loadAgentProfile(agentId, user.id);
  if (!profile) notFound();
  const viewerIsAdmin = await isTenantAdmin(user, profile.tenantId);
  const levels = settableLevels({
    isOwner: thread.isOwner,
    isTenantAdmin: viewerIsAdmin,
  });
  // How often it may call Ziki: moved here from the My agents list, where its jargon got in the way.
  const capacity = await prisma.agent.findUnique({ where: { id: agentId }, select: { burst: true, burstUntil: true } });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/agents" className={`text-sm ${agentsLink}`}>
        ← Back to agents
      </Link>

      <AgentProfileCard
        agent={profile.agent}
        title={
          <h1 className="break-words text-3xl font-extrabold tracking-tight text-zk-text">{thread.agent.name}</h1>
        }
        avatarControl={
          thread.agent.revoked ? null : (
            <AgentAvatarPicker agentId={agentId} agentName={profile.agent.name} avatar={profile.agent.avatar} />
          )
        }
        settings={
          thread.agent.revoked ? null : (
            <AgentSettingsForm
              agentId={agentId}
              name={profile.agent.name}
              level={profile.agent.level}
              levels={levels}
            />
          )
        }
      />

      <AgentActivity items={profile.activity} />

      {capacity && !thread.agent.revoked && (thread.isOwner || viewerIsAdmin) && (viewerIsAdmin || capacity.burst) ? (
        <section className={`${agentsSurface} p-4 sm:p-6`} aria-labelledby="capacity-heading">
          <h2 id="capacity-heading" className="text-sm font-bold uppercase tracking-[0.06em] text-zk-muted">
            How often it can call Ziki
          </h2>
          <div className="mt-2">
            <AgentCapacity
              agentId={agentId}
              agentName={profile.agent.name}
              burst={capacity.burst}
              burstUntil={capacity.burstUntil ? capacity.burstUntil.toISOString() : null}
              now={new Date().toISOString()}
              canSetBurst={viewerIsAdmin}
            />
          </div>
        </section>
      ) : null}

      {thread.isOwner && !thread.agent.revoked ? (
        <section className={`${agentsSurface} p-4 sm:p-6`} aria-labelledby="instructions-heading">
          <h2 id="instructions-heading" className="text-sm font-bold uppercase tracking-[0.06em] text-zk-muted">
            Instructions
          </h2>
          <p className={`mt-2 ${agentsMutedClass}`}>
            A standing brief the agent reads from <code className="font-mono text-xs">GET /api/v1/agents/me</code>.
          </p>
          <div className="mt-3">
            <InstructionsForm
              agentId={thread.agent.id}
              instructions={thread.instructions}
              maxLength={AGENT_INSTRUCTIONS_MAX}
            />
          </div>
        </section>
      ) : null}

      <section className={`${agentsSurface} p-4 sm:p-6`} aria-labelledby="thread-heading">
        <h2 id="thread-heading" className="text-sm font-bold uppercase tracking-[0.06em] text-zk-muted">
          Conversation
        </h2>
        <p className={`mt-2 ${agentsMutedClass}`}>
          Messages reach the agent through its inbox.{" "}
          {thread.isOwner
            ? "Its questions to you appear here too."
            : "Questions it asks go to its owner and aren't shown here."}
        </p>
        {thread.entries.length === 0 ? (
          <p className={`mt-3 ${agentsMutedClass}`}>Nothing yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {thread.entries.map((entry) =>
              entry.kind === "question" ? (
                <li key={`question-${entry.id}`} className="rounded-[16px] border border-zk-border bg-zk-chip/40 p-4">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-zk-muted">
                    <span>
                      <span className="font-semibold text-zk-text">{thread.agent.name}</span> asked
                      {entry.bug ? (
                        <>
                          {" "}about{" "}
                          <Link href={issueHref(entry.bug)} className={agentsLink}>
                            {entry.bug.title}
                          </Link>
                        </>
                      ) : null}
                    </span>
                    <LocalTime date={entry.createdAt} />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text">{entry.body}</p>
                  {entry.answeredAt ? (
                    <div className="mt-2 border-t border-zk-divider pt-2">
                      <p className="text-xs text-zk-muted">
                        You answered <LocalTime date={entry.answeredAt} />
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text">{entry.answer}</p>
                    </div>
                  ) : (
                    <Link href={`/inbox/escalations/${entry.id}`} className={`mt-2 inline-block text-sm ${agentsLink}`}>
                      Answer →
                    </Link>
                  )}
                </li>
              ) : (
                <li key={`message-${entry.id}`} className="rounded-[16px] border border-zk-border bg-zk-tint/70 p-4 sm:ml-8">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-zk-muted">
                    <span>
                      <span className="font-semibold text-zk-text">
                        {entry.from.id === user.id ? "You" : entry.from.name}
                      </span>{" "}
                      wrote{entry.readAt ? " · read" : ""}
                    </span>
                    <LocalTime date={entry.createdAt} />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zk-text">{entry.body}</p>
                </li>
              ),
            )}
          </ol>
        )}
        {thread.agent.revoked ? (
          <p className={`mt-4 ${agentsMutedClass}`}>This agent is revoked, so it can&apos;t receive messages.</p>
        ) : (
          <div className="mt-4 border-t border-zk-divider pt-4">
            <SendMessageForm agentId={thread.agent.id} maxLength={AGENT_MESSAGE_MAX} />
          </div>
        )}
      </section>
    </div>
  );
}
