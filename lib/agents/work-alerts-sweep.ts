import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeIn, activeLevels, levelIn } from "@/lib/agents/active-in";
import { STALE_AFTER_MS, agentsLastActed, agentsLastSeen } from "@/lib/agents/last-seen";
import { AGENT_IDLE_WINDOW_MS } from "@/lib/dashboard-overview";
import { liveHoldWhere } from "@/lib/issue-holders";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { workflowFor } from "@/lib/workflow";
import type { ProjectWorkflowValues } from "@/lib/workflow-config";
import { absoluteUrl } from "@/lib/site-url";
import { issuePath } from "@/lib/issue-ref";
import { ideaPath, projectRef } from "@/lib/project-paths";
import { PAYER_WHERE } from "@/lib/coins/payers";
import {
  ALERT_WINDOW_MS,
  FAIRNESS_WINDOW_MS,
  HOLD_MS,
  LAPSE_LOOKBACK_MS,
  NEW_AGENT_MS,
  PROJECT_LINES,
  PROJECT_LINE_KEYS,
  REPEAT_COOLDOWN_MS,
  alertAvailability,
  buildAlertSummary,
  decideAlertStep,
  draftShares,
  isAlertLapse,
  lapseScore,
  linesFor,
  workAlertView,
  type AlertAvailability,
  type AlertKind,
  type AlertStep,
  type AgentShare,
  type AlertSummary,
  type DraftAgent,
  type EndedAlert,
  type LineCount,
  type OpenAlert,
  type PastCounts,
  type PendingOffer,
  type ProjectCounts,
  type ProjectLineKey,
  type WorkItem,
} from "@/lib/agents/work-alerts";

/**
 * The work-alert sweep (#work-alerts), run every minute by lib/cron/runner.ts.
 * For each project in an organisation with an agent seen today, it counts
 * what is waiting on each line, keeps a snapshot to compare with in 20
 * minutes, and takes each active agent one step by the rules in
 * lib/agents/work-alerts.ts: ping, send, ask again, pass or end.
 *
 * The agents being sent an alert this minute get fair shares
 * (#work-alert-shares): the items waiting are drafted among them, each item
 * held for the agent it went to (WorkAlertItem) so others are sent different
 * ones. Alerts reach the agent as inbox items (`ping`, `alert`) and in its
 * work feed; the agent tells its person in the coding terminal.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Snapshots older than this are deleted. */
const SNAPSHOT_KEEP_MS = 60 * 60_000;
/** A snapshot this much older than the window is too old to compare with. */
const SNAPSHOT_SLACK_MS = 10 * 60_000;
/** The most items read per line for the draft, oldest first. No share is bigger than a line's cap, so this is plenty. */
const ITEMS_PER_LINE = 100;
/** An item never needs more agents at once than this, even when it is far from its threshold. */
const MAX_SLOTS = 3;
/** Claim releases that count as lapses (lib: IssueClaim.releaseReason). */
const LAPSE_RELEASES = ["expired", "offer_expired", "silence", "deadline"];
/** How many estimates give an issue a price (lib/coins/budget.ts MIN_ESTIMATES_TO_AWARD). */
const MIN_ESTIMATES_TO_AWARD = 3;
/**
 * Issues still waiting for estimates (#ziki-estimate): unfinished, price not locked, fewer than three estimates and no
 * estimate from Ziki yet.
 */
const NEEDS_ESTIMATES = {
  status: { notIn: ["closed", "resolved"] },
  rewardFixedAt: null,
  rewardEstimateCount: { lt: MIN_ESTIMATES_TO_AWARD },
  zikiEstimateZik: null,
  // A Solo project (#solo) has no prices, so nothing in it waits for estimates.
  project: { solo: false },
} satisfies Prisma.BugWhereInput;

export type WorkAlertSweepResult = { projects: number; pinged: number; sent: number; askedAgain: number; passed: number; ended: number };

