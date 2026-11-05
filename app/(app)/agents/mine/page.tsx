import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { settableLevels } from "@/lib/agents/levels";
import { MAX_ACTIVE_AGENTS_PER_OWNER } from "@/lib/agents/registry-limits";
import { isTenantAdminRole } from "@/lib/agents/membership";
import { projectContextFor } from "@/lib/project-context";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { openSecret } from "@/lib/secret-box";
import { materializeApprovedPairings } from "@/lib/agents/pairing";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { FirstAgentEmptyState } from "@/components/first-agent-empty-state";
import { ManageAgentsList, type ManageAgentItem } from "@/app/(app)/settings/agents/manage-agents-list";
import {
  agentsMutedClass,
  agentsPrimaryBtn,
  agentsSurface,
} from "@/app/(app)/settings/agents/agents-ui";

/** Decrypts a stored agent key for display; a missing or unreadable seal yields null so the row still renders. */
function revealAgentKey(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return openSecret(sealed);
  } catch {
    return null;
  }
}

export const metadata = { title: "My agents" };

/**
 * Where "Create agent" goes. Creating an agent is its own page (built under a
 * separate ticket), so this page only links to it. Change this one line when
 * that page has a route.
 */
const CREATE_AGENT_HREF = "/settings/connect";

/**
 * My agents: the signed-in person's own agents and nothing else (creating agents and the team list live on their own pages).
 * Its own top-level page, the "Manage agents" entry in the header's Agents menu; /settings/agents redirects here.
 */
export default async function AgentsPage() {
  if (!isAgentPlatformEnabled()) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-zk-text">Agents</h1>
          <p className={agentsMutedClass}>The agent platform feature is not enabled in this environment.</p>
        </div>
      </div>
    );
  }

  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  const context = await projectContextFor(prisma, tenantId);
  const membership = tenantId
    ? await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        select: { role: true },
      })
    : null;
  const isAdmin = isTenantAdminRole(membership?.role, user.role);
  const projects = context.projects;
  const now = new Date();

  if (tenantId) {
    try {
      await materializeApprovedPairings(user.id, tenantId);
    } catch (error) {
      console.error("[agents] approved agents were not listed", error);
    }
  }
  const mine = tenantId
    ? await prisma.agent.findMany({
        where: { ownerUserId: user.id, tenantId },
        orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          model: true,
          level: true,
          createdAt: true,
          revokedAt: true,
          defaultProjectId: true,
          apiKeys: {
            where: { revokedAt: null },
            select: {
              id: true,
              prefix: true,
              sealedKey: true,
              lastUsedAt: true,
              project: { select: { id: true, name: true } },
            },
          },
        },
      })
    : [];

  const ownLevels = settableLevels({ isOwner: true, isTenantAdmin: isAdmin });
  const activeCount = mine.filter((agent) => !agent.revokedAt).length;
  const recentCutoff = now.getTime() - 24 * 60 * 60 * 1000;

  const manageItems: ManageAgentItem[] = mine.map((agent) => {
    const lastUsedMs = agent.apiKeys
      .map((key) => (key.lastUsedAt ? key.lastUsedAt.getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    return {
      id: agent.id,
      name: agent.name,
      username: agent.username,
      avatar: agent.avatar,
      model: agent.model,
      level: agent.level,
      createdAt: agent.createdAt.toISOString(),
      revokedAt: agent.revokedAt ? agent.revokedAt.toISOString() : null,
      personal: Boolean(agent.defaultProjectId),
      currentProjectId: agent.apiKeys.find((key) => key.project)?.project?.id ?? null,
      recent: lastUsedMs >= recentCutoff,
      apiKeys: agent.apiKeys.map((key) => ({
        id: key.id,
        prefix: key.prefix,
        apiKey: revealAgentKey(key.sealedKey),
        projectId: key.project?.id ?? null,
        projectName: key.project?.name ?? null,
        lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
      })),
    };
  });

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">My agents</h1>
            <p className={agentsMutedClass}>
              Each agent has its own key. Copy sends that key and this site to that agent only.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={CREATE_AGENT_HREF} className={agentsPrimaryBtn}>
              Create agent
            </Link>
          </div>
        </div>
      </div>

      {!tenantId ? (
        <div className={`${agentsSurface} border-dashed p-6 text-sm text-zk-text2`}>
          <p>
            You aren&apos;t in a workspace yet, so you can&apos;t register agents. Join a workspace via an invite from your team, or create your own workspace to start managing agents.
          </p>
          <div className="mt-3">
            <Link href="/tenants" className={agentsPrimaryBtn}>
              Create or join a workspace →
            </Link>
          </div>
        </div>
      ) : (
        <section aria-labelledby="mine-heading" className="space-y-3">
          <h2 id="mine-heading" className="sr-only">
            Your agents
          </h2>
          {mine.length === 0 ? (
            <FirstAgentEmptyState />
          ) : (
            <ManageAgentsList
              agents={manageItems}
              activeCount={activeCount}
              maxActive={MAX_ACTIVE_AGENTS_PER_OWNER}
              levels={ownLevels}
              projects={projects}
            />
          )}
        </section>
      )}
    </div>
  );
}
