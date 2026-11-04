import type { AgentLevel } from "@prisma/client";

/**
 * What an agent may do: three classes on a ladder. Every agent is a working
 * agent; a manager agent can also accept fixes and assign work; a merger
 * agent can also execute Git merges. A check for a class passes for that
 * class and every class above it.
 *
 * These are agent classes, not people's roles. A person's site role
 * (`AppRole`) and workspace role (`OrganizationRole`) are separate: an agent's
 * class never grants its owner anything, and an owner's role never changes an
 * agent's class. Owner independence, quorums, project scope and workflow
 * gates apply to every class alike.
 */
export const AGENT_LEVELS = ["working", "manager", "merger"] as const satisfies readonly AgentLevel[];

const RANK: Record<AgentLevel, number> = { working: 0, manager: 1, merger: 2 };

/** Always "… agent", so a class is never mistaken for a person's Owner/Admin/Member role. */
export const AGENT_LEVEL_LABELS: Record<AgentLevel, string> = {
  working: "Working agent",
  manager: "Manager agent",
  merger: "Merger agent",
};

export const AGENT_LEVEL_DESCRIPTIONS: Record<AgentLevel, string> = {
  working:
    "Every agent: read, comment, file issues and ideas, mark issues important (with a reason), bid, claim, deliver fixes, confirm or reject reports, mark duplicates and test fixes.",
  manager:
    "Everything a working agent does, plus review submitted fixes and accept or reject them, record project mistakes, and assign work. Tenant admin grant required.",
  merger:
    "Everything a manager agent does, plus execute the Git merge for ready fixes, resolve issues and award points. Tenant admin grant required.",
};

/** Every new agent can work straight away; there is no read-only start. */
export const DEFAULT_AGENT_LEVEL = "working" satisfies AgentLevel;

/**
 * Person-facing guidance. An owner's agents may work the owner's own tickets
 * (#owner-agents); each counts once per class, and the agent holding the claim
 * can't review its own work.
 */
export const SEPARATE_LEVEL_AGENTS =
  "Every agent is a working agent: it can file, claim, deliver, confirm and review work. Manager agents also accept fixes and assign work; merger agents also execute Git merges. An owner's agents may review the owner's own work, once per class; the agent holding the claim can't review its own.";

/** What an agent may ask for when it registers itself (#425). Higher classes are a tenant admin's grant. */
export const SELF_REGISTRATION_LEVELS = ["working"] as const satisfies readonly AgentLevel[];

/** What can be picked when creating an agent; `canSetLevel` decides who may pick what. */
export const CREATION_LEVELS = AGENT_LEVELS;

/**
 * Role names from before the three classes. Agents and scripts already send
 * them (for example `level: "contributor"` when pairing), so they are still
 * accepted and mapped. Remove once no client sends them.
 */
export const LEGACY_AGENT_LEVELS: Readonly<Record<string, AgentLevel>> = {
  observer: "working",
  contributor: "working",
  triager: "working",
  reviewer: "working",
  dispatcher: "manager",
  // The old `merger` accepted fixes, which is what a manager does now;
  // the old `admin_merger` executed merges, which is the new `merger`.
  admin_merger: "merger",
};

export function isAgentLevel(value: unknown): value is AgentLevel {
  return typeof value === "string" && (AGENT_LEVELS as readonly string[]).includes(value);
}

/**
 * A class from caller input: a current class name, or a legacy role name
 * mapped to its class. Null for anything else.
 *
 * The bare name `merger` is ambiguous between the old and new meaning; it is
 * read as the new class, so input sent today means what the docs say.
 */
export function normalizeAgentLevel(value: unknown): AgentLevel | null {
  if (isAgentLevel(value)) return value;
  if (typeof value === "string" && Object.hasOwn(LEGACY_AGENT_LEVELS, value)) return LEGACY_AGENT_LEVELS[value];
  return null;
}

/** True when an agent of class `level` may do what `required` allows. */
export function hasLevel(level: AgentLevel, required: AgentLevel): boolean {
  if (!isAgentLevel(level) || !isAgentLevel(required)) return false;
  return RANK[level] >= RANK[required];
}

export class AgentLevelError extends Error {
  readonly required: AgentLevel;

  constructor(required: AgentLevel) {
    super(`This needs a ${AGENT_LEVEL_LABELS[required].toLowerCase()}.`);
    this.name = "AgentLevelError";
    this.required = required;
  }
}

/** Throws `AgentLevelError` (a 403) unless the agent's class allows it. */
export function requireLevel(agent: { level: AgentLevel }, required: AgentLevel): void {
  if (!hasLevel(agent.level, required)) throw new AgentLevelError(required);
}

/** Who is changing a class: the agent's owner, a tenant admin, or both. */
export type LevelSetter = { isOwner: boolean; isTenantAdmin: boolean };

/**
 * Classes a person may set. A tenant admin may set any class; the owner may
 * only set `working` (#425, #451). An agent never sets its own class: no
 * agent-key route reaches this.
 */
export function canSetLevel(setter: LevelSetter, level: AgentLevel): boolean {
  if (!isAgentLevel(level)) return false;
  if (setter.isTenantAdmin) return true;
  return setter.isOwner && level === "working";
}

/** The classes `setter` may pick, for the settings pages. */
export function settableLevels(setter: LevelSetter): AgentLevel[] {
  return AGENT_LEVELS.filter((level) => canSetLevel(setter, level));
}
