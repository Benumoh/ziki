import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { convertSoloIdea } from "@/lib/agent-api/idea-verdicts";
import { invalidateWorkflow } from "@/lib/workflow";

/**
 * Solo projects (#solo). The owner works on the project with their own agents only: nobody else is a member, no other
 * person's agent works in the organisation, and the project isn't public. Then nothing needs protecting from anyone, so
 * the steps that exist to protect money or to bring strangers in are skipped:
 * - ideas become issues at once (no verdicts: an idea's owner can't vote on it, and there is nobody else);
 * - one confirmation from the owner's own agent is enough: it still checks the issue is real and not a duplicate;
 * - no estimates, prices, funding or payments (lib/coins/budget.ts, lib/coins/issue-payout.ts);
 * - one judgement and the owner's review are enough after delivery (lib/workflow.ts soloWorkflow).
 * Testing and review still happen. Opening the project to other people or agents ends Solo.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type SoloBlock = "public" | "members" | "agents";

/**
 * Why no project in this organisation can be Solo now, or null when one can: someone other than its owners and admins
 * is a member, or another person's agent (an on-call guest included) works in it. What a new project's form asks.
 */
export async function organisationSoloBlock(db: Db, organisationId: string, projectId?: string): Promise<Exclude<SoloBlock, "public"> | null> {
  const owners = await db.membership.findMany({ where: { organisationId, role: { in: ["owner", "admin"] } }, select: { userId: true } });
  const ownerIds = owners.map((owner) => owner.userId);
  const [member, projectMember, agent] = await Promise.all([
    db.membership.findFirst({ where: { organisationId, role: { notIn: ["owner", "admin"] } }, select: { id: true } }),
    projectId ? db.projectMembership.findFirst({ where: { projectId, userId: { notIn: ownerIds } }, select: { id: true } }) : null,
    // Another person's agent working in the organisation, an on-call guest included.
    db.agentActivation.findFirst({
      where: { organisationId, deactivatedAt: null, guestEndedAt: null, agent: { revokedAt: null, ownerUserId: { notIn: ownerIds } } },
      select: { id: true },
    }),
  ]);
  if (member || projectMember) return "members";
  if (agent) return "agents";
  return null;
}

/** Why this project can't be Solo now, or null when it can: someone other than its owners and admins could work in it. */
export async function soloBlock(db: Db, projectId: string): Promise<SoloBlock | null> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { organisationId: true, visibility: true, isOpenForContributors: true } });
  if (!project) return null;
  if (project.visibility === "public" || project.isOpenForContributors) return "public";
  return organisationSoloBlock(db, project.organisationId, projectId);
}

export const SOLO_BLOCK_MESSAGE: Record<SoloBlock, string> = {
  public: "This project is public, so other people and agents can work on it. Make it private first.",
  members: "Other people are members here. Solo is for working on your own, with your own agents.",
  agents: "Other people's agents work in this organisation. Solo is for working with your own agents only.",
};

export async function isSoloProject(db: Db, projectId: string): Promise<boolean> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { solo: true } });
  return Boolean(project?.solo);
}

/** Turns Solo on or off for a project. On is refused while someone else could work in it. Callers check the person may. */
export async function setSolo(projectId: string, solo: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (solo) {
    const block = await soloBlock(prisma, projectId);
    if (block) return { ok: false, error: SOLO_BLOCK_MESSAGE[block] };
  }
  await prisma.project.update({ where: { id: projectId }, data: { solo } });
  invalidateWorkflow(projectId);
  if (solo) await convertSoloIdeas({ projectId });
  return { ok: true };
}

/** Ends Solo when a project is opened to other people or agents. Safe to call on any project. */
export async function endSolo(db: Db, projectId: string): Promise<void> {
  const { count } = await db.project.updateMany({ where: { id: projectId, solo: true }, data: { solo: false } });
  if (count > 0) invalidateWorkflow(projectId);
}

/**
 * Ends Solo on any project where someone else can now work (#solo): a member invited, another person's agent added
 * (an on-call guest included), or the project made public. Many paths add people, so the cron sweep checks rather
 * than each of them. Returns how many projects stopped being Solo.
 */
export async function endBrokenSolo(): Promise<number> {
  const projects = await prisma.project.findMany({ where: { solo: true }, select: { id: true } });
  let ended = 0;
  for (const project of projects) {
    if (await soloBlock(prisma, project.id)) {
      await endSolo(prisma, project.id);
      ended += 1;
    }
  }
  return ended;
}

/**
 * Turns the open ideas of Solo projects into issues (#solo): when an idea is filed, when a project turns Solo, and in
 * the cron sweep as a catch-up. Each in its own transaction, so one that can't be converted (one waiting for a human
 * approval, say) doesn't hold up the rest.
 */
export async function convertSoloIdeas(scope: { projectId?: string; ideaId?: string } = {}, limit = 50): Promise<number> {
  const ideas = await prisma.idea.findMany({
    where: {
      ...(scope.ideaId ? { id: scope.ideaId } : {}),
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      status: "open",
      isDeleted: false,
      project: { solo: true },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, organisationId: true, projectId: true },
  });
  let converted = 0;
  for (const idea of ideas) {
    try {
      const made = await prisma.$transaction((tx) => convertSoloIdea(tx, { organisationId: idea.organisationId, projectId: idea.projectId }, idea.id));
      if (made) converted += 1;
    } catch (error) {
      logger.warn(`[solo] idea ${idea.id} was not converted: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return converted;
}
