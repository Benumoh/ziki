import type { AgentLevel, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isAdmin, type AppRole } from "@/lib/roles";
import { audit } from "@/lib/agents/audit";
import { freeUsername, updateAgentProfile } from "@/lib/agents/profile";
import { generateApiKey } from "@/lib/agents/keys";
import { sealSecret } from "@/lib/secret-box";
import { CREATION_LEVELS, DEFAULT_AGENT_LEVEL, canSetLevel } from "@/lib/agents/levels";
import { isAgentAvatar } from "@/lib/agents/avatars";
import { isTenantAdmin } from "@/lib/agents/membership";
import { currentTenantIdFor } from "@/lib/tenant-context";
import type { AgentContext } from "@/lib/agents/require-agent";
import { AGENT_LIMIT_MESSAGE, AGENT_MODEL_MAX, AGENT_NAME_MAX, MAX_ACTIVE_AGENTS_PER_OWNER } from "@/lib/agents/registry-limits";
import { releaseWorkOfRevokedAgent } from "@/lib/agent-api/revoke-release";

/**
 * Registering agents and managing their keys (#427). A person creates agents
 * under their own account, sees each key once, and can revoke them; a tenant
 * admin can revoke any agent in the tenant. An agent can only rotate its own
 * key: it can't rename itself, change owner, create agents or raise its level.
 */

export { AGENT_MODEL_MAX, AGENT_NAME_MAX };

const text = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .max(max, `${label} must be ${max} characters or fewer.`)
        .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), `${label} can't contain control characters.`),
    );

export const agentNameSchema = text(AGENT_NAME_MAX, "Name").pipe(
  z.string().min(2, "Give the agent a name of at least 2 characters, like “Ada's Claude”."),
);
export const agentModelSchema = text(AGENT_MODEL_MAX, "Model");

export const createAgentSchema = z.object({
  name: agentNameSchema,
  model: agentModelSchema.optional().transform((value) => value || null),
  level: z.enum(CREATION_LEVELS).default(DEFAULT_AGENT_LEVEL),
  projectId: z.string().trim().min(1, "Choose the project this key can work in.").max(191),
});

export type Actor = { id: string; role?: AppRole | null };

type Db = PrismaClient | Prisma.TransactionClient;

export type IssuedKey = { agentId: string; name: string; level: AgentLevel; rawKey: string; prefix: string };

/** Inserts an agent and its first key. Shared by the settings page and pairing. */
export async function insertAgentWithKey(
  db: Db,
  input: { tenantId: string; ownerUserId: string; name: string; model: string | null; level: AgentLevel; projectId: string; instructions?: string | null },
): Promise<IssuedKey> {
  const key = generateApiKey();
  const { projectId, ...agentInput } = input;
  const agent = await db.agent.create({
    data: {
      ...agentInput,
      // #agent-profile: its @username starts as its name; it can change it.
      username: await freeUsername(db, input.tenantId, input.name),
      apiKeys: {
        create: { keyHash: key.hash, prefix: key.prefix, projectId, sealedKey: sealSecret(key.raw) },
      },
    },
    select: { id: true, name: true },
  });
  return { agentId: agent.id, name: agent.name, level: input.level, rawKey: key.raw, prefix: key.prefix };
}

export type CreateAgentResult =
  | { ok: true; key: IssuedKey }
  | { ok: false; error: string; field?: "name" | "model" | "level" | "projectId" };

/** The owner, signed in, registers an agent and gets its key once. */
export async function createAgent(owner: Actor, input: unknown): Promise<CreateAgentResult> {
  const parsed = createAgentSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      ok: false,
      error: issue?.message ?? "Check the agent's details.",
      field: field === "name" || field === "model" || field === "level" || field === "projectId" ? field : undefined,
    };
  }
  const tenantId = await currentTenantIdFor(owner.id);
  if (!tenantId) {
    return { ok: false, error: "Join or create a team before you register agents." };
  }
  if (!canSetLevel({ isOwner: true, isTenantAdmin: await isTenantAdmin(owner, tenantId) }, parsed.data.level)) {
    return { ok: false, error: "Only a team admin can make an agent a manager or merger agent.", field: "level" };
  }
  const project = await projectInTenant(tenantId, parsed.data.projectId);
  if (!project) return { ok: false, error: "Choose a project in this workspace.", field: "projectId" };

  const key = await prisma.$transaction(async (tx) => {
    // Per-agent budgets would multiply with every extra agent (#511).
    const active = await tx.agent.count({
      where: { tenantId, ownerUserId: owner.id, revokedAt: null },
    });
    if (active >= MAX_ACTIVE_AGENTS_PER_OWNER) return null;
    const issued = await insertAgentWithKey(tx, {
      tenantId,
      ownerUserId: owner.id,
      name: parsed.data.name,
      model: parsed.data.model,
      level: parsed.data.level,
      projectId: project.id,
    });
    await audit(
      { agentId: issued.agentId, tenantId },
      "agent.created",
      `agent:${issued.agentId}`,
      { name: issued.name, model: parsed.data.model, level: parsed.data.level, projectId: project.id, via: "settings" },
      { actorUserId: owner.id, db: tx },
    );
    return issued;
  });
  if (!key) return { ok: false, error: AGENT_LIMIT_MESSAGE };
  return { ok: true, key };
}

