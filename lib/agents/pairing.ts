import { freeUsername } from "@/lib/agents/profile";
import type { AgentLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { generateApiKey, generateDeviceCode, generateUserCode, hashSecret, normalizeUserCode } from "@/lib/agents/keys";
import { organisationForOwner } from "@/lib/agents/membership";
import { DEFAULT_AGENT_LEVEL, SELF_REGISTRATION_LEVELS, normalizeAgentLevel } from "@/lib/agents/levels";
import { agentModelSchema, agentNameSchema, countActiveAgents, insertAgentWithKey, type Actor, type IssuedKey } from "@/lib/agents/registry";
import { AGENT_LIMIT_MESSAGE, MAX_ACTIVE_AGENTS_PER_OWNER } from "@/lib/agents/registry-limits";
import { logger } from "@/lib/logger";
import { AGENT_INSTRUCTIONS_MAX } from "@/lib/agent-messages";
import { workSettingsData, type WorkSettings } from "@/lib/agents/work-mode";

/**
 * Pairing an agent with its owner (#427), like a TV signing in to an account:
 *
 * 1. The agent starts pairing with its name. It gets a link for its owner
 *    and a secret device code to poll with.
 * 2. The owner, already signed in, opens the link, sees the name and approves.
 *    That creates the agent immediately, so it shows up under Your agents.
 * 3. The agent polls with the device code. The first poll after approval
 *    adds the key and returns it once. The raw key is not stored.
 *
 * Codes are stored as hashes, last 15 minutes and work once.
 */
export const PAIRING_TTL_MS = 15 * 60 * 1000;
/** How often the agent should poll, in seconds. */
export const PAIRING_POLL_INTERVAL = 5;
/**
 * An agent may only ask to be a working agent (#425); manager and merger are a
 * organisation admin's grant. Old role names are still accepted and mapped, so an
 * agent sending `level: "contributor"` keeps pairing.
 */
function parseRequestedLevel(level: unknown): { ok: true; level: AgentLevel } | { ok: false; error: string } {
  // #426: pair with the same default the settings page uses when none is asked for.
  if (level == null || level === "") return { ok: true, level: DEFAULT_AGENT_LEVEL };
  const normalized = normalizeAgentLevel(level);
  if (normalized === null) {
    return { ok: false, error: `Unknown level. Send one of: ${SELF_REGISTRATION_LEVELS.join(", ")}.` };
  }
  if (!(SELF_REGISTRATION_LEVELS as readonly string[]).includes(normalized)) {
    return { ok: false, error: "Agents cannot register as manager or merger agents. A organisation admin grants these classes later." };
  }
  return { ok: true, level: normalized };
}

/**
 * Standing instructions offered at pairing (#431). Optional; blank means none.
 * Text the agent proposes is only a suggestion shown to the owner. The agent is
 * created with whatever the owner approves, which may be edited or cleared.
 */
function parseInstructions(value: unknown): { ok: true; instructions: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, instructions: null };
  if (typeof value !== "string") return { ok: false, error: "Instructions must be text." };
  const trimmed = value.trim();
  if (trimmed.length > AGENT_INSTRUCTIONS_MAX) {
    return { ok: false, error: `Instructions must be ${AGENT_INSTRUCTIONS_MAX} characters or fewer.` };
  }
  return { ok: true, instructions: trimmed || null };
}

/** The page a signed-in person opens to approve the agent. The code is not the device secret. */
export function pairingApprovalPath(userCode: string): string {
  return `/settings/agents/pair?code=${encodeURIComponent(userCode)}`;
}

export type StartPairingResult =
  | { ok: true; userCode: string; deviceCode: string; expiresAt: Date }
  | { ok: false; error: string };

