import type { AgentLevel } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizationToken, hashSecret } from "@/lib/agents/keys";
import { AgentLevelError } from "@/lib/agents/levels";
import { AgentPlatformDisabledError, agentPlatformDisabledResponse } from "@/lib/agents/platform-gate";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import type { AppRole } from "@/lib/roles";
import { AgentWorkBlockedError, assertAgentMayWork } from "@/lib/agents/work-gate";

export { AgentPlatformDisabledError, agentPlatformDisabledResponse };

/**
 * Who is calling (#427). Every agent route starts with `requireAgent()`.
 * It looks the key up by its hash and checks that the key and the agent are
 * live, and that the owner still belongs to the agent's tenant. It writes
 * nothing; routes record what they did with `audit()`.
 *
 * The owner always comes from the agent row, never from the request body.
 */
export type AgentContext = {
  agentId: string;
  name: string;
  ownerId: string;
  tenantId: string;
  level: AgentLevel;
  /**
   * The owner's site-wide role, read from the agent's owner row. Routes that
   * mirror the web app's admin gate need it (#512).
   */
  ownerRole?: AppRole | null;
  /** For the rate budget (#440). */
  burst: boolean;
  /** When the higher budget lapses; null means no expiry (#596). */
  burstUntil?: Date | null;
  /** The key used for this call, so rotation can revoke exactly it. */
  keyId: string;
  /**
   * The only project this key may act in (#742). Null or omitted means a
   * legacy key that still works in every project of the tenant.
   */
  projectId?: string | null;
  /** Slug of that project, for the error shown when the key is used elsewhere. */
  projectSlug?: string | null;
};

export type AgentAuthFailure = "missing_key" | "invalid_key" | "revoked";

const MESSAGES: Record<AgentAuthFailure, string> = {
  missing_key: "Send your agent key as Authorization: Bearer <key>.",
  invalid_key: "That agent key is not valid. Send it as Authorization: Bearer <key>.",
  revoked: "That agent key has been revoked.",
};

/** A project-scoped key was used against a different project (#742). */
export class AgentProjectError extends Error {
  readonly code = "project_forbidden" as const;

  constructor(projectSlug: string | null | undefined) {
    super(
      projectSlug
        ? `This agent key is restricted to project ${projectSlug}.`
        : "This agent key is restricted to another project.",
    );
    this.name = "AgentProjectError";
  }
}

/** Rejects the call when the key is limited to a different project. */
export function assertKeyProject(
  agent: Pick<AgentContext, "projectId" | "projectSlug">,
  projectId: string,
): void {
  if (agent.projectId && agent.projectId !== projectId) {
    throw new AgentProjectError(agent.projectSlug);
  }
}

export class AgentAuthError extends Error {
  readonly code: AgentAuthFailure;

  constructor(code: AgentAuthFailure) {
    super(MESSAGES[code]);
    this.name = "AgentAuthError";
    this.code = code;
  }
}

/** The request: its headers, and its method and URL for the work gate. */
type HeaderSource = { headers: { get(name: string): string | null }; method?: string; url?: string };

const LAST_USED_THROTTLE_MS = 60 * 1000;

export async function requireAgent(request: HeaderSource): Promise<AgentContext> {
  if (!isAgentPlatformEnabled()) throw new AgentPlatformDisabledError();
  const auth = authorizationToken(request.headers.get("authorization"));
  // No header (or a Bearer with no token) is a missing key; a header that was
  // sent but cannot be a Ziki key is a bad key, not a missing one (#467).
  if (auth.status === "missing") throw new AgentAuthError("missing_key");
  if (auth.status === "malformed") throw new AgentAuthError("invalid_key");
  const raw = auth.token;

  const key = await prisma.agentApiKey.findUnique({
    where: { keyHash: hashSecret(raw) },
    select: {
      id: true,
      lastUsedAt: true,
      revokedAt: true,
      projectId: true,
      project: { select: { slug: true } },
      agent: {
        select: {
          id: true,
          name: true,
          ownerUserId: true,
          tenantId: true,
          level: true,
          burst: true,
          burstUntil: true,
          revokedAt: true,
          username: true,
          tagline: true,
          about: true,
          _count: { select: { skills: true } },
          owner: { select: { role: true, memberships: { select: { tenantId: true } } } },
        },
      },
    },
  });
  if (!key) throw new AgentAuthError("invalid_key");
  const { agent } = key;
  if (key.revokedAt || agent.revokedAt) throw new AgentAuthError("revoked");
  // An owner who left the tenant takes their agents' access with them.
  const ownerInTenant = agent.owner.memberships.some((m) => m.tenantId === agent.tenantId);
  if (!agent.name || !agent.ownerUserId || !agent.tenantId || !ownerInTenant) {
    throw new AgentAuthError("invalid_key");
  }

  // #agent-work-gate: with the key good, the first check is whether this agent
  // may work at all (assertAgentMayWork below). lastUsedAt is stamped first, so
  // the owner sees a blocked agent is trying.
  const gateAgent = {
    username: agent.username,
    tagline: agent.tagline,
    about: agent.about,
    skillCount: agent._count.skills,
  };

  // Update lastUsedAt on successful auth, throttled to at most once per minute (#535)
  const now = new Date();
  if (
    typeof prisma.agentApiKey?.update === "function" &&
    (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS)
  ) {
    await Promise.resolve(
      prisma.agentApiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: now },
      }),
    ).catch((error) => {
      logger.error("[requireAgent] failed to update lastUsedAt", error);
    });
  }

  assertAgentMayWork(gateAgent, request);

  return {
    agentId: agent.id,
    name: agent.name,
    ownerId: agent.ownerUserId,
    tenantId: agent.tenantId,
    level: agent.level,
    ownerRole: agent.owner.role ?? null,
    burst: agent.burst,
    burstUntil: agent.burstUntil ?? null,
    keyId: key.id,
    projectId: key.projectId,
    projectSlug: key.project?.slug ?? null,
  };
}

/**
 * The response for a failed `requireAgent()` or `requireLevel()`: 401 for a
 * missing or bad key, 403 for too low a level. Anything else is rethrown.
 */
export function agentErrorResponse(error: unknown): NextResponse {
  if (error instanceof AgentPlatformDisabledError) return agentPlatformDisabledResponse();
  if (error instanceof AgentAuthError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="ziki"' } },
    );
  }
  if (error instanceof AgentWorkBlockedError) {
    // #agent-work-gate: the agent may not work until its profile is set up.
    return NextResponse.json(error.toBody(), { status: 403 });
  }
  if (error instanceof AgentProjectError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: 403 });
  }
  if (error instanceof AgentLevelError) {
    return NextResponse.json(
      { error: "insufficient_level", message: error.message, required: error.required },
      { status: 403 },
    );
  }
  throw error;
}
