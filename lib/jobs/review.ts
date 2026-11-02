import type { JobSubmissionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { audit } from "@/lib/agents/audit";
import { publish } from "@/lib/agent-api/events";
import { award } from "@/lib/points/award";
import { jobSubmissionSourceKey } from "@/lib/points/rules";
import {
  DEFAULT_REVIEW_VERDICTS_NEEDED,
  REVIEW_DEADLINE_MS,
  REVIEW_OFFER_TTL_MS,
  isReviewDeadlineExpired,
  isReviewOfferExpired,
  rankReviewOfferCandidates,
  type ReviewOfferCandidate,
} from "@/lib/agent-api/review-offer";
import { jobReviewSchema, type JobReviewInput } from "@/lib/validations/job";

/**
 * The job review loop (#617). It mirrors the pull-request review-offer
 * mechanics (#597) — accept an offer, then leave a verdict — but is deliberately
 * separate so the bug flow stays untouched.
 *
 * A submission is accepted once `reviewsNeeded` owners (distinct from the
 * submitter's owner) accept it; any reject vetoes it immediately. The submitter's
 * owner is paid exactly once via the idempotent `sourceKey`.
 */

type Db = typeof prisma | Prisma.TransactionClient;

const OFFER_STATUSES = ["offered", "accepted", "completed"] as const;

export type JobForReview = {
  id: string;
  tenantId: string;
  projectId: string;
  pointsPerAccepted: number;
};

export type SubmissionForReview = {
  id: string;
  jobId: string;
  agentId: string;
  beneficiaryUserId: string;
  reviewsNeeded: number;
};

type Candidate = ReviewOfferCandidate & { agentId: string };

/**
 * Finds distinct people with an active agent who may review this submission.
 * Independence is on the owner (#442): a person can't review a row their own
 * agent — or another of their agents — submitted.
 */
async function findEligibleReviewers(
  db: Db,
  tenantId: string,
  submission: SubmissionForReview,
  excludeUserIds: Set<string>,
): Promise<Candidate[]> {
  const memberships = await db.membership.findMany({
    where: {
      tenantId,
      user: {
        agents: {
          some: { tenantId, revokedAt: null },
        },
      },
    },
    select: {
      userId: true,
      user: {
        select: {
          agents: {
            where: { tenantId, revokedAt: null },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });

  const people = memberships.flatMap((membership) => {
    const agent = membership.user.agents[0];
    if (!agent) return [];
    if (membership.userId === submission.beneficiaryUserId) return [];
    if (excludeUserIds.has(membership.userId)) return [];
    return [{ beneficiaryUserId: membership.userId, agentId: agent.id }];
  });
  if (!people.length) return [];

  const userIds = people.map((p) => p.beneficiaryUserId);
  const activeOffers = await db.jobReviewOffer.findMany({
    where: {
      beneficiaryUserId: { in: userIds },
      status: { in: ["offered", "accepted"] },
    },
    select: { beneficiaryUserId: true, submission: { select: { status: true } } },
  });
  const offerCounts = new Map<string, number>();
  for (const offer of activeOffers) {
    // Decided submissions cannot produce any more verdicts, so their leftover
    // offers are not active reviewer workload (#619).
    if (offer.submission.status !== "pending") continue;
    offerCounts.set(offer.beneficiaryUserId, (offerCounts.get(offer.beneficiaryUserId) ?? 0) + 1);
  }

  const candidates: Candidate[] = people.map((p) => ({
    ...p,
    activeWorkload: offerCounts.get(p.beneficiaryUserId) ?? 0,
    lastOfferedAt: null,
  }));

  return rankReviewOfferCandidates(candidates);
}

/**
 * Offers a new submission to independent reviewers and records how many accepts
 * it needs (#617). Returns the number of distinct reviewers already holding an
 * offer (the threshold), or the default of 2 when nobody is available.
 */
export async function createJobReviewOffers(
  db: Db,
  caller: { agentId?: string; tenantId: string },
  job: JobForReview,
  submission: SubmissionForReview,
): Promise<number> {
  const offered = await createJobReviewOffersForCandidates(db, caller, job, submission, new Set());
  // Keep the full quorum when nobody is eligible yet; the durable sweeper will
  // create the missing offers when reviewers become available.
  return offered || DEFAULT_REVIEW_VERDICTS_NEEDED;
}

async function createJobReviewOffersForCandidates(
  db: Db,
  caller: { agentId?: string; tenantId: string },
  job: JobForReview,
  submission: SubmissionForReview,
  excludedUserIds: Set<string>,
  limit = DEFAULT_REVIEW_VERDICTS_NEEDED,
): Promise<number> {
  const candidates = await findEligibleReviewers(db, job.tenantId, submission, excludedUserIds);

  if (!candidates.length) {
    return 0;
  }

  const selected = candidates.slice(0, limit);
  const now = new Date();

  for (const reviewer of selected) {
    const offer = await db.jobReviewOffer.create({
      data: {
        submissionId: submission.id,
        agentId: reviewer.agentId,
        beneficiaryUserId: reviewer.beneficiaryUserId,
        status: "offered",
        offeredAt: now,
      },
    });

    const expiresAt = new Date(now.getTime() + REVIEW_OFFER_TTL_MS).toISOString();
    await publish(db, {
      tenantId: job.tenantId,
      type: "job.review.requested",
      actorAgentId: caller.agentId ?? null,
      payload: {
        offerId: offer.id,
        jobId: job.id,
        submissionId: submission.id,
        agentId: reviewer.agentId,
        beneficiaryUserId: reviewer.beneficiaryUserId,
        expiresAt,
      },
    });
  }

  return selected.length;
}

/**
 * Fills any missing review-offer slots for a pending submission. A row lock
 * makes this safe when the cron sweep and a late-accept recovery run together.
 * Reviewers who already received an offer are not repeatedly re-offered the
 * same row; a newly eligible reviewer can still be picked on a later sweep.
 */
export async function ensureJobReviewOffers(submissionId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "JobSubmission" WHERE "id" = ${submissionId} FOR UPDATE
    `;
    if (!locked.length) return 0;

    const submission = await tx.jobSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        jobId: true,
        agentId: true,
        beneficiaryUserId: true,
        reviewsNeeded: true,
        status: true,
        job: { select: { id: true, tenantId: true, projectId: true, pointsPerAccepted: true } },
      },
    });
    if (!submission || submission.status !== "pending") return 0;

    const [offers, reviews] = await Promise.all([
      tx.jobReviewOffer.findMany({
        where: { submissionId },
        select: { beneficiaryUserId: true, status: true },
      }),
      tx.jobReview.findMany({
        where: { submissionId },
        select: { beneficiaryUserId: true },
      }),
    ]);

    const reviewedOwners = new Set(reviews.map((review) => review.beneficiaryUserId));
    const activeOfferOwners = new Set(
      offers
        .filter((offer) => offer.status === "offered" || offer.status === "accepted")
        .map((offer) => offer.beneficiaryUserId),
    );
    const excludedUserIds = new Set([
      ...offers.map((offer) => offer.beneficiaryUserId),
      ...reviewedOwners,
    ]);
    const remaining = Math.max(
      0,
      submission.reviewsNeeded - reviewedOwners.size - activeOfferOwners.size,
    );
    if (!remaining) return 0;

    return createJobReviewOffersForCandidates(
      tx,
      { tenantId: submission.job.tenantId },
      submission.job,
      submission,
      excludedUserIds,
      remaining,
    );
  });
}

/**
 * Expires one due job-review offer and replaces it when another reviewer is
 * available. The expiry commits before replacement creation so it survives a
 * process restart or a failed attempt to find the next reviewer.
 */
export async function expireJobReviewOffer(offerId: string): Promise<string | null> {
  const submissionId = await prisma.$transaction(async (tx) => {
    const offer = await tx.jobReviewOffer.findUnique({
      where: { id: offerId },
      select: { id: true, submissionId: true, status: true, offeredAt: true, deadlineAt: true },
    });
    if (!offer) return null;

    const now = Date.now();
    const due =
      (offer.status === "offered" && isReviewOfferExpired(offer.offeredAt, now)) ||
      (offer.status === "accepted" && isReviewDeadlineExpired(offer.deadlineAt, now));
    if (!due) return null;

    const updated = await tx.jobReviewOffer.updateMany({
      where: { id: offer.id, status: offer.status },
      data: { status: "expired", expiredAt: new Date(now) },
    });
    return updated.count ? offer.submissionId : null;
  });

  return submissionId;
}

/**
 * Durable recovery for job-review offers. It expires overdue offers, then
 * revisits every pending submission so rows created with no eligible reviewers
 * (or only a partial quorum) can be offered once reviewers become available.
 */
export async function sweepJobReviewOffers(): Promise<{ expired: number; offered: number }> {
  const dueOffers = await prisma.jobReviewOffer.findMany({
    where: {
      submission: { status: "pending" },
      OR: [
        { status: "offered", offeredAt: { lte: new Date(Date.now() - REVIEW_OFFER_TTL_MS) } },
        { status: "accepted", deadlineAt: { lte: new Date() } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  let expired = 0;
  let offered = 0;
  for (const offer of dueOffers) {
    const submissionId = await expireJobReviewOffer(offer.id);
    if (!submissionId) continue;
    expired++;
    offered += await ensureJobReviewOffers(submissionId);
  }

  const pendingSubmissions = await prisma.jobSubmission.findMany({
    where: { status: "pending" },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const submission of pendingSubmissions) {
    offered += await ensureJobReviewOffers(submission.id);
  }

  return { expired, offered };
}

/** Accepts a pending job review offer (#617), mirroring the PR flow's TTLs. */
export async function acceptJobReviewOffer(agent: AgentContext, offerId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const initialOffer = await tx.jobReviewOffer.findUnique({
      where: { id: offerId },
      select: {
        submissionId: true,
        agentId: true,
        submission: { select: { job: { select: { tenantId: true } } } },
      },
    });
    if (!initialOffer || initialOffer.submission.job.tenantId !== agent.tenantId) {
      throw new IssueApiError(404, "Review offer not found.");
    }
    if (initialOffer.agentId !== agent.agentId) {
      throw new IssueApiError(409, "This review offer was made to another agent.");
    }

    // Serialize accepting an offer with verdicts that can decide its submission.
    // Re-read the offer and submission after the lock, since the initial lookup
    // may have happened before a competing verdict committed (#619).
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "JobSubmission" WHERE "id" = ${initialOffer.submissionId} FOR UPDATE
    `;
    if (!locked.length) throw new IssueApiError(404, "Review offer not found.");

    const offer = await tx.jobReviewOffer.findUnique({
      where: { id: offerId },
      include: {
        submission: {
          select: { id: true, status: true, job: { select: { tenantId: true } } },
        },
      },
    });
    if (!offer || offer.submission.job.tenantId !== agent.tenantId) {
      throw new IssueApiError(404, "Review offer not found.");
    }
    if (offer.agentId !== agent.agentId) {
      throw new IssueApiError(409, "This review offer was made to another agent.");
    }

    if (offer.submission.status !== "pending") {
      await tx.jobReviewOffer.updateMany({
        where: { id: offer.id, status: { in: ["offered", "accepted"] } },
        data: { status: "expired", expiredAt: new Date() },
      });
      return { kind: "decided" as const, status: offer.submission.status };
    }

    const now = new Date();
    if (offer.status === "expired" || isReviewOfferExpired(offer.offeredAt, now.getTime())) {
      if (offer.status !== "expired") {
        await tx.jobReviewOffer.updateMany({
          where: { id: offer.id, status: "offered" },
          data: { status: "expired", expiredAt: now },
        });
      }
      return { kind: "expired" as const, submissionId: offer.submission.id };
    }
    if (offer.status !== "offered") {
      throw new IssueApiError(409, `This review offer is already ${offer.status}.`);
    }

    const updated = await tx.jobReviewOffer.update({
      where: { id: offer.id },
      data: {
        status: "accepted",
        acceptedAt: now,
        deadlineAt: new Date(now.getTime() + REVIEW_DEADLINE_MS),
      },
    });

    await audit(agent, "job.review.offer_accepted", offer.id, {}, { db: tx });
    return { kind: "accepted" as const, offer: updated };
  });

  if (result.kind === "expired") {
    await ensureJobReviewOffers(result.submissionId);
    throw new IssueApiError(410, "This review offer expired.");
  }
  if (result.kind === "decided") {
    throw new IssueApiError(409, `This submission is already ${result.status}.`);
  }
  return { offer: result.offer };
}

export type ReviewOutcome = {
  submission: { id: string; status: string; reviewsNeeded: number };
  review: { id: string; verdict: string };
  points_awarded: number;
};

/**
 * Records a reviewer's verdict on a submission (#617).
 *
 * The caller must hold an accepted offer for this row (accept it first), be a
 * reviewer, and not be the submitter's owner. A reject vetoes immediately; an
 * accept counts toward `reviewsNeeded` distinct owners, and reaching it accepts
 * the row and pays the submitter's owner once.
 */
export async function reviewJobSubmission(
  agent: AgentContext,
  submissionId: string,
  input: JobReviewInput,
): Promise<ReviewOutcome> {
  const parsed = jobReviewSchema.parse(input);

  const result = await prisma.$transaction(async (tx) => {
    // Serialize verdicts for this row. Under READ COMMITTED a second reviewer
    // must wait for the first transaction to commit before counting accepts;
    // otherwise both transactions can miss each other's uncommitted review and
    // leave a fully reviewed submission pending forever.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "JobSubmission" WHERE "id" = ${submissionId} FOR UPDATE
    `;
    if (!locked.length) {
      throw new IssueApiError(404, "Submission not found.");
    }

    const submission = await tx.jobSubmission.findUnique({
      where: { id: submissionId },
      include: { job: { select: { id: true, tenantId: true, projectId: true, pointsPerAccepted: true } } },
    });
    if (!submission || submission.job.tenantId !== agent.tenantId) {
      throw new IssueApiError(404, "Submission not found.");
    }
    if (submission.beneficiaryUserId === agent.ownerId) {
      throw new IssueApiError(409, "An agent cannot review a row its own owner submitted.");
    }

    const existingReview = await tx.jobReview.findFirst({
      where: { submissionId, agentId: agent.agentId },
      select: { id: true },
    });
    if (existingReview) {
      throw new IssueApiError(409, "This agent has already reviewed this submission.");
    }

    const offer = await tx.jobReviewOffer.findFirst({
      where: { submissionId, agentId: agent.agentId, status: "accepted" },
      select: { id: true, deadlineAt: true },
    });
    if (!offer) {
      throw new IssueApiError(409, "Accept this submission's review offer before leaving a verdict.");
    }
    if (isReviewDeadlineExpired(offer.deadlineAt)) {
      await tx.jobReviewOffer.updateMany({
        where: { id: offer.id, status: "accepted" },
        data: { status: "expired", expiredAt: new Date() },
      });
      return { kind: "expired" as const, submissionId };
    }

    if (submission.status !== "pending") {
      throw new IssueApiError(409, `This submission is already ${submission.status}.`);
    }

    const review = await tx.jobReview.create({
      data: {
        submissionId,
        agentId: agent.agentId,
        beneficiaryUserId: agent.ownerId,
        verdict: parsed.verdict,
        notes: parsed.notes ?? null,
      },
      select: { id: true, verdict: true },
    });

    await tx.jobReviewOffer.update({
      where: { id: offer.id },
      data: { status: "completed", completedAt: new Date() },
    });

    let status: JobSubmissionStatus = submission.status;
    let pointsAwarded = 0;

    if (parsed.verdict === "reject") {
      status = "rejected";
    } else {
      const accepts = await tx.jobReview.findMany({
        where: { submissionId, verdict: "accept" },
        select: { beneficiaryUserId: true },
      });
      const distinctOwners = new Set(accepts.map((a) => a.beneficiaryUserId));
      if (distinctOwners.size >= submission.reviewsNeeded) {
        status = "accepted";
        const written = await award(tx, {
          tenantId: submission.job.tenantId,
          userId: submission.beneficiaryUserId,
          bugId: null,
          role: "submission",
          points: submission.job.pointsPerAccepted,
          sourceKey: jobSubmissionSourceKey(submission.job.id, submission.id),
        });
        if (written) pointsAwarded = submission.job.pointsPerAccepted;
      }
    }

    const updated = await tx.jobSubmission.update({
      where: { id: submissionId },
      data: status === "pending" ? {} : { status, reviewedAt: new Date() },
    });

    await audit(agent, "job.submission.reviewed", review.id, { submissionId, status }, { db: tx });
    await publish(tx, {
      tenantId: submission.job.tenantId,
      type: "job.submission.reviewed",
      actorAgentId: agent.agentId,
      payload: {
        jobId: submission.job.id,
        submissionId,
        reviewId: review.id,
        verdict: parsed.verdict,
        status,
      },
    });

    return {
      submission: { id: updated.id, status: updated.status, reviewsNeeded: updated.reviewsNeeded },
      review,
      points_awarded: pointsAwarded,
      kind: "reviewed" as const,
    };
  });

  if (result.kind === "expired") {
    await ensureJobReviewOffers(result.submissionId);
    throw new IssueApiError(410, "The review deadline passed.");
  }
  return {
    submission: result.submission,
    review: result.review,
    points_awarded: result.points_awarded,
  };
}

export { OFFER_STATUSES };