type ManagedAgent = {
  id: string;
  name: string;
  level: AgentLevel;
  tenantId: string;
  ownerUserId: string;
  revokedAt: Date | null;
  defaultProjectId: string | null;
};

async function projectInTenant(tenantId: string, projectId: string) {
  if (!projectId) return null;
  return prisma.project.findFirst({
    where: { id: projectId, tenantId },
    select: { id: true, slug: true, name: true },
  });
}

/** The agent, and whether the actor may manage it: its owner or a tenant admin. */
async function managedAgent(actor: Actor, agentId: string) {
  const agent: ManagedAgent | null = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, level: true, tenantId: true, ownerUserId: true, revokedAt: true, defaultProjectId: true },
  });
  if (!agent) return null;
  const isOwner = agent.ownerUserId === actor.id;
  const isAdmin = await isTenantAdmin(actor, agent.tenantId);
  if (!isOwner && !isAdmin) return null;
  return { agent, isOwner, isTenantAdmin: isAdmin };
}

export type ManageResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND = "That agent doesn't exist, or it isn't yours to change.";

/**
 * Revokes the agent and every key it has. A revoked key fails
 * `requireAgent()` from the next call on. Revoking twice is harmless.
 */
export async function revokeAgent(actor: Actor, agentId: string, now = new Date()): Promise<ManageResult> {
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (managed.agent.revokedAt) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { revokedAt: now } });
    await tx.agentApiKey.updateMany({ where: { agentId, revokedAt: null }, data: { revokedAt: now } });
    // #523: a dead key can't deliver, so its claims and bids go back to the team.
    const handedBack = await releaseWorkOfRevokedAgent(tx, {
      agentId,
      tenantId: managed.agent.tenantId,
      actorUserId: actor.id,
      now,
    });
    await audit(
      { agentId, tenantId: managed.agent.tenantId },
      "agent.revoked",
      `agent:${agentId}`,
      { by: managed.isOwner ? "owner" : "tenant_admin", ...handedBack },
      { actorUserId: actor.id, db: tx },
    );
  });
  return { ok: true };
}

/**
 * Removes the agent. Open offers, claims, and bids are handed back first,
 * then the row and its keys are deleted. Issues it filed stay.
 */
export async function deleteAgent(actor: Actor, agentId: string, now = new Date()): Promise<ManageResult> {
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  await prisma.$transaction(async (tx) => {
    await releaseWorkOfRevokedAgent(tx, {
      agentId,
      tenantId: managed.agent.tenantId,
      actorUserId: actor.id,
      now,
    });
    await tx.agent.delete({ where: { id: agentId } });
  });
  return { ok: true };
}

/** The owner, or a tenant admin, moves an agent to another level. */
export async function setAgentLevel(actor: Actor, agentId: string, level: AgentLevel): Promise<ManageResult> {
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (managed.agent.revokedAt) return { ok: false, error: "That agent is revoked." };
  if (!canSetLevel(managed, level)) {
    return { ok: false, error: "Only a team admin can make an agent a manager or merger agent." };
  }
  const before = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { level: true } });
  if (before.level === level) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { level, levelChangedAt: new Date() } });
    await audit(
      { agentId, tenantId: managed.agent.tenantId },
      "agent.level_changed",
      `agent:${agentId}`,
      { from: before.level, to: level, by: managed.isOwner ? "owner" : "tenant_admin" },
      { actorUserId: actor.id, db: tx },
    );
  });
  return { ok: true };
}

export type RenameResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Rename an agent, as its owner or a team admin. An owner keeps one agent per
 * name in a workspace, because the agent's page is addressed by its name.
 */
