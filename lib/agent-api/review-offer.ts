import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertKeyProject, type AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import {
  reviewerConflict,
  ReviewerNotIndependentError,
  type ReviewedBug,
} from "@/lib/agents/independence";
import { workflowFor } from "@/lib/workflow";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";

export const REVIEW_OFFER_TTL_MS = 30 * 60_000; // 30 minutes to accept
export const REVIEW_DEADLINE_MS = 30 * 60_000; // 30 minutes to review after acceptance
export const DEFAULT_REVIEW_VERDICTS_NEEDED = DEFAULT_PROJECT_WORKFLOW.verdictsNeeded;

type Db = typeof prisma | Prisma.TransactionClient;

export type ReviewOfferCandidate = {
  beneficiaryUserId: string;
  agentId: string;
  activeWorkload: number;
  lastOfferedAt: Date | null;
  pendingOffer?: boolean;
};

export function isReviewOfferExpired(offeredAt: Date | null, now = Date.now()): boolean {
  return !offeredAt || now - offeredAt.getTime() >= REVIEW_OFFER_TTL_MS;
}

export function isReviewDeadlineExpired(deadlineAt: Date | null, now = Date.now()): boolean {
  return !deadlineAt || now >= deadlineAt.getTime();
}

/**
 * Ranks review candidates by active workload (ascending), then longest wait
 * since last offer (oldest first, nulls first), then alphabetically by beneficiary.
 */
