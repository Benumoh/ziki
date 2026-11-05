import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { detectAttachmentType } from "@/lib/attachments";
import {
  agentProfileUpdateSchema,
  agentSkillSchema,
  agentSkillsReplaceSchema,
  agentSkillUpsertSchema,
  skillTagNameSchema,
  tagSlug,
  usernameFromName,
  type AgentSkillInput,
} from "@/lib/validations/agent-profile";

/**
 * Agent profiles (#agent-profile): @username, tagline, "About me", rating,
 * skills under shared tags, and a profile picture. The agent sets its own
 * through the API; its owner or a team admin edits the text from its page.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The largest profile picture, in bytes. */
export const AGENT_PICTURE_MAX_BYTES = 1_000_000;

/** Who changed it, for the audit row: the agent itself, or a person on its page. */
export type ProfileActor = { agentId: string; tenantId: string; actorUserId?: string | null };

export type ProfileResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export type AgentSkillView = { tag: string; slug: string; summary: string; description: string };

export type AgentProfileView = {
  username: string | null;
  tagline: string | null;
  about: string | null;
  rating: number | null;
  /** Where the picture is served; null with none. */
  picture_url: string | null;
  skills: AgentSkillView[];
};

/** The picture's address for agents (key) and people (session), with its version so a new one isn't cached. */
export function agentPicturePath(agent: { id: string; username: string | null }, updatedAt: Date, audience: "api" | "web"): string {
  const version = updatedAt.getTime().toString(36);
  return audience === "api" && agent.username
    ? `/api/v1/agents/${agent.username}/picture?v=${version}`
    : `/api/agent-pictures/${agent.id}?v=${version}`;
}

const skillSelect = {
  summary: true,
  description: true,
  position: true,
  tag: { select: { name: true, slug: true } },
} as const;

function skillView(skill: { summary: string; description: string; tag: { name: string; slug: string } }): AgentSkillView {
  return { tag: skill.tag.name, slug: skill.tag.slug, summary: skill.summary, description: skill.description };
}

/** An agent's profile, for the API and its page. */
export async function readAgentProfile(agentId: string, audience: "api" | "web" = "api", db: Db = prisma): Promise<AgentProfileView | null> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      username: true,
      tagline: true,
      about: true,
      rating: true,
      picture: { select: { updatedAt: true } },
      skills: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: skillSelect },
    },
  });
  if (!agent) return null;
  return {
    username: agent.username,
    tagline: agent.tagline,
    about: agent.about,
    rating: agent.rating,
    picture_url: agent.picture ? agentPicturePath(agent, agent.picture.updatedAt, audience) : null,
    skills: agent.skills.map(skillView),
  };
}

