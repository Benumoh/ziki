import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { MAX_ACTIVE_AGENTS_PER_OWNER } from "@/lib/agents/registry-limits";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { openSecret } from "@/lib/secret-box";
import { materializeApprovedPairings } from "@/lib/agents/pairing";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { FirstAgentEmptyState } from "@/components/first-agent-empty-state";
import { OnCallInvites } from "@/components/on-call-invites";
import { OnCallSetup } from "@/components/on-call-setup";
import { ManageAgentsList, type ManageAgentItem } from "@/app/(app)/settings/agents/manage-agents-list";
import {
  agentsMutedClass,
  agentsPrimaryBtn,
  agentsSecondaryBtn,
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
 * Where the header's "Connect agent" button goes. Creating an agent is its own page (built under a
 * separate ticket), so this page only links to it. Change this one line when
 * that page has a route.
 */
const CREATE_AGENT_HREF = "/settings/connect";

/** Standing instructions every agent here follows (#838); the first child route under /agents/mine. */
const PREFERENCES_HREF = "/agents/mine/preferences";

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
  const organisationId = await currentOrganisationIdFor(user.id);
  const now = new Date();

  if (organisationId) {
    try {
      await materializeApprovedPairings(user.id, organisationId);
    } catch (error) {
      console.error("[agents] approved agents were not listed", error);
    }
  }
  // #user-agents: every agent you own, whichever organisations it works in.
  const [mine, organisation] = await Promise.all([
    prisma.agent.findMany({
      where: { ownerUserId: user.id },
      orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        model: true,
        createdAt: true,
        revokedAt: true,
        pausedAt: true,
        activations: {
          where: { deactivatedAt: null },
          orderBy: { activatedAt: "asc" },
          select: { organisationId: true, level: true, organisation: { select: { name: true } } },
        },
        apiKeys: {
          where: { revokedAt: null },
          select: { id: true, prefix: true, sealedKey: true, lastUsedAt: true, organisationId: true },
        },
      },
    }),
    organisationId ? prisma.organisation.findUnique({ where: { id: organisationId }, select: { id: true, name: true } }) : null,
  ]);

  const live = mine.filter((agent) => !agent.revokedAt);
  // Until one of their agents has called Ziki with its key, show how to connect one.
  const connected = mine.some((agent) => !agent.revokedAt && agent.apiKeys.some((key) => key.lastUsedAt));
  const recentCutoff = now.getTime() - 24 * 60 * 60 * 1000;

  const manageItems: ManageAgentItem[] = mine.map((agent) => {
    const lastUsedMs = agent.apiKeys
      .map((key) => (key.lastUsedAt ? key.lastUsedAt.getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const here = organisationId ? agent.activations.find((row) => row.organisationId === organisationId) : undefined;
    return {
      id: agent.id,
      name: agent.name,
      username: agent.username,
      avatar: agent.avatar,
      model: agent.model,
      level: here?.level ?? "working",
      createdAt: agent.createdAt.toISOString(),
      revokedAt: agent.revokedAt ? agent.revokedAt.toISOString() : null,
      pausedAt: agent.pausedAt ? agent.pausedAt.toISOString() : null,
      recent: lastUsedMs >= recentCutoff,
      activeHere: Boolean(here),
      organisations: agent.activations.map((row) => row.organisation.name),
      // Its keys for the organisation you are in: a key works in one organisation.
      apiKeys: agent.apiKeys
        .filter((key) => key.organisationId === organisationId)
        .map((key) => ({
          id: key.id,
          prefix: key.prefix,
          apiKey: revealAgentKey(key.sealedKey),
          lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
        })),
    };
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <OnCallInvites userId={user.id} />
      <OnCallSetup userId={user.id} />
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 space-y-1 sm:max-w-xl md:max-w-2xl">
            <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">My agents</h1>
            <p className={agentsMutedClass}>
              Your agents, wherever they work. Each has a key per organisation it works in; copy it into your AI coding assistant to connect it there.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={PREFERENCES_HREF} className={agentsSecondaryBtn}>
              Preferences
            </Link>
            <Link href={CREATE_AGENT_HREF} className={agentsPrimaryBtn}>
              Connect agent
            </Link>
          </div>
        </div>
      </div>

      {!organisationId ? (
        <div className={`${agentsSurface} border-dashed p-6 text-sm text-zk-text2`}>
          <p>
            You aren&apos;t in an organisation yet, so you can&apos;t register agents. Join an organisation via an invite from your team, or create your own organisation to start managing agents.
          </p>
          <div className="mt-3">
            <Link href="/organisations" className={agentsPrimaryBtn}>
              Create or join an organisation →
            </Link>
          </div>
        </div>
      ) : (
        <section aria-labelledby="mine-heading" className="space-y-4">
          <h2 id="mine-heading" className="sr-only">
            Your agents
          </h2>

          {connected ? null : (
            <FirstAgentEmptyState
              hasAgents={live.length > 0}
              hasKey={live.some((agent) => agent.apiKeys.some((key) => key.sealedKey))}
              addHref={CREATE_AGENT_HREF}
            />
          )}
          {mine.length === 0 ? null : (
            <ManageAgentsList
              agents={manageItems}
              maxActive={MAX_ACTIVE_AGENTS_PER_OWNER}
              organisation={organisation}
            />
          )}
        </section>
      )}
    </div>
  );
}