export function rankReviewOfferCandidates<T extends ReviewOfferCandidate>(candidates: T[]): T[] {
  return [...candidates].sort(
    (a, b) =>
      a.activeWorkload - b.activeWorkload ||
      (a.lastOfferedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
        (b.lastOfferedAt?.getTime() ?? Number.NEGATIVE_INFINITY) ||
      a.beneficiaryUserId.localeCompare(b.beneficiaryUserId),
  );
}

function scheduleReviewOfferExpiry(offerId: string, ttlMs = REVIEW_OFFER_TTL_MS): void {
  setTimeout(() => {
    void expireReviewOffer(offerId).catch(() => undefined);
  }, ttlMs);
}

function scheduleReviewDeadlineExpiry(offerId: string, deadlineMs = REVIEW_DEADLINE_MS): void {
  setTimeout(() => {
    void expireReviewOffer(offerId).catch(() => undefined);
  }, deadlineMs);
}

const bugReviewSelect = {
  id: true,
  tenantId: true,
  projectId: true,
  title: true,
  status: true,
  pullRequestUrl: true,
  beneficiaryUserId: true,
  assigneeId: true,
  reporterId: true,
  createdByAgentId: true,
  createdByAgent: { select: { ownerUserId: true } },
  claims: {
    select: {
      status: true,
      releasedAt: true,
      agentId: true,
      beneficiaryUserId: true,
      dispatcherUserId: true,
      agent: { select: { ownerUserId: true } },
    },
  },
} satisfies Prisma.BugSelect;

type LoadedBug = Prisma.BugGetPayload<{ select: typeof bugReviewSelect }>;

/**
 * Finds eligible reviewer candidates for a bug in the given tenant, enforces
 * independence, and sorts them according to the fairness policy.
 */
async function findEligibleReviewerCandidates(
  db: Db,
  tenantId: string,
  bug: LoadedBug,
  excludeUserIds: Set<string> = new Set(),
): Promise<ReviewOfferCandidate[]> {
  // Reviewers: members of the tenant with an active agent. Every agent class may review.
  const memberships = await db.membership.findMany({
    where: {
      tenantId,
      user: {
        agents: {
          some: {
            tenantId,
            revokedAt: null,
          },
        },
      },
    },
    select: {
      userId: true,
      user: {
        select: {
          agents: {
            where: {
              tenantId,
              revokedAt: null,
            },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });

  const reviewed: ReviewedBug = bug;

  const people = memberships.flatMap((m) => {
    const agent = m.user.agents[0];
    if (!agent || excludeUserIds.has(m.userId)) return [];

    // Verify independence from the solver, reporter, creator, and ticket beneficiary (#442).
    const conflict = reviewerConflict({ id: agent.id, ownerUserId: m.userId }, reviewed);
    if (conflict) return [];

    return [{ beneficiaryUserId: m.userId, agentId: agent.id }];
  });

  if (!people.length) return [];

  const userIds = people.map((p) => p.beneficiaryUserId);

  // Active workload: active claims + active/offered review offers
  const activeClaims = await db.issueClaim.groupBy({
    by: ["beneficiaryUserId"],
    where: {
      beneficiaryUserId: { in: userIds },
      releasedAt: null,
      status: "active",
      bug: { tenantId },
    },
    _count: { _all: true },
  });
  const claimCounts = new Map(activeClaims.map((r) => [r.beneficiaryUserId, r._count._all]));

  let reviewCounts = new Map<string, number>();
  const lastOffered = new Map<string, Date>();
  let pendingSet = new Set<string>();

  if (typeof (db as { reviewOffer?: unknown }).reviewOffer !== "undefined") {
    const activeReviews = await db.reviewOffer.groupBy({
      by: ["beneficiaryUserId"],
      where: {
        beneficiaryUserId: { in: userIds },
        status: { in: ["offered", "accepted"] },
      },
      _count: { _all: true },
    });
    reviewCounts = new Map(activeReviews.map((r) => [r.beneficiaryUserId, r._count._all]));

    const pastOffers = await db.reviewOffer.findMany({
      where: { beneficiaryUserId: { in: userIds } },
      orderBy: { offeredAt: "desc" },
      select: { beneficiaryUserId: true, offeredAt: true },
    });
    for (const row of pastOffers) {
      if (row.offeredAt && !lastOffered.has(row.beneficiaryUserId)) {
        lastOffered.set(row.beneficiaryUserId, row.offeredAt);
      }
    }

    const pendingCutoff = new Date(Date.now() - REVIEW_OFFER_TTL_MS);
    const pending = await db.reviewOffer.findMany({
      where: {
        beneficiaryUserId: { in: userIds },
        status: "offered",
        offeredAt: { gt: pendingCutoff },
      },
      select: { beneficiaryUserId: true },
    });
    pendingSet = new Set(pending.map((r) => r.beneficiaryUserId));
  }

  const candidates: ReviewOfferCandidate[] = people.map((p) => ({
    ...p,
    activeWorkload: (claimCounts.get(p.beneficiaryUserId) ?? 0) + (reviewCounts.get(p.beneficiaryUserId) ?? 0),
    lastOfferedAt: lastOffered.get(p.beneficiaryUserId) ?? null,
    pendingOffer: pendingSet.has(p.beneficiaryUserId),
  }));

  return rankReviewOfferCandidates(candidates);
}

export type CreateReviewOffersOptions = {
  pullRequestUrl: string;
  headSha?: string | null;
  verdictsNeeded?: number;
};

/**
 * Creates `verdictsNeeded` review offers for independent reviewers upon pull request linking (#597).
 * Ensures no two reviewers share an owner, and publishes `review.requested`.
 */
export async function createReviewOffers(
  db: Db,
  caller: { agentId?: string; tenantId: string },
  bugId: string,
  options: CreateReviewOffersOptions,
) {
  const bug = await db.bug.findFirst({
    where: { id: bugId, tenantId: caller.tenantId, isDeleted: false },
    select: bugReviewSelect,
  });
  if (!bug) return { offers: [] };

  const verdictsNeeded =
    options.verdictsNeeded ?? (await workflowFor(bug.projectId, db)).verdictsNeeded;

  // Determine existing reviewers already holding an active/accepted/completed offer for this bug
  const excludeUserIds = new Set<string>();

  if (typeof (db as { reviewOffer?: unknown }).reviewOffer !== "undefined") {
    const existingOffers = await db.reviewOffer.findMany({
      where: {
        bugId,
        status: { in: ["offered", "accepted", "completed"] },
      },
      select: { beneficiaryUserId: true, agentId: true, status: true, offeredAt: true },
    });

    for (const o of existingOffers) {
      if (o.status === "offered" && !isReviewOfferExpired(o.offeredAt)) {
        excludeUserIds.add(o.beneficiaryUserId);
      } else if (o.status === "accepted" || o.status === "completed") {
        excludeUserIds.add(o.beneficiaryUserId);
      }
    }
  }

  const activeExistingCount = excludeUserIds.size;
  const needed = Math.max(0, verdictsNeeded - activeExistingCount);
  if (needed <= 0) return { offers: [] };

  const candidates = await findEligibleReviewerCandidates(db, caller.tenantId, bug, excludeUserIds);
  if (!candidates.length) return { offers: [] };

  // Pick up to `needed` reviewers, ensuring every reviewer has a distinct owner (#442 / #597)
  const selected: ReviewOfferCandidate[] = [];
  const chosenOwners = new Set(excludeUserIds);

  for (const candidate of candidates) {
    if (chosenOwners.has(candidate.beneficiaryUserId)) continue;
    selected.push(candidate);
    chosenOwners.add(candidate.beneficiaryUserId);
    if (selected.length >= needed) break;
  }

  const createdOffers = [];
  for (const reviewer of selected) {
    const offer = await db.reviewOffer.create({
      data: {
        bugId: bug.id,
        agentId: reviewer.agentId,
        beneficiaryUserId: reviewer.beneficiaryUserId,
        status: "offered",
        offeredAt: new Date(),
        pullRequestUrl: options.pullRequestUrl,
        headSha: options.headSha ?? null,
      },
    });

    const expiresAt = new Date(offer.offeredAt.getTime() + REVIEW_OFFER_TTL_MS).toISOString();

    await publish(db, {
      tenantId: bug.tenantId,
      type: "review.requested",
      actorAgentId: caller.agentId ?? null,
      bugId: bug.id,
      payload: {
        offerId: offer.id,
        issueId: bug.id,
        agentId: reviewer.agentId,
        beneficiaryUserId: reviewer.beneficiaryUserId,
        pullRequestUrl: options.pullRequestUrl,
        headSha: options.headSha ?? null,
        expiresAt,
      },
    });

    scheduleReviewOfferExpiry(offer.id);
    createdOffers.push(offer);
  }

  return { offers: createdOffers };
}

/**
 * Accepts a pending review offer (#597).
 * Sets status to "accepted" and establishes the review deadline (default 30 min).
 */
export async function acceptReviewOffer(agent: AgentContext, offerId: string) {
  return prisma.$transaction(async (tx) => {
    const offer = await tx.reviewOffer.findUnique({
      where: { id: offerId },
      include: {
        bug: { select: bugReviewSelect },
      },
    });

    if (!offer || offer.bug.tenantId !== agent.tenantId) {
      throw new IssueApiError(404, "Review offer not found.");
    }
    assertKeyProject(agent, offer.bug.projectId);

    if (offer.agentId !== agent.agentId) {
      throw new IssueApiError(409, "This review offer was made to another agent.");
    }

    const now = new Date();
    if (offer.status === "expired" || isReviewOfferExpired(offer.offeredAt, now.getTime())) {
      if (offer.status !== "expired") {
        await tx.reviewOffer.update({
          where: { id: offer.id },
          data: { status: "expired", expiredAt: now },
        });
        // Re-offer to the next eligible reviewer
        void reofferReview(offer.bugId, offer.pullRequestUrl, offer.headSha).catch(() => undefined);
      }
      throw new IssueApiError(410, "This review offer expired.");
    }

    if (offer.status !== "offered") {
      throw new IssueApiError(409, `This review offer is already ${offer.status}.`);
    }

    const conflict = reviewerConflict({ id: agent.agentId, ownerUserId: agent.ownerId }, offer.bug);
    if (conflict) throw new IssueApiError(403, "not_independent", { message: new ReviewerNotIndependentError(conflict).message });

    const deadlineAt = new Date(now.getTime() + REVIEW_DEADLINE_MS);
    const updated = await tx.reviewOffer.update({
      where: { id: offer.id },
      data: {
        status: "accepted",
        acceptedAt: now,
        deadlineAt,
      },
    });

    scheduleReviewDeadlineExpiry(updated.id);
    return { offer: updated };
  });
}

/**
 * Re-offers a review task to the next eligible independent reviewer when an offer expires (#597).
 */
export async function reofferReview(
  bugId: string,
  pullRequestUrl: string,
  headSha?: string | null,
  db: Db = prisma,
) {
  const bug = await db.bug.findFirst({
    where: { id: bugId, isDeleted: false },
    select: bugReviewSelect,
  });
  if (!bug) return null;

  // Don't re-offer if the bug is already resolved or closed
  if (bug.status === "resolved" || bug.status === "closed") return null;

  const existingOffers = await db.reviewOffer.findMany({
    where: {
      bugId,
      status: { in: ["offered", "accepted", "completed"] },
    },
    select: { beneficiaryUserId: true, status: true, offeredAt: true, deadlineAt: true },
  });

  const now = Date.now();
  const excludeUserIds = new Set<string>();

  for (const o of existingOffers) {
    if (o.status === "offered" && !isReviewOfferExpired(o.offeredAt, now)) {
      excludeUserIds.add(o.beneficiaryUserId);
    } else if (o.status === "accepted" && !isReviewDeadlineExpired(o.deadlineAt, now)) {
      excludeUserIds.add(o.beneficiaryUserId);
    } else if (o.status === "completed") {
      excludeUserIds.add(o.beneficiaryUserId);
    }
  }

  const { verdictsNeeded } = await workflowFor(bug.projectId, db);
  if (excludeUserIds.size >= verdictsNeeded) return null;

  const candidates = await findEligibleReviewerCandidates(db, bug.tenantId, bug, excludeUserIds);
  const next = candidates.find((c) => !excludeUserIds.has(c.beneficiaryUserId));
  if (!next) return null;

  const newOffer = await db.reviewOffer.create({
    data: {
      bugId: bug.id,
      agentId: next.agentId,
      beneficiaryUserId: next.beneficiaryUserId,
      status: "offered",
      offeredAt: new Date(),
      pullRequestUrl,
      headSha: headSha ?? null,
    },
  });

  const expiresAt = new Date(newOffer.offeredAt.getTime() + REVIEW_OFFER_TTL_MS).toISOString();

  await publish(db, {
    tenantId: bug.tenantId,
    type: "review.requested",
    bugId: bug.id,
    payload: {
      offerId: newOffer.id,
      issueId: bug.id,
      agentId: next.agentId,
      beneficiaryUserId: next.beneficiaryUserId,
      pullRequestUrl,
      headSha: headSha ?? null,
      expiresAt,
    },
  });

  scheduleReviewOfferExpiry(newOffer.id);
  return newOffer;
}

/**
 * Handles expiration of a pending or accepted review offer (#597).
 * Re-offers the review task to the next eligible independent reviewer.
 */
export async function expireReviewOffer(offerId: string): Promise<boolean> {
  const result = await prisma.$transaction(async (tx) => {
    const offer = await tx.reviewOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        bugId: true,
        status: true,
        offeredAt: true,
        deadlineAt: true,
        pullRequestUrl: true,
        headSha: true,
      },
    });

    if (!offer) return false;

    const now = Date.now();
    let shouldExpire = false;

    if (offer.status === "offered" && isReviewOfferExpired(offer.offeredAt, now)) {
      shouldExpire = true;
    } else if (offer.status === "accepted" && isReviewDeadlineExpired(offer.deadlineAt, now)) {
      shouldExpire = true;
    }

    if (!shouldExpire) return false;

    await tx.reviewOffer.update({
      where: { id: offer.id },
      data: { status: "expired", expiredAt: new Date() },
    });

    return {
      bugId: offer.bugId,
      pullRequestUrl: offer.pullRequestUrl,
      headSha: offer.headSha,
    };
  });

  if (result) {
    await reofferReview(result.bugId, result.pullRequestUrl, result.headSha);
    return true;
  }

  return false;
}

/**
 * Called when an agent submits a test verdict on a bug (#597).
 * - Marks the corresponding review offer as completed.
 * - Counts independent good-to-merge verdicts on the linked PR.
 * - Publishes `review.completed` when the verdict threshold is met.
 */
export async function handleTestVerdictSubmitted(
  db: Db,
  params: {
    bugId: string;
    agentId: string;
    tenantId: string;
    pullRequestUrl: string;
  },
): Promise<{ completed: boolean; count: number }> {
  // Mark any matching review offer as completed
  if (typeof (db as { reviewOffer?: unknown }).reviewOffer !== "undefined") {
    await db.reviewOffer.updateMany({
      where: {
        bugId: params.bugId,
        agentId: params.agentId,
        status: { in: ["offered", "accepted"] },
      },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });
  }

  // Load bug to evaluate independence of all good-to-merge verdicts
  const bug = await db.bug.findFirst({
    where: { id: params.bugId, tenantId: params.tenantId, isDeleted: false },
    select: bugReviewSelect,
  });
  if (!bug) return { completed: false, count: 0 };

  const verdicts = await db.testVerdict.findMany({
    where: {
      bugId: params.bugId,
      goodToMerge: true,
      pullRequestUrl: params.pullRequestUrl,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      onBehalfOfUserId: true,
      agent: { select: { id: true, ownerUserId: true } },
    },
  });

  const activeClaimAgent = bug.claims.find((c) => c.status === "active" && !c.releasedAt);
  const reviewed: ReviewedBug = bug;

  const validReviewerOwners = new Set<string>();
  const independentVerdicts = [];

  for (const v of verdicts) {
    if (activeClaimAgent && (v.agent.id === activeClaimAgent.agentId || v.agent.ownerUserId === activeClaimAgent.agent.ownerUserId)) {
      continue;
    }
    if (reviewerConflict({ id: v.agent.id, ownerUserId: v.agent.ownerUserId }, reviewed)) {
      continue;
    }
    if (validReviewerOwners.has(v.agent.ownerUserId)) continue;
    validReviewerOwners.add(v.agent.ownerUserId);
    independentVerdicts.push(v);
  }

  const count = independentVerdicts.length;
  const { verdictsNeeded } = await workflowFor(bug.projectId, db);
  if (count >= verdictsNeeded) {
    // Check if review.completed has already been emitted for this bug to prevent duplicates
    const alreadyPublished = await db.agentEvent.findFirst({
      where: {
        tenantId: params.tenantId,
        bugId: params.bugId,
        type: "review.completed",
      },
      select: { id: true },
    });

    if (!alreadyPublished) {
      await publish(db, {
        tenantId: params.tenantId,
        type: "review.completed",
        actorAgentId: params.agentId,
        bugId: params.bugId,
        payload: {
          issueId: params.bugId,
          pullRequestUrl: params.pullRequestUrl,
          verdictCount: count,
          threshold: verdictsNeeded,
        },
      });
    }

    return { completed: true, count };
  }

  return { completed: false, count };
}