/** How many are waiting on each line in a project, and how many of them are stuck. */
export async function projectCounts(db: Db, projectId: string, offerWindowSeconds: number, now: Date): Promise<ProjectCounts> {
  const cutoff = (key: ProjectLineKey) => new Date(now.getTime() - PROJECT_LINES[key].stuckAfterMs);
  const issue = { projectId, isDeleted: false, ...PRODUCT_TRACK } satisfies Prisma.BugWhereInput;
  const unheld = { claims: { none: liveHoldWhere(offerWindowSeconds, now.getTime()) } } satisfies Prisma.BugWhereInput;
  const bySubstatus = async (key: ProjectLineKey, where: Prisma.BugWhereInput): Promise<LineCount> => {
    const [waiting, stuck] = await Promise.all([
      db.bug.count({ where: { ...issue, ...where } }),
      db.bug.count({ where: { ...issue, ...where, updatedAt: { lt: cutoff(key) } } }),
    ]);
    return { waiting, stuck };
  };

  const ideaWhere = { projectId, status: "open", ...PRODUCT_TRACK } satisfies Prisma.IdeaWhereInput;
  const ideaCutoff = cutoff("ideas_waiting");
  const [ideasWaiting, ideasStuck] = await Promise.all([
    db.idea.count({ where: ideaWhere }),
    db.idea.count({ where: { ...ideaWhere, createdAt: { lt: ideaCutoff }, verdicts: { none: { updatedAt: { gte: ideaCutoff } } } } }),
  ]);
  const awardWhere = { status: "open", ...unheld, bids: { some: OPEN_BID_WHERE } } satisfies Prisma.BugWhereInput;
  const [awardWaiting, awardStuck] = await Promise.all([
    db.bug.count({ where: { ...issue, ...awardWhere } }),
    db.bug.count({ where: { ...issue, ...awardWhere, bids: { some: { ...OPEN_BID_WHERE, updatedAt: { lt: cutoff("bids_to_award") } } } } }),
  ]);

  return {
    ideas_waiting: { waiting: ideasWaiting, stuck: ideasStuck },
    issues_need_confirmation: await bySubstatus("issues_need_confirmation", { substatus: "requires_confirmation" }),
    issues_need_estimates: await bySubstatus("issues_need_estimates", NEEDS_ESTIMATES),
    open_no_bids: await bySubstatus("open_no_bids", { substatus: "open", ...unheld, bids: { none: OPEN_BID_WHERE } }),
    bids_to_award: { waiting: awardWaiting, stuck: awardStuck },
    deliveries_need_judgement: await bySubstatus("deliveries_need_judgement", { substatus: "requires_review" }),
    accepted_need_merge_review: await bySubstatus("accepted_need_merge_review", { substatus: "accepted" }),
    pull_requests_to_merge: await bySubstatus("pull_requests_to_merge", { substatus: { in: ["ready_to_merge", "error"] } }),
  };
}

const clampSlots = (needed: number) => Math.min(MAX_SLOTS, Math.max(1, needed));

/**
 * The items waiting on each line, oldest first, with how many agents each may
 * still go to (before holds) and who may not take it: an idea's owners and
 * the agents that already gave it a verdict; an issue's existing confirmers
 * and judges; the agents that worked on a delivery, who can't judge or review
 * their own work.
 */