/** A username free in the workspace, from the agent's name: "dara-solver", then "dara-solver-2", … */
export async function freeUsername(db: Db, tenantId: string, name: string, exceptAgentId?: string): Promise<string> {
  const base = usernameFromName(name);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await db.agent.findFirst({
      where: { tenantId, username: candidate, ...(exceptAgentId ? { id: { not: exceptAgentId } } : {}) },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function firstIssue(error: { issues: Array<{ message: string }> }, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

/** Set any of username, tagline and about. A username another agent in the workspace has is refused (409). */
export async function updateAgentProfile(actor: ProfileActor, input: unknown): Promise<ProfileResult<{ profile: AgentProfileView }>> {
  const parsed = agentProfileUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: firstIssue(parsed.error, "Check the profile.") };
  const update = parsed.data;

  if (update.username !== undefined) {
    const taken = await prisma.agent.findFirst({
      where: { tenantId: actor.tenantId, username: update.username, id: { not: actor.agentId } },
      select: { id: true },
    });
    if (taken) return { ok: false, status: 409, error: `@${update.username} is taken in this workspace. Pick another.` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.agent.findUniqueOrThrow({
        where: { id: actor.agentId },
        select: { username: true, tagline: true, about: true },
      });
      await tx.agent.update({ where: { id: actor.agentId }, data: update });
      const changed = (Object.keys(update) as Array<keyof typeof update>).filter((key) => before[key] !== update[key]);
      if (changed.length) {
        await audit(
          { agentId: actor.agentId, tenantId: actor.tenantId },
          "agent.profile_updated",
          `agent:${actor.agentId}`,
          { fields: changed, ...(update.username !== undefined ? { username: { from: before.username, to: update.username } } : {}) },
          { actorUserId: actor.actorUserId ?? null, db: tx },
        );
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, status: 409, error: "That username was just taken. Pick another." };
    }
    throw error;
  }
  const profile = await readAgentProfile(actor.agentId);
  return { ok: true, profile: profile! };
}

/** The workspace's tag for this name, made if new. The first spelling stays the tag's name. */
async function tagFor(tx: Prisma.TransactionClient, tenantId: string, name: string) {
  const slug = tagSlug(name);
  return tx.skillTag.upsert({
    where: { tenantId_slug: { tenantId, slug } },
    update: {},
    create: { tenantId, slug, name: name.trim() },
    select: { id: true },
  });
}

async function auditSkills(tx: Prisma.TransactionClient, actor: ProfileActor, change: Prisma.InputJsonObject) {
  await audit(
    { agentId: actor.agentId, tenantId: actor.tenantId },
    "agent.skills_changed",
    `agent:${actor.agentId}`,
    change,
    { actorUserId: actor.actorUserId ?? null, db: tx },
  );
}

/** Replace the whole skills list, in order. */
export async function replaceAgentSkills(actor: ProfileActor, input: unknown): Promise<ProfileResult<{ skills: AgentSkillView[] }>> {
  const parsed = agentSkillsReplaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: firstIssue(parsed.error, "Check the skills.") };
  await prisma.$transaction(async (tx) => {
    await tx.agentSkill.deleteMany({ where: { agentId: actor.agentId } });
    for (const [position, skill] of parsed.data.skills.entries()) {
      const tag = await tagFor(tx, actor.tenantId, skill.tag);
      await tx.agentSkill.create({
        data: { agentId: actor.agentId, tagId: tag.id, summary: skill.summary, description: skill.description, position },
      });
    }
    await auditSkills(tx, actor, { replaced: parsed.data.skills.map((skill) => tagSlug(skill.tag)) });
  });
  return { ok: true, skills: (await readAgentProfile(actor.agentId))!.skills };
}

/** Add one skill, or change this agent's text for a tag it already has. New skills go last. */
export async function setAgentSkill(actor: ProfileActor, tagName: string, input: unknown): Promise<ProfileResult<{ skill: AgentSkillView; created: boolean }>> {
  const tag = skillTagNameSchema.safeParse(tagName);
  if (!tag.success) return { ok: false, status: 400, error: firstIssue(tag.error, "Check the tag.") };
  const parsed = agentSkillUpsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: firstIssue(parsed.error, "Check the skill.") };
  const skill: AgentSkillInput = { tag: tag.data, ...parsed.data };
  agentSkillSchema.parse(skill);

  const result = await prisma.$transaction(async (tx) => {
    const existingTag = await tx.skillTag.findUnique({
      where: { tenantId_slug: { tenantId: actor.tenantId, slug: tagSlug(skill.tag) } },
      select: { id: true },
    });
    const current = existingTag
      ? await tx.agentSkill.findUnique({ where: { agentId_tagId: { agentId: actor.agentId, tagId: existingTag.id } }, select: { id: true } })
      : null;
    if (!current) {
      const count = await tx.agentSkill.count({ where: { agentId: actor.agentId } });
      if (count >= 20) return { full: true as const };
    }
    const tagRow = existingTag ?? (await tagFor(tx, actor.tenantId, skill.tag));
    const last = await tx.agentSkill.aggregate({ where: { agentId: actor.agentId }, _max: { position: true } });
    const saved = await tx.agentSkill.upsert({
      where: { agentId_tagId: { agentId: actor.agentId, tagId: tagRow.id } },
      update: { summary: skill.summary, description: skill.description },
      create: {
        agentId: actor.agentId,
        tagId: tagRow.id,
        summary: skill.summary,
        description: skill.description,
        position: (last._max.position ?? -1) + 1,
      },
      select: skillSelect,
    });
    await auditSkills(tx, actor, { [current ? "updated" : "added"]: tagSlug(skill.tag) });
    return { full: false as const, skill: skillView(saved), created: !current };
  });
  if (result.full) return { ok: false, status: 409, error: "An agent has at most 20 skills. Remove one first." };
  return { ok: true, skill: result.skill, created: result.created };
}

/** Remove one skill by its tag. The tag stays for the workspace's other agents. */
export async function removeAgentSkill(actor: ProfileActor, tagName: string): Promise<ProfileResult> {
  const slug = tagSlug(tagName);
  const tag = slug
    ? await prisma.skillTag.findUnique({ where: { tenantId_slug: { tenantId: actor.tenantId, slug } }, select: { id: true } })
    : null;
  if (!tag) return { ok: false, status: 404, error: "This agent has no skill with that tag." };
  return prisma.$transaction(async (tx): Promise<ProfileResult> => {
    const removed = await tx.agentSkill.deleteMany({ where: { agentId: actor.agentId, tagId: tag.id } });
    if (!removed.count) return { ok: false, status: 404, error: "This agent has no skill with that tag." };
    await auditSkills(tx, actor, { removed: slug });
    return { ok: true };
  });
}

/** The workspace's skill tags, most used first, so agents reuse them instead of making near-duplicates. */
export async function listSkillTags(tenantId: string): Promise<Array<{ name: string; slug: string; agents: number }>> {
  const tags = await prisma.skillTag.findMany({
    where: { tenantId },
    select: { name: true, slug: true, _count: { select: { skills: true } } },
  });
  return tags
    .map((tag) => ({ name: tag.name, slug: tag.slug, agents: tag._count.skills }))
    .sort((a, b) => b.agents - a.agents || a.name.localeCompare(b.name));
}

/** Upload or replace the profile picture: PNG, JPEG, GIF or WebP, judged by the bytes, at most 1 MB. */
export async function setAgentPicture(actor: ProfileActor, bytes: Uint8Array): Promise<ProfileResult<{ picture_url: string }>> {
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: "The file is empty." };
  if (bytes.byteLength > AGENT_PICTURE_MAX_BYTES) return { ok: false, status: 413, error: "Over 1 MB. Send a smaller picture." };
  const type = detectAttachmentType(bytes, "picture");
  if (!type || type.kind !== "image") return { ok: false, status: 415, error: "Send a PNG, JPEG, GIF or WebP image." };
  const saved = await prisma.$transaction(async (tx) => {
    const picture = await tx.agentPicture.upsert({
      where: { agentId: actor.agentId },
      update: { contentType: type.contentType, size: bytes.byteLength, data: Buffer.from(bytes) },
      create: { agentId: actor.agentId, contentType: type.contentType, size: bytes.byteLength, data: Buffer.from(bytes) },
      select: { updatedAt: true, agent: { select: { id: true, username: true } } },
    });
    await audit(
      { agentId: actor.agentId, tenantId: actor.tenantId },
      "agent.picture_changed",
      `agent:${actor.agentId}`,
      { contentType: type.contentType, size: bytes.byteLength },
      { actorUserId: actor.actorUserId ?? null, db: tx },
    );
    return picture;
  });
  return { ok: true, picture_url: agentPicturePath(saved.agent, saved.updatedAt, "api") };
}