export async function renameAgent(actor: Actor, agentId: string, input: unknown): Promise<RenameResult> {
  const parsed = agentNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the agent's name." };
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (managed.agent.revokedAt) return { ok: false, error: "That agent is revoked." };
  const name = parsed.data;
  if (name === managed.agent.name) return { ok: true, name };

  const taken = await prisma.agent.findFirst({
    where: {
      tenantId: managed.agent.tenantId,
      ownerUserId: managed.agent.ownerUserId,
      name: { equals: name, mode: "insensitive" },
      id: { not: agentId },
    },
    select: { id: true },
  });
  if (taken) return { ok: false, error: `There's already an agent called “${name}”. Pick another name.` };

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { name } });
    await audit(
      { agentId, tenantId: managed.agent.tenantId },
      "agent.renamed",
      `agent:${agentId}`,
      { from: managed.agent.name, to: name, by: managed.isOwner ? "owner" : "tenant_admin" },
      { actorUserId: actor.id, db: tx },
    );
  });
  return { ok: true, name };
}

/**
 * Pick the agent's robot avatar, as its owner or a team admin. Null goes back
 * to the automatic one drawn from its id.
 */
export async function setAgentAvatar(actor: Actor, agentId: string, avatar: unknown): Promise<ManageResult> {
  if (avatar !== null && !isAgentAvatar(avatar)) return { ok: false, error: "Pick one of the avatars." };
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (managed.agent.revokedAt) return { ok: false, error: "That agent is revoked." };
  const before = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { avatar: true } });
  if (before.avatar === avatar) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { avatar } });
    await audit(
      { agentId, tenantId: managed.agent.tenantId },
      "agent.avatar_changed",
      `agent:${agentId}`,
      { from: before.avatar, to: avatar, by: managed.isOwner ? "owner" : "tenant_admin" },
      { actorUserId: actor.id, db: tx },
    );
  });
  return { ok: true };
}

/** Save an agent's preferred areas for one project (#609). */
export async function setAgentAreaPreferences(
  actor: Actor,
  agentId: string,
  projectId: string,
  areaIds: string[],
): Promise<ManageResult> {
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (managed.agent.revokedAt) return { ok: false, error: "That agent is revoked." };
  const project = await projectInTenant(managed.agent.tenantId, projectId);
  if (!project) return { ok: false, error: "Choose a project in this workspace." };

  const wanted = [...new Set(areaIds)].sort();
  const validAreas = wanted.length
    ? await prisma.projectArea.findMany({
        where: { projectId: project.id, id: { in: wanted } },
        select: { id: true },
      })
    : [];
  if (validAreas.length !== wanted.length) return { ok: false, error: "Choose areas from this project." };

  const current = await prisma.agentAreaPreference.findMany({
    where: { agentId, projectArea: { projectId: project.id } },
    select: { projectAreaId: true },
  });
  const before = current.map((preference) => preference.projectAreaId).sort();
  if (before.length === wanted.length && before.every((areaId, index) => areaId === wanted[index])) {
    return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentAreaPreference.deleteMany({ where: { agentId, projectArea: { projectId: project.id } } });
    if (wanted.length) {
      await tx.agentAreaPreference.createMany({ data: wanted.map((projectAreaId) => ({ agentId, projectAreaId })) });
    }
    await audit(
      { agentId, tenantId: managed.agent.tenantId },
      "agent.area_preferences_changed",
      `agent:${agentId}`,
      { projectId: project.id, from: before, to: wanted, by: managed.isOwner ? "owner" : "tenant_admin" },
      { actorUserId: actor.id, db: tx },
    );
  });
  return { ok: true };
}

/**
 * Turns the higher read budget on or off (#440; writes have no hourly cap since #699), optionally until a time
 * (#596). A workspace admin or a site admin may do this. An owner who is not
 * an admin cannot.
 *
 * `burst` stays the enabled flag; `burstUntil` only limits it. Disabling
 * clears the expiry, so turning it back on cannot inherit a stale window.
 * The budget helper treats an expired time as the standard budget, so no
 * scheduled job is needed.
 */
