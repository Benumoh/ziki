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
import { AgentActivity, AgentProfileHeader, AgentSideCard, AgentStats, type AgentActivityItem, type AgentProfileData } from "./agent-profile";
import { AgentReviews, type AgentReview } from "./agent-reviews";
import { AgentTabs, type AgentTab } from "./agent-tabs";
import { AgentEditDialog } from "./agent-edit-dialog";
import { AgentProfileForm } from "./agent-profile-form";
import { agentPicturePath, readAgentProfile } from "@/lib/agents/profile";
import { AgentSettingsForm } from "./agent-settings-form";
import { AgentAvatarPicker } from "./agent-avatar-picker";
import { agentsLink, agentsMutedClass, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Agent" };

/** Called "active now" when its key was used this recently. */
const ACTIVE_NOW_MS = 5 * 60_000;

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
): Promise<{ agent: AgentProfileData; activity: AgentActivityItem[]; tenantId: string; deliveredBugIds: string[] } | null> {
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

  const [filed, claims, comments, deliveries, events, profile] = await Promise.all([
    prisma.bug.count({ where: { createdByAgentId: agentId } }),
    prisma.issueClaim.count({ where: { agentId } }),
    prisma.comment.count({ where: { agentId } }),
    prisma.delivery.findMany({ where: { agentId }, select: { bugId: true } }),
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
    readAgentProfile(agentId, "web"),
  ]);

  const lastUsed = agent.apiKeys
    .map((key) => key.lastUsedAt?.getTime() ?? 0)
    .reduce((latest, time) => Math.max(latest, time), 0);
  const projects = [
    ...new Set(agent.apiKeys.filter((key) => !key.revokedAt && key.project).map((key) => key.project!.name)),
  ];

  return {
    tenantId: agent.tenantId,
    deliveredBugIds: deliveries.map((delivery) => delivery.bugId),
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
      activeNow: !agent.revokedAt && lastUsed > 0 && Date.now() - lastUsed < ACTIVE_NOW_MS,
      projects,
      counts: { filed, claims, comments, delivered: deliveries.length },
      reputation: agent.reputation,
      username: profile?.username ?? null,
      tagline: profile?.tagline ?? null,
      about: profile?.about ?? null,
      rating: profile?.rating ?? null,
      pictureUrl: profile?.picture_url ?? null,
      skills: profile?.skills ?? [],
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

/** How many reviews the page loads; the list pages through them. */
const REVIEW_LIMIT = 200;

/**
 * Other agents' reviews of the work this agent delivered: testers' judgements
 * and managers' merge reviews on the issues it delivered, newest first. The
 * agent's own entries on those issues aren't reviews of it.
 */
async function loadReviews(agentId: string, bugIds: string[]): Promise<AgentReview[]> {
  if (bugIds.length === 0) return [];
  const where = { bugId: { in: bugIds }, NOT: { agentId } };
  const reviewer = { select: { id: true, name: true, avatar: true, username: true, picture: { select: { updatedAt: true } } } };
  const owner = { select: { name: true, email: true } };
  const bug = { select: { id: true, number: true, title: true, project: { select: { slug: true } } } };
  const [verdicts, merges] = await Promise.all([
    prisma.testVerdict.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: REVIEW_LIMIT,
      select: { id: true, goodToMerge: true, summary: true, description: true, updatedAt: true, agent: reviewer, onBehalfOf: owner, bug },
    }),
    prisma.mergeReview.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: REVIEW_LIMIT,
      select: { id: true, verdict: true, summary: true, description: true, updatedAt: true, agent: reviewer, onBehalfOf: owner, bug },
    }),
  ]);
  const reviews: AgentReview[] = [
    ...verdicts.map((v) => ({
      id: `judgement-${v.id}`,
      kind: "judgement" as const,
      positive: v.goodToMerge,
      summary: v.summary,
      description: v.description,
      at: v.updatedAt.toISOString(),
      reviewer: reviewerView(v.agent, v.onBehalfOf),
      bug: v.bug,
    })),
    ...merges.map((m) => ({
      id: `merge-${m.id}`,
      kind: "merge" as const,
      positive: m.verdict === "accept",
      summary: m.summary,
      description: m.description,
      at: m.updatedAt.toISOString(),
      reviewer: reviewerView(m.agent, m.onBehalfOf),
      bug: m.bug,
    })),
  ];
  return reviews.sort((a, b) => b.at.localeCompare(a.at)).slice(0, REVIEW_LIMIT);
}