async function projectItems(
  db: Db,
  project: { id: string; ref: ReturnType<typeof projectRef> },
  workflow: ProjectWorkflowValues,
  agentsOf: (userIds: (string | null)[]) => string[],
  ownerOf: (agentId: string | null) => string | null,
  now: Date,
): Promise<WorkItem[]> {
  const issue = { projectId: project.id, isDeleted: false, ...PRODUCT_TRACK } satisfies Prisma.BugWhereInput;
  const unheld = { claims: { none: liveHoldWhere(workflow.offerWindowSeconds, now.getTime()) } } satisfies Prisma.BugWhereInput;
  const base = { id: true, number: true, title: true, areaId: true, createdAt: true } as const;
  const workers = { claims: { where: { claimedAt: { not: null } }, select: { agentId: true } } } as const;
  const read = { orderBy: [{ createdAt: "asc" as const }, { number: "asc" as const }], take: ITEMS_PER_LINE };
  const issueUrl = (number: number) => absoluteUrl(issuePath(project.ref, number));

  const [ideas, confirmations, unpriced, payers, noBids, toAward, deliveries, accepted, merges] = await Promise.all([
    db.idea.findMany({
      where: { projectId: project.id, status: "open", ...PRODUCT_TRACK },
      ...read,
      select: { ...base, score: true, reporterId: true, beneficiaryUserId: true, createdByAgentId: true, verdicts: { select: { agentId: true } } },
    }),
    db.bug.findMany({ where: { ...issue, substatus: "requires_confirmation" }, ...read, select: { ...base, confirmations: { select: { agentId: true, verdict: true } } } }),
    db.bug.findMany({ where: { ...issue, ...NEEDS_ESTIMATES }, ...read, select: { ...base, rewardEstimateCount: true, rewardEstimates: { select: { onBehalfOfUserId: true } } } }),
    // The organisation's payers (#payers) pay for its issues, so their agents don't estimate them (#price-lock).
    db.membership.findMany({ where: { organisation: { projects: { some: { id: project.id } } }, ...PAYER_WHERE }, select: { userId: true } }),
    db.bug.findMany({ where: { ...issue, substatus: "open", ...unheld, bids: { none: OPEN_BID_WHERE } }, ...read, select: base }),
    db.bug.findMany({ where: { ...issue, status: "open", ...unheld, bids: { some: OPEN_BID_WHERE } }, ...read, select: base }),
    db.bug.findMany({ where: { ...issue, substatus: "requires_review" }, ...read, select: { ...base, ...workers, testVerdicts: { select: { agentId: true } } } }),
    db.bug.findMany({ where: { ...issue, substatus: "accepted" }, ...read, select: { ...base, ...workers } }),
    db.bug.findMany({ where: { ...issue, substatus: { in: ["ready_to_merge", "error"] } }, ...read, select: base }),
  ]);

  const item = (line: ProjectLineKey, row: { id: string; number: number; title: string; areaId: string | null; createdAt: Date }, slots: number, notFor: (string | null)[] = []): WorkItem => ({
    line,
    type: "issue",
    id: row.id,
    number: row.number,
    title: row.title,
    url: issueUrl(row.number),
    areaId: row.areaId,
    waitingSince: row.createdAt,
    slots,
    notFor: new Set(notFor.filter((id): id is string => Boolean(id))),
  });

  return [
    ...ideas.map((row) => ({
      ...item("ideas_waiting", row, clampSlots(workflow.ideaThreshold - row.score), [
        ...row.verdicts.map((verdict) => verdict.agentId),
        row.createdByAgentId,
        ...agentsOf([row.reporterId, row.beneficiaryUserId, ownerOf(row.createdByAgentId)]),
      ]),
      type: "idea" as const,
      url: absoluteUrl(ideaPath(project.ref, row.number)),
    })),
    ...confirmations.map((row) =>
      item(
        "issues_need_confirmation",
        row,
        clampSlots(workflow.confirmationsNeeded - row.confirmations.filter((entry) => entry.verdict === "confirm").length),
        row.confirmations.map((entry) => entry.agentId),
      ),
    ),
    ...unpriced.map((row) =>
      item(
        "issues_need_estimates",
        row,
        clampSlots(MIN_ESTIMATES_TO_AWARD - row.rewardEstimateCount),
        agentsOf([...row.rewardEstimates.map((estimate) => estimate.onBehalfOfUserId), ...payers.map((payer) => payer.userId)]),
      ),
    ),
    ...noBids.map((row) => item("open_no_bids", row, 1)),
    ...toAward.map((row) => item("bids_to_award", row, 1)),
    ...deliveries.map((row) =>
      item("deliveries_need_judgement", row, clampSlots(workflow.verdictsNeeded - row.testVerdicts.length), [
        ...row.testVerdicts.map((verdict) => verdict.agentId),
        ...row.claims.map((claim) => claim.agentId),
      ]),
    ),
    ...accepted.map((row) => item("accepted_need_merge_review", row, 1, row.claims.map((claim) => claim.agentId))),
    ...merges.map((row) => item("pull_requests_to_merge", row, 1)),
  ];
}