/** Remove the profile picture; its avatar shows again. */
export async function removeAgentPicture(actor: ProfileActor): Promise<ProfileResult> {
  return prisma.$transaction(async (tx): Promise<ProfileResult> => {
    const removed = await tx.agentPicture.deleteMany({ where: { agentId: actor.agentId } });
    if (!removed.count) return { ok: false, status: 404, error: "This agent has no picture." };
    await audit(
      { agentId: actor.agentId, tenantId: actor.tenantId },
      "agent.picture_removed",
      `agent:${actor.agentId}`,
      {},
      { actorUserId: actor.actorUserId ?? null, db: tx },
    );
    return { ok: true };
  });
}

/**
 * An agent's rating out of 5: the share of other agents' judgements and merge
 * reviews of its delivered work that were positive, times 5, to one decimal.
 * Null with no reviews.
 */
export async function computeAgentRating(db: Db, agentId: string): Promise<number | null> {
  const delivered = await db.delivery.findMany({ where: { agentId }, select: { bugId: true } });
  if (!delivered.length) return null;
  const where = { bugId: { in: delivered.map((d) => d.bugId) }, NOT: { agentId } };
  const [judged, judgedGood, reviewed, accepted] = await Promise.all([
    db.testVerdict.count({ where }),
    db.testVerdict.count({ where: { ...where, goodToMerge: true } }),
    db.mergeReview.count({ where }),
    db.mergeReview.count({ where: { ...where, verdict: "accept" } }),
  ]);
  const total = judged + reviewed;
  if (!total) return null;
  return Math.round(((judgedGood + accepted) / total) * 50) / 10;
}

/** Recompute the ratings of every agent that delivered on this issue, after a judgement or merge review. */
export async function refreshIssueRatings(db: Db, bugId: string): Promise<void> {
  const deliverers = await db.delivery.findMany({ where: { bugId }, select: { agentId: true } });
  for (const { agentId } of deliverers) {
    const rating = await computeAgentRating(db, agentId);
    await db.agent.update({ where: { id: agentId }, data: { rating } });
  }
}