export async function startPairing(
  input: { name?: unknown; model?: unknown; level?: unknown; instructions?: unknown },
  now = new Date(),
): Promise<StartPairingResult> {
  const name = agentNameSchema.safeParse(input.name ?? "");
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message ?? "Send the agent's name." };
  const model = input.model == null ? null : agentModelSchema.safeParse(input.model);
  if (model && !model.success) return { ok: false, error: model.error.issues[0]?.message ?? "Invalid model." };
  const level = parseRequestedLevel(input.level);
  if (!level.ok) return { ok: false, error: level.error };
  const instructions = parseInstructions(input.instructions);
  if (!instructions.ok) return { ok: false, error: instructions.error };

  const userCode = generateUserCode();
  const deviceCode = generateDeviceCode();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  await prisma.agentPairing.create({
    data: {
      codeHash: hashSecret(normalizeUserCode(userCode)!),
      deviceCodeHash: hashSecret(deviceCode),
      proposedName: name.data,
      proposedModel: model?.data || null,
      proposedLevel: level.level,
      proposedInstructions: instructions.instructions,
      expiresAt,
    },
  });
  cleanupExpiredPairings(now).catch((error: unknown) => logger.error("[pairing] cleanup failed", error));
  return { ok: true, userCode, deviceCode, expiresAt };
}

export type PendingPairing = {
  id: string;
  proposedName: string;
  proposedModel: string | null;
  proposedLevel: AgentLevel | null;
  proposedInstructions: string | null;
  expiresAt: Date;
};

/** The pairing a typed code names, if it can still be approved. */
export async function findPendingPairing(userCode: string, now = new Date()): Promise<PendingPairing | null> {
  const code = normalizeUserCode(userCode);
  if (!code) return null;
  return prisma.agentPairing.findFirst({
    where: { codeHash: hashSecret(code), approvedAt: null, expiresAt: { gt: now } },
    select: { id: true, proposedName: true, proposedModel: true, proposedLevel: true, proposedInstructions: true, expiresAt: true },
  });
}

export type ApprovePairingResult = { ok: true; name: string } | { ok: false; error: string };

const CODE_NOT_FOUND = "That code doesn't match a waiting agent. It may have expired; ask the agent for a new one.";
const NO_ORGANISATION = "Join or create a team before you register agents.";

/**
 * The organisation this approval joins. A passed id must be one the person
 * belongs to. Omit it and the oldest membership, preferring Zedu, is used.
 */
async function organisationForApproval(userId: string, organisationId?: string | null): Promise<string | null> {
  if (organisationId) {
    const member = await prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId, userId } },
      select: { organisationId: true },
    });
    return member?.organisationId ?? null;
  }
  if (organisationId === null) return null;
  return (await organisationForOwner(userId))?.organisationId ?? null;
}

/**
 * The signed-in owner approves. Single use: the first approval wins.
 * `organisationId` is the organisation they are in now. `instructions` is the
 * standing brief the owner approved on the form (#431): the agent's proposal,
 * edited or cleared. Left out, the agent starts with none. `work` is the work
 * mode and caps the owner chose on the same form (#agent-work-mode); left out,
 * the agent has none until they choose.
 */
export async function approvePairing(
  owner: Actor,
  userCode: string,
  now = new Date(),
  organisationId?: string | null,
  instructions?: unknown,
  work?: WorkSettings,
): Promise<ApprovePairingResult> {
  const code = normalizeUserCode(userCode);
  if (!code) return { ok: false, error: CODE_NOT_FOUND };
  // Checked before the pairing is claimed, so too-long text doesn't burn the code.
  const approvedInstructions = parseInstructions(instructions);
  if (!approvedInstructions.ok) return { ok: false, error: approvedInstructions.error };
  const organisation = await organisationForApproval(owner.id, organisationId);
  if (!organisation) return { ok: false, error: NO_ORGANISATION };

  const codeHash = hashSecret(code);
  const result = await prisma.$transaction(async (tx) => {
    // Checked before the pairing is claimed, so hitting the cap does not burn
    // the code the person already typed (#511).
    if ((await countActiveAgents(tx, owner.id)) >= MAX_ACTIVE_AGENTS_PER_OWNER) return { ok: false, error: AGENT_LIMIT_MESSAGE } as const;
    const approved = await tx.agentPairing.updateMany({
      where: { codeHash, approvedAt: null, ownerUserId: null, expiresAt: { gt: now }, OR: [{ proposedLevel: null }, { proposedLevel: { in: [...SELF_REGISTRATION_LEVELS] } }] },
      data: { ownerUserId: owner.id, organisationId: organisation, approvedAt: now },
    });
    if (approved.count !== 1) return { ok: false, error: CODE_NOT_FOUND } as const;
    const pairing = await tx.agentPairing.findUnique({
      where: { codeHash },
      select: { id: true, proposedName: true, proposedModel: true, proposedLevel: true },
    });
    if (!pairing) return { ok: false, error: CODE_NOT_FOUND } as const;
    await attachApprovedAgent(tx, {
      id: pairing.id,
      proposedName: pairing.proposedName,
      proposedModel: pairing.proposedModel,
      proposedLevel: pairing.proposedLevel,
      instructions: approvedInstructions.instructions,
      work: work ? workSettingsData(work, now) : undefined,
      ownerUserId: owner.id,
      organisationId: organisation,
    });
    return { ok: true, name: pairing.proposedName } as const;
  });
  if (result.ok) {
    cleanupExpiredPairings(now).catch((error: unknown) => logger.error("[pairing] cleanup failed", error));
  }
  return result;
}