/** The snapshot taken about ALERT_WINDOW_MS ago, as waiting counts; null when there is none that old yet. */
async function pastCounts(db: Db, projectId: string, now: Date): Promise<PastCounts | null> {
  const row = await db.workSnapshot.findFirst({
    where: {
      projectId,
      takenAt: { lte: new Date(now.getTime() - ALERT_WINDOW_MS), gte: new Date(now.getTime() - ALERT_WINDOW_MS - SNAPSHOT_SLACK_MS) },
    },
    orderBy: { takenAt: "desc" },
    select: { counts: true },
  });
  return (row?.counts as PastCounts | undefined) ?? null;
}

async function writeInboxItem(db: Db, agentId: string, kind: "ping" | "alert", payload: Prisma.InputJsonObject) {
  await db.agentInboxItem.create({ data: { agentId, kind, eventType: kind === "ping" ? "work_alert.ping" : "work_alert.sent", payload } });
}

/** Ends every hold on an alert's items now: they go back to the pool. */
async function releaseHolds(db: Db, alertId: string, now: Date) {
  await db.workAlertItem.updateMany({ where: { alertId, heldUntil: { gt: now } }, data: { heldUntil: now } });
}

type Plan = {
  agent: { id: string; ownerUserId: string; pausedAt: Date | null; level: ReturnType<typeof levelIn>; areaIds: Set<string> };
  availability: AlertAvailability;
  kind: AlertKind;
  offers: PendingOffer[];
  row: { id: string } | null;
  isNew: boolean;
  step: AlertStep;
  lapse: boolean;
  pre: AlertSummary | null;
};