function reviewerView(
  agent: { id: string; name: string; avatar: string | null; username: string | null; picture: { updatedAt: Date } | null },
  owner: { name: string | null; email: string },
): AgentReview["reviewer"] {
  return {
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    pictureUrl: agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, "web") : null,
    ownerName: owner.name ?? owner.email,
  };
}

/** The viewer's own agents in this workspace, for the tabs: active ones, plus this one if it is theirs. */
async function loadOwnAgents(viewerId: string, tenantId: string, currentId: string): Promise<AgentTab[]> {
  const agents = await prisma.agent.findMany({
    where: { tenantId, ownerUserId: viewerId, OR: [{ revokedAt: null }, { id: currentId }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, avatar: true, revokedAt: true, username: true, picture: { select: { updatedAt: true } } },
  });
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    pictureUrl: agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, "web") : null,
    revoked: agent.revokedAt !== null,
  }));
}

/**
 * One agent's page, at /settings/agent/{name}, laid out like a freelancer's
 * profile: tabs for the viewer's own agents, the profile with its reviews,
 * activity and conversation, and a side card whose "More about me" opens its
 * name, level and instructions for editing.
 */
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

  const [reviews, ownAgents] = await Promise.all([
    loadReviews(agentId, profile.deliveredBugIds),
    loadOwnAgents(user.id, profile.tenantId, agentId),
  ]);
  const editable = !thread.agent.revoked;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* The back link on the left and the tabs centred on one line; stacked on a phone. */}
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <Link href="/agents" className={`justify-self-start text-sm ${agentsLink}`}>
          ← Back to agents
        </Link>
        <div className="min-w-0 md:justify-self-center">
          <AgentTabs agents={ownAgents} currentId={agentId} />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-10">
          <AgentProfileHeader
            agent={profile.agent}
            avatarControl={
              editable ? (
                <AgentAvatarPicker agentId={agentId} agentName={profile.agent.name} avatar={profile.agent.avatar} size={120} />
              ) : null
            }
            reviewCount={reviews.length}
            instructions={thread.isOwner ? (thread.instructions ?? "") : null}
          />

          <AgentReviews
            agentName={profile.agent.name}
            reviews={reviews}
            stats={<AgentStats counts={profile.agent.counts} />}
          />

          <AgentActivity items={profile.activity} />

          <section id="conversation" className={`${agentsSurface} scroll-mt-24 p-4 sm:p-6`} aria-labelledby="thread-heading">
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

        <AgentSideCard
          agent={profile.agent}
          canMessage={!thread.agent.revoked}
          editControl={
            editable ? (
              <AgentEditDialog agentName={profile.agent.name} className={agentsSecondaryBtn}>
                <AgentProfileForm
                  agentId={agentId}
                  username={profile.agent.username}
                  tagline={profile.agent.tagline}
                  about={profile.agent.about}
                />
                <AgentSettingsForm agentId={agentId} name={profile.agent.name} level={profile.agent.level} levels={levels} />
                {thread.isOwner ? (
                  <div className="border-t border-zk-divider pt-5">
                    <p className={`mb-3 ${agentsMutedClass}`}>
                      A standing brief the agent reads from <code className="font-mono text-xs">GET /api/v1/agents/me</code>.
                    </p>
                    <InstructionsForm
                      agentId={thread.agent.id}
                      instructions={thread.instructions}
                      maxLength={AGENT_INSTRUCTIONS_MAX}
                    />
                  </div>
                ) : null}
              </AgentEditDialog>
            ) : null
          }
        />
      </div>
    </div>
  );
}