/**
 * An approval used to create the agent only after the agent polled for its key.
 * Those rows never appeared under Your agents when the poll failed. Create them
 * on the next visit so the list matches the approval.
 */
export async function materializeApprovedPairings(ownerUserId: string, organisationId: string): Promise<void> {
  const waiting = await prisma.agentPairing.findMany({
    where: { ownerUserId, organisationId, approvedAt: { not: null }, agentId: null, consumedAt: null },
    select: { id: true, proposedName: true, proposedModel: true, proposedLevel: true, ownerUserId: true, organisationId: true },
  });
  for (const pairing of waiting) {
    if (!pairing.ownerUserId || !pairing.organisationId) continue;
    try {
      await prisma.$transaction((tx) => attachApprovedAgent(tx, {
        id: pairing.id,
        proposedName: pairing.proposedName,
        proposedModel: pairing.proposedModel,
        proposedLevel: pairing.proposedLevel,
        ownerUserId: pairing.ownerUserId!,
        organisationId: pairing.organisationId!,
      }));
    } catch (error) {
      logger.error("[pairing] could not record approved agent", error);
    }
  }
}

type PairingTx = Prisma.TransactionClient;

/** The approved agent, created once. A second caller keeps the agent the first one stored. */
async function attachApprovedAgent(
  tx: PairingTx,
  pairing: {
    id: string;
    proposedName: string;
    proposedModel: string | null;
    proposedLevel: AgentLevel | null;
    /** The brief the owner approved (#431); never the agent's unreviewed proposal. */
    instructions?: string | null;
    /** The work mode and caps the owner chose on approval (#agent-work-mode). */
    work?: ReturnType<typeof workSettingsData>;
    ownerUserId: string;
    organisationId: string;
  },
): Promise<string> {
  const requested = parseRequestedLevel(pairing.proposedLevel);
  if (!requested.ok) throw new Error(requested.error);
  const created = await tx.agent.create({
    data: {
      ownerUserId: pairing.ownerUserId,
      name: pairing.proposedName,
      // #agent-profile: its @username starts as its name; it can change it.
      username: await freeUsername(tx, pairing.organisationId, pairing.proposedName),
      model: pairing.proposedModel,
      // #user-agents: active in the organisation that approved it.
      activations: { create: { organisationId: pairing.organisationId, level: pairing.proposedLevel ?? DEFAULT_AGENT_LEVEL } },
      ...(pairing.instructions ? { instructions: pairing.instructions } : {}),
      ...(pairing.work ?? {}),
    },
    select: { id: true },
  });
  const linked = await tx.agentPairing.updateMany({
    where: { id: pairing.id, agentId: null },
    data: { agentId: created.id },
  });
  if (linked.count !== 1) {
    await tx.agent.delete({ where: { id: created.id } });
    const existing = await tx.agentPairing.findUnique({ where: { id: pairing.id }, select: { agentId: true } });
    if (existing?.agentId) return existing.agentId;
    throw new Error("Could not record the approved agent.");
  }
  await audit(
    { agentId: created.id, organisationId: pairing.organisationId },
    "agent.created",
    `agent:${created.id}`,
    {
      name: pairing.proposedName,
      model: pairing.proposedModel,
      level: pairing.proposedLevel ?? DEFAULT_AGENT_LEVEL,
      via: "pairing",
      instructionsLength: pairing.instructions?.length ?? 0,
      ...(pairing.work ? { workMode: pairing.work.workMode } : {}),
    },
    { actorUserId: pairing.ownerUserId, db: tx },
  );
  return created.id;
}