export async function setAgentBurst(
  actor: Actor,
  agentId: string,
  burst: boolean,
  burstUntil: Date | null = null,
  now = new Date(),
): Promise<ManageResult> {
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (!managed.isTenantAdmin && !isAdmin(actor.role)) {
    return { ok: false, error: "Only an admin can change an agent's read budget." };
  }
  if (managed.agent.revokedAt) return { ok: false, error: "That agent is revoked." };

  const nextUntil = burst ? burstUntil : null;
  if (nextUntil && (!Number.isFinite(nextUntil.getTime()) || nextUntil.getTime() <= now.getTime())) {
    return { ok: false, error: "Choose an expiry time in the future." };
  }

  const before = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { burst: true, burstUntil: true },
  });
  const beforeUntil = before.burstUntil?.getTime() ?? null;
  const nextTime = nextUntil?.getTime() ?? null;
  // Re-saving the same state is harmless and does not add a misleading audit row.
  if (before.burst === burst && beforeUntil === nextTime) return { ok: true };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.agent.update({ where: { id: agentId }, data: { burst, burstUntil: nextUntil } });
      await audit(
        { agentId, tenantId: managed.agent.tenantId },
        "agent.burst_changed",
        `agent:${agentId}`,
        {
          from: before.burst,
          to: burst,
          fromUntil: before.burstUntil?.toISOString() ?? null,
          toUntil: nextUntil?.toISOString() ?? null,
          by: "admin",
        },
        { actorUserId: actor.id, db: tx },
      );
    });
  } catch {
    // The transaction rolled back, so the old budget still applies. Never
    // report success when the change was not persisted.
    return { ok: false, error: "Couldn't change the read budget. Try again." };
  }
  return { ok: true };
}

/**
 * The agent replaces the key it called with. Same agent, name and owner; the
 * old key stops working. The new one is sealed so the owner can copy it again.
 */
export async function rotateKey(agent: AgentContext, now = new Date()): Promise<IssuedKey> {
  const key = generateApiKey();
  return prisma.$transaction(async (tx) => {
    const revoked = await tx.agentApiKey.updateMany({
      where: { id: agent.keyId, agentId: agent.agentId, revokedAt: null },
      data: { revokedAt: now },
    });
    // Two rotations racing with the same key: only the first gets a new one.
    if (revoked.count !== 1) throw new Error("This key was already rotated or revoked.");
    await tx.agentApiKey.create({
      data: {
        agentId: agent.agentId,
        keyHash: key.hash,
        prefix: key.prefix,
        projectId: agent.projectId ?? null,
        sealedKey: sealSecret(key.raw),
      },
    });
    await audit(agent, "agent.key_rotated", `agent:${agent.agentId}`, { prefix: key.prefix, projectId: agent.projectId ?? null }, { db: tx });
    return { agentId: agent.agentId, name: agent.name, level: agent.level, rawKey: key.raw, prefix: key.prefix };
  });
}

export type RegenerateKeyResult =
  | { ok: true; key: IssuedKey }
  | { ok: false; error: string; field?: "projectId" };

/**
 * The owner or a tenant admin replaces every live key without the old secret
 * (#572). The agent, its level and its history stay. The new key is sealed so
 * it can be copied again, and it is limited to the project they choose.
 */
export async function regenerateKey(
  actor: Actor,
  agentId: string,
  projectId: string,
  now = new Date(),
): Promise<RegenerateKeyResult> {
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (managed.agent.revokedAt) return { ok: false, error: "That agent is revoked." };
  const project = await projectInTenant(managed.agent.tenantId, projectId);
  if (!project) return { ok: false, error: "Choose a project in this workspace.", field: "projectId" };

  const key = generateApiKey();
  await prisma.$transaction(async (tx) => {
    await tx.agentApiKey.updateMany({ where: { agentId, revokedAt: null }, data: { revokedAt: now } });
    await tx.agentApiKey.create({
      data: {
        agentId,
        keyHash: key.hash,
        prefix: key.prefix,
        projectId: project.id,
        sealedKey: sealSecret(key.raw),
      },
    });
    await audit(
      { agentId, tenantId: managed.agent.tenantId },
      "agent.key_rotated",
      `agent:${agentId}`,
      { prefix: key.prefix, projectId: project.id, by: managed.isOwner ? "owner" : "tenant_admin", via: "settings" },
      { actorUserId: actor.id, db: tx },
    );
  });
  return {
    ok: true,
    key: { agentId, name: managed.agent.name, level: managed.agent.level, rawKey: key.raw, prefix: key.prefix },
  };
}

/**
 * Change an agent's username, tagline or About me from its page (#agent-profile),
 * as its owner or a team admin. The agent sets the same fields itself with
 * `PATCH /api/v1/agents/me`.
 */
export async function updateAgentProfileAsPerson(
  actor: Actor,
  agentId: string,
  input: unknown,
): Promise<ManageResult> {
  const managed = await managedAgent(actor, agentId);
  if (!managed) return { ok: false, error: NOT_FOUND };
  if (managed.agent.revokedAt) return { ok: false, error: "That agent is revoked." };
  const result = await updateAgentProfile({ agentId, tenantId: managed.agent.tenantId, actorUserId: actor.id }, input);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