/** One project, under a lock so two app instances never alert the same project at once. */
async function sweepProject(
  project: { id: string; name: string; slug: string; organisationId: string; organisation: { slug: string } },
  now: Date,
  result: WorkAlertSweepResult,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`work-alerts:${project.id}`})) AS "locked"`;
      if (!lock?.locked) return;
      result.projects += 1;
      const t = now.getTime();
      const organisationId = project.organisationId;

      const workflow = await workflowFor(project.id, tx);
      const counts = await projectCounts(tx, project.id, workflow.offerWindowSeconds, now);
      const past = await pastCounts(tx, project.id, now);
      const waiting = Object.fromEntries(PROJECT_LINE_KEYS.map((key) => [key, counts[key].waiting])) as Prisma.InputJsonObject;
      await tx.workSnapshot.create({ data: { projectId: project.id, counts: waiting, takenAt: now } });
      await tx.workSnapshot.deleteMany({ where: { projectId: project.id, takenAt: { lt: new Date(t - SNAPSHOT_KEEP_MS) } } });

      const agents = await tx.agent.findMany({
        where: { revokedAt: null, ...activeIn(organisationId) },
        select: {
          id: true,
          ownerUserId: true,
          pausedAt: true,
          activations: activeLevels,
          areaPreferences: { select: { projectAreaId: true } },
        },
      });
      const ids = agents.map((agent) => agent.id);
      const [seen, acted, holding, offered, openRows, endedRows, firstOn, hadAlert, given, alertLapses, claimLapses, holds] = await Promise.all([
        agentsLastSeen(ids, tx),
        // A day back: the last 5 minutes say who is busy, and since a yes says whether it did anything.
        agentsLastActed(ids, { projectId: project.id }, new Date(t - FAIRNESS_WINDOW_MS), tx),
        // Work in hand anywhere in the organisation: plan review, or a claim on work still In progress.
        tx.issueClaim.findMany({
          where: {
            agentId: { in: ids },
            releasedAt: null,
            bug: { organisationId },
            OR: [{ status: "planning" }, { status: "active", bug: { status: "in_progress" } }],
          },
          select: { agentId: true },
        }),
        tx.issueClaim.findMany({
          where: { agentId: { in: ids }, releasedAt: null, status: "offered", bug: { projectId: project.id, isDeleted: false } },
          select: { id: true, agentId: true, offeredAt: true, bug: { select: { number: true, title: true, lockedPriceZik: true } } },
        }),
        tx.workAlert.findMany({ where: { projectId: project.id, endedAt: null } }),
        tx.workAlert.findMany({
          where: { projectId: project.id, endedAt: { gte: new Date(t - REPEAT_COOLDOWN_MS) } },
          orderBy: { endedAt: "desc" },
          select: { agentId: true, endedAt: true, summary: true },
        }),
        // When each agent was first switched on here: new agents get a welcome alert and a full share.
        tx.agentActivation.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, organisationId }, _min: { activatedAt: true } }),
        tx.workAlert.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, organisationId } }),
        // Fairness over time: items each agent was given in the last 24 hours.
        tx.workAlertItem.groupBy({ by: ["agentId"], where: { organisationId, agentId: { in: ids }, createdAt: { gte: new Date(t - FAIRNESS_WINDOW_MS) } }, _count: { _all: true } }),
        tx.workAlert.findMany({ where: { organisationId, agentId: { in: ids }, lapsedAt: { gte: new Date(t - LAPSE_LOOKBACK_MS) } }, select: { agentId: true, lapsedAt: true } }),
        tx.issueClaim.findMany({
          where: { agentId: { in: ids }, bug: { organisationId }, releaseReason: { in: LAPSE_RELEASES }, releasedAt: { gte: new Date(t - LAPSE_LOOKBACK_MS) } },
          select: { agentId: true, releasedAt: true },
        }),
        tx.workAlertItem.findMany({ where: { projectId: project.id, heldUntil: { gt: now }, alert: { endedAt: null } }, select: { alertId: true, agentId: true, itemType: true, itemId: true } }),
      ]);
      const busy = new Set(holding.map((claim) => claim.agentId));
      const windowMs = workflow.offerWindowSeconds * 1000;
      const activatedAt = new Map(firstOn.map((row) => [row.agentId, row._min.activatedAt]));
      const alerted = new Set(hadAlert.map((row) => row.agentId));
      const received = new Map(given.map((row) => [row.agentId, row._count._all]));
      const lapsesOf = new Map<string, Date[]>();
      for (const lapse of [...alertLapses.map((row) => ({ agentId: row.agentId, at: row.lapsedAt })), ...claimLapses.map((row) => ({ agentId: row.agentId, at: row.releasedAt }))]) {
        if (!lapse.at) continue;
        lapsesOf.set(lapse.agentId, [...(lapsesOf.get(lapse.agentId) ?? []), lapse.at]);
      }

      // Phase 1: each agent's step, from the counts alone.
      const plans: Plan[] = [];
      for (const raw of agents) {
        const agent = {
          id: raw.id,
          ownerUserId: raw.ownerUserId,
          pausedAt: raw.pausedAt,
          level: levelIn(raw, organisationId),
          areaIds: new Set(raw.areaPreferences.map((row) => row.projectAreaId)),
        };
        const lastSeenAt = seen.get(agent.id) ?? null;
        const lastActedAt = acted.get(agent.id) ?? null;
        const availability = alertAvailability({
          paused: agent.pausedAt !== null,
          holdsWork: busy.has(agent.id),
          lastActedAt,
          lastSeenAt,
          onlineWindowMs: STALE_AFTER_MS,
          awayWindowMs: AGENT_IDLE_WINDOW_MS,
          now,
        });
        const offers: PendingOffer[] = offered.flatMap((claim) => {
          if (claim.agentId !== agent.id || !claim.offeredAt) return [];
          const expiresAt = new Date(claim.offeredAt.getTime() + windowMs);
          if (expiresAt.getTime() <= t) return [];
          return [{ claimId: claim.id, issueNumber: claim.bug.number, title: claim.bug.title, expiresAt, reward: claim.bug.lockedPriceZik ?? 0 }];
        });
        const row = openRows.find((alert) => alert.agentId === agent.id) ?? null;
        const open: OpenAlert | null = row
          ? {
              kind: row.kind === "welcome" ? "welcome" : "rise",
              status: row.status as OpenAlert["status"],
              pingedAt: row.pingedAt,
              asks: row.asks,
              lastAskedAt: row.lastAskedAt,
              answer: row.answer as OpenAlert["answer"],
              answeredAt: row.answeredAt,
            }
          : null;
        const first = activatedAt.get(agent.id);
        const isNew = Boolean(first && t - first.getTime() <= NEW_AGENT_MS);
        const welcomeDue = !row && !alerted.has(agent.id) && isNew;
        const kind: AlertKind = open?.kind ?? (welcomeDue ? "welcome" : "rise");
        const pre = buildAlertSummary({ projectName: project.name, level: agent.level, counts, past, offers, now, kind });
        const ended = endedRows.find((alert) => alert.agentId === agent.id);
        const lastEnded: EndedAlert | null = ended?.endedAt ? { endedAt: ended.endedAt, summary: ended.summary as Pick<AlertSummary, "lines"> | null } : null;
        const step = decideAlertStep({ availability, summary: pre, open, lastEnded, lastSeenAt, now, welcomeDue });
        plans.push({ agent, availability, kind, offers, row, isNew, step, lapse: isAlertLapse({ open, step, lastActedAt, now }), pre });
      }

      // Phase 2: the fair draft among the agents being sent an alert now.
      const drafting = plans.filter((plan) => plan.step === "send" || plan.step === "ask_again");
      const shares = new Map<string, AgentShare>();
      if (drafting.length) {
        const draftingIds = new Set(drafting.map((plan) => plan.agent.id));
        const owners = new Map<string, string[]>();
        for (const agent of agents) owners.set(agent.ownerUserId, [...(owners.get(agent.ownerUserId) ?? []), agent.id]);
        const items = await projectItems(
          tx,
          { id: project.id, ref: projectRef(project.organisation.slug, project.slug) },
          workflow,
          (userIds) => userIds.flatMap((userId) => (userId ? (owners.get(userId) ?? []) : [])),
          (agentId) => agents.find((agent) => agent.id === agentId)?.ownerUserId ?? null,
          now,
        );
        // Live holds of other agents take a slot each, unless that agent already gave the item its entry.
        // The agents drafted now give up their old holds, so theirs don't count.
        for (const item of items) {
          const held = holds.filter(
            (hold) => hold.itemId === item.id && hold.itemType === item.type && !draftingIds.has(hold.agentId) && !item.notFor.has(hold.agentId),
          );
          item.slots -= held.length;
          for (const hold of held) item.notFor.add(hold.agentId);
        }
        // The pool a line is split among: every agent free to do it now, or holding a share of it.
        const holders = new Set(holds.map((hold) => hold.agentId));
        const pool: Partial<Record<ProjectLineKey, number>> = {};
        for (const plan of plans) {
          const inPool = plan.availability === "free" || plan.availability === "away" || holders.has(plan.agent.id) || draftingIds.has(plan.agent.id);
          if (!inPool) continue;
          for (const line of linesFor(plan.agent.level)) pool[line] = (pool[line] ?? 0) + 1;
        }
        const draftAgents: DraftAgent[] = drafting.map((plan) => ({
          id: plan.agent.id,
          level: plan.agent.level,
          areaIds: plan.agent.areaIds,
          received: received.get(plan.agent.id) ?? 0,
          lapseScore: lapseScore(lapsesOf.get(plan.agent.id) ?? [], now),
          isNew: plan.isNew,
        }));
        for (const [agentId, share] of draftShares({ agents: draftAgents, items: items.filter((entry) => entry.slots > 0), pool })) shares.set(agentId, share);
      }

      // Phase 3: apply each step.
      for (const plan of plans) {
        const { agent, row } = plan;
        let step = plan.step;
        let summary = plan.pre;
        const share = shares.get(agent.id) ?? null;
        if (step === "send" || step === "ask_again") {
          summary = buildAlertSummary({ projectName: project.name, level: agent.level, counts, past, offers: plan.offers, now, kind: plan.kind, share });
          // Nothing left for this agent: others hold it all, or its lapses leave it no share for now.
          if (!summary) step = row ? "end" : "none";
        }
        const lapse = plan.lapse ? { lapsedAt: now } : {};
        if (step === "none") continue;

        if (step === "end" && row) {
          await tx.workAlert.update({ where: { id: row.id }, data: { status: "ended", endedAt: now, ...lapse } });
          await releaseHolds(tx, row.id, now);
          result.ended += 1;
        } else if (step === "pass" && row) {
          await tx.workAlert.update({ where: { id: row.id }, data: { status: "passed", ...lapse } });
          await releaseHolds(tx, row.id, now);
          result.passed += 1;
        } else if (step === "ping" && summary) {
          const alert = await tx.workAlert.create({
            data: { organisationId, projectId: project.id, agentId: agent.id, kind: plan.kind, status: "pinged", summary: summary as unknown as Prisma.InputJsonObject, pingedAt: now },
          });
          await writeInboxItem(tx, agent.id, "ping", {
            alertId: alert.id,
            project: { id: project.id, name: project.name },
            message: `Ziki has work waiting for you in ${project.name}. Check in (any call, such as your work feed) within 90 seconds to get it.`,
          });
          result.pinged += 1;
        } else if ((step === "send" || step === "ask_again") && summary) {
          const heldUntil = new Date(t + HOLD_MS);
          const data = { status: "sent", kind: plan.kind, summary: summary as unknown as Prisma.InputJsonObject, lastAskedAt: now, answer: null, answeredAt: null, ...lapse };
          const alert = row
            ? await tx.workAlert.update({ where: { id: row.id }, data: step === "send" ? { ...data, sentAt: now, asks: 1 } : { ...data, asks: { increment: 1 } } })
            : await tx.workAlert.create({ data: { ...data, organisationId, projectId: project.id, agentId: agent.id, sentAt: now, asks: 1 } });
          if (row) await releaseHolds(tx, row.id, now);
          if (share?.items.length) {
            await tx.workAlertItem.createMany({
              data: share.items.map((item) => ({
                alertId: alert.id,
                organisationId,
                projectId: project.id,
                agentId: agent.id,
                line: item.line,
                itemType: item.type,
                itemId: item.id,
                number: item.number,
                heldUntil,
              })),
            });
          }
          await writeInboxItem(tx, agent.id, "alert", workAlertView(alert, { id: project.id, name: project.name }, heldUntil) as unknown as Prisma.InputJsonObject);
          if (step === "send") result.sent += 1;
          else result.askedAgain += 1;
        }
      }

      await tx.workAlertItem.deleteMany({ where: { projectId: project.id, createdAt: { lt: new Date(t - LAPSE_LOOKBACK_MS) } } });
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

export async function sweepWorkAlerts(now: Date = new Date()): Promise<WorkAlertSweepResult> {
  const result: WorkAlertSweepResult = { projects: 0, pinged: 0, sent: 0, askedAgain: 0, passed: 0, ended: 0 };
  // Organisations with an agent seen today, and projects with an alert still open (so it can end).
  const [activations, openAlerts] = await Promise.all([
    prisma.agentActivation.findMany({
      where: {
        deactivatedAt: null,
        agent: { revokedAt: null, apiKeys: { some: { revokedAt: null, lastUsedAt: { gt: new Date(now.getTime() - AGENT_IDLE_WINDOW_MS) } } } },
      },
      distinct: ["organisationId"],
      select: { organisationId: true },
    }),
    prisma.workAlert.findMany({ where: { endedAt: null }, distinct: ["projectId"], select: { projectId: true } }),
  ]);
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { organisationId: { in: activations.map((row) => row.organisationId) }, archivedAt: null },
        { id: { in: openAlerts.map((row) => row.projectId) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true, organisationId: true, organisation: { select: { slug: true } } },
  });
  for (const project of projects) await sweepProject(project, now, result);
  return result;
}