export type CollectResult =
  | { status: "issued"; key: IssuedKey; organisationId: string }
  | { status: "pending" }
  | { status: "expired" }
  | { status: "used" }
  | { status: "invalid" };

/** The waiting agent polls. Returns the key exactly once after approval. */
export async function collectPairing(deviceCode: unknown, now = new Date()): Promise<CollectResult> {
  if (typeof deviceCode !== "string" || deviceCode.length < 20 || deviceCode.length > 200) {
    return { status: "invalid" };
  }
  const deviceCodeHash = hashSecret(deviceCode);
  const pairing = await prisma.agentPairing.findUnique({
    where: { deviceCodeHash },
    select: {
      id: true,
      proposedName: true,
      proposedModel: true,
      proposedLevel: true,
      expiresAt: true,
      approvedAt: true,
      consumedAt: true,
      ownerUserId: true,
      organisationId: true,
      agentId: true,
    },
  });
  if (!pairing) return { status: "invalid" };
  if (pairing.consumedAt) return { status: "used" };
  if (!pairing.agentId && !parseRequestedLevel(pairing.proposedLevel).ok) return { status: "invalid" };
  if (!pairing.approvedAt || !pairing.ownerUserId || !pairing.organisationId) {
    return pairing.expiresAt <= now ? { status: "expired" } : { status: "pending" };
  }
  // Approved in time: collecting may finish after the code's expiry, but
  // not long after, so an approved code isn't usable forever.
  if (pairing.expiresAt.getTime() + PAIRING_TTL_MS <= now.getTime()) return { status: "expired" };

  const { ownerUserId, organisationId, agentId } = pairing;

  return prisma.$transaction(async (tx) => {
    // Two polls racing: only one marks it consumed and gets the key.
    const claimed = await tx.agentPairing.updateMany({
      where: { id: pairing.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) return { status: "used" } as const;
    if (agentId) {
      // The owner may have changed the agent's level after approval; report
      // the level the key actually works at, not the one asked for (#1182).
      const activation = await tx.agentActivation.findUnique({
        where: { agentId_organisationId: { agentId, organisationId } },
        select: { level: true },
      });
      const key = generateApiKey();
      await tx.agentApiKey.create({
        data: { agentId, organisationId, keyHash: key.hash, prefix: key.prefix },
      });
      return {
        status: "issued",
        key: { agentId, name: pairing.proposedName, level: activation?.level ?? pairing.proposedLevel ?? DEFAULT_AGENT_LEVEL, rawKey: key.raw, prefix: key.prefix },
        organisationId,
      } as const;
    }
    const key = await insertAgentWithKey(tx, {
      organisationId,
      ownerUserId,
      name: pairing.proposedName,
      model: pairing.proposedModel,
      level: pairing.proposedLevel ?? DEFAULT_AGENT_LEVEL,
    });
    await tx.agentPairing.update({ where: { id: pairing.id }, data: { agentId: key.agentId } });
    await audit(
      { agentId: key.agentId, organisationId },
      "agent.created",
      `agent:${key.agentId}`,
      { name: key.name, model: pairing.proposedModel, level: pairing.proposedLevel ?? DEFAULT_AGENT_LEVEL, via: "pairing" },
      { actorUserId: ownerUserId, db: tx },
    );
    return { status: "issued", key, organisationId } as const;
  });
}

/**
 * Deletes expired pairings that were never approved or consumed (#673).
 *
 * Removes unapproved pairing codes whose TTL has passed to prevent database
 * bloat and eliminate stale pairing attempts.
 */
export async function cleanupExpiredPairings(now = new Date()): Promise<{ count: number }> {
  const result = await prisma.agentPairing.deleteMany({
    where: {
      expiresAt: { lt: now },
      approvedAt: null,
      consumedAt: null,
    },
  });
  return { count: result?.count ?? 0 };
}
