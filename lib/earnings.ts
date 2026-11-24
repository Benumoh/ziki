import type { PayoutRole, Prisma, PrismaClient } from "@prisma/client";
import { issueHref } from "@/lib/issue-ref";
import { ZIKS_PER_DOLLAR, ziksFor } from "@/lib/coins/math";
import { earnedByOrganisation, earnedByRole, earnedZiks, fixedCount, latestEarnings, pendingZiks, type EarningRow } from "@/lib/coins/earned";

/**
 * Earnings (#earnings, #one-payment): what a person has earned on every project they work on, in Ziks, read off the
 * Ziks ledger (lib/coins/earned.ts). Ziks are the only payment: an issue's funded Ziks pay everyone who worked on it
 * once it is live.
 *
 * "Being checked" is what a person will be paid from funded issues that are resolved but not live yet: it is not in
 * their wallet yet, so it is not in the total.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export { WITHDRAW_THRESHOLD } from "@/lib/earnings-threshold";

/** The weekly goal until a person sets their own. */
export const DEFAULT_WEEKLY_GOAL = 50;
/** The largest weekly goal a person can set. */
export const MAX_WEEKLY_GOAL = 100_000;

/** The start of this week: Monday 00:00 UTC, the same for everyone. */
export function startOfWeek(now = new Date()): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

/** Days left in this week, today included. */
export function daysLeftInWeek(now = new Date()): number {
  return 7 - ((now.getUTCDay() + 6) % 7);
}

/**
 * Where a person stands on their own weekly goal (#earnings): what is still to earn, what that needs per day for
 * the days left, and whether they are on pace (where they should be by today, if the goal were spread evenly).
 */
export function weeklyGoalState(earnedThisWeek: number, goal: number, now = new Date()) {
  const daysLeft = daysLeftInWeek(now);
  const left = Math.max(0, goal - earnedThisWeek);
  const shouldBe = (goal * (7 - daysLeft + 1)) / 7;
  return {
    left,
    perDay: left / daysLeft,
    daysLeft,
    shouldBe: Math.min(goal, shouldBe),
    reached: earnedThisWeek >= goal,
    onPace: earnedThisWeek >= shouldBe,
  };
}

/**
 * Reads the weekly goal a person typed, in Ziks (#earnings-in-ziks): a positive amount, at most one decimal, with or
 * without "Ziks" after it. Returns the dollars it is stored in, or null when it isn't one.
 */
export function parseWeeklyGoal(raw: unknown): number | null {
  const text = typeof raw === "string" ? raw.trim().replace(/\s*ziks?$/i, "").replace(/,/g, "") : "";
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text) / ZIKS_PER_DOLLAR;
  return value > 0 && value <= MAX_WEEKLY_GOAL ? value : null;
}

/** What a person has earned, in Ziks: in one workspace when `organisationId` is given, else across every one. */
export async function totalEarned(db: Db, userId: string, organisationId: string | null = null): Promise<number> {
  return earnedZiks(db, userId, { organisationId });
}

/**
 * The header's earnings and Withdraw (#earnings, Mark's call): "on every project once someone has shown they're a
 * worker, including projects they were invited to, but not to people who only post projects." Shown once someone has
 * been paid for work or has joined a project from Discover. Null hides it.
 */
export async function headerEarnings(db: Db, userId: string, organisationId: string | null = null): Promise<number | null> {
  const [paid, joined] = await Promise.all([
    db.coinEntry.findFirst({ where: { account: "wallet", userId, kind: "release", amount: { gt: 0 } }, select: { id: true } }),
    db.projectMembership.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  if (!paid && !joined) return null;
  // What you earned in the workspace you're in (Chloe's call); Withdraw still shows your total.
  return totalEarned(db, userId, organisationId);
}

/** What a person will be paid from funded issues that are resolved but not live yet, in Ziks. */
export async function beingChecked(db: Db, userId: string, organisationId: string | null = null): Promise<number> {
  return pendingZiks(db, userId, organisationId);
}

/** What a person has earned in each workspace (#862), biggest first. Withdraw and the header are for one of them. */
export type WorkspaceTotal = { organisationId: string; name: string; total: number };

export function workspaceTotals(rows: readonly { organisationId: string; name: string; total: number }[]): WorkspaceTotal[] {
  return rows
    .filter((row) => row.total !== 0)
    .map((row) => ({ organisationId: row.organisationId, name: row.name, total: row.total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export async function earningsByWorkspace(db: Db, userId: string): Promise<WorkspaceTotal[]> {
  const totals = await earnedByOrganisation(db, userId);
  if (totals.size === 0) return [];
  const organisations = await db.organisation.findMany({ where: { id: { in: [...totals.keys()] } }, select: { id: true, name: true } });
  const nameOf = new Map(organisations.map((organisation) => [organisation.id, organisation.name]));
  return workspaceTotals([...totals].map(([organisationId, total]) => ({ organisationId, name: nameOf.get(organisationId) ?? "Another workspace", total })));
}

/** Where the money came from, in the few groups a person thinks in. Order is the bar's order. */
export const SOURCE_GROUPS = [
  { key: "fixed", label: "Fixed issues", roles: ["fixer", "awarder"] },
  { key: "reviews", label: "Testing and reviews", roles: ["tester", "merge_reviewer"] },
  { key: "triage", label: "Reports and confirmations", roles: ["reporter", "confirmer"] },
  { key: "estimates", label: "Estimates", roles: ["estimator"] },
  { key: "security", label: "Security findings", roles: ["security_finder"] },
] as const satisfies readonly { key: string; label: string; roles: readonly PayoutRole[] }[];

export type EarningsSource = { key: string; label: string; amount: number };
export type EarningsTask = { id: string; title: string; reward: number; where: string; href: string };
export type EarningsActivity = { id: string; who: string; did: string; ref: string | null; amount: number; at: Date };

function activityOf(row: EarningRow): EarningsActivity {
  return {
    id: row.id,
    who: row.amount < 0 ? "Correction" : row.label,
    did: row.issueNumber === null ? "" : "on",
    ref: row.issueNumber === null ? null : `#${row.issueNumber}`,
    amount: row.amount,
    at: row.at,
  };
}

/**
 * Your earnings (#earnings, Chloe's call): everything, in every workspace and project you're in, in Ziks. The money is
 * all of yours, and the tasks are the best-paying open ones wherever you can work. Withdraw is the one that shows a
 * single workspace (app/(app)/earnings/withdraw-actions.ts).
 */
export async function earningsSummary(db: Db, userId: string) {
  const weekStart = startOfWeek();
  const [total, checking, earnedThisWeek, goalRow, byRole, solvedCount, latest, projectMemberships, memberships] = await Promise.all([
    totalEarned(db, userId),
    beingChecked(db, userId),
    earnedZiks(db, userId, { since: weekStart }),
    db.user.findUnique({ where: { id: userId }, select: { weeklyEarningsGoal: true } }),
    earnedByRole(db, userId),
    fixedCount(db, userId),
    latestEarnings(db, userId, 6),
    db.projectMembership.findMany({ where: { userId }, select: { projectId: true } }),
    db.membership.findMany({ where: { userId, organisation: { archivedAt: null } }, select: { organisationId: true } }),
  ]);

  const sources: EarningsSource[] = SOURCE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    amount: group.roles.reduce((sum, role) => sum + (byRole.get(role) ?? 0), 0),
  })).filter((source) => source.amount > 0);

  // The funded tasks that pay the most wherever you can work: every workspace you're in and every project you joined.
  // With nothing to work on there, the best-paying funded tasks in projects open to join, so there is always somewhere
  // to start. Only funded tasks pay (#one-payment).
  const projectIds = projectMemberships.map((row) => row.projectId);
  const organisationIds = memberships.map((row) => row.organisationId);
  const openTask = { status: "open" as const, substatus: "open" as const, isDeleted: false, lockedPriceZik: { not: null } };
  const taskSelect = { id: true, number: true, title: true, lockedPriceZik: true, _count: { select: { bids: true } }, project: { select: { name: true, slug: true, organisation: { select: { slug: true } } } } };
  const best = (where: Prisma.BugWhereInput) =>
    db.bug.findMany({ where: { ...openTask, ...where }, orderBy: [{ lockedPriceZik: "desc" }, { createdAt: "desc" }], take: 4, select: taskSelect });
  const yours = organisationIds.length || projectIds.length
    ? await best({
        project: { archivedAt: null },
        OR: [
          ...(organisationIds.length ? [{ organisationId: { in: organisationIds } }] : []),
          ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
        ],
      })
    : [];
  const open = yours.length ? yours : await best({ project: { visibility: "public", isOpenForContributors: true, archivedAt: null } });

  return {
    joinedProjects: projectIds.length,
    /** True when the tasks are in places you work (you can bid); false for the fallback, projects open to join. */
    tasksAreYours: yours.length > 0,
    total,
    checking,
    earnedThisWeek,
    /** The weekly goal in Ziks (it is stored in dollars). */
    weeklyGoal: ziksFor(goalRow?.weeklyEarningsGoal == null ? DEFAULT_WEEKLY_GOAL : Number(goalRow.weeklyEarningsGoal)),
    solvedCount,
    sources,
    tasks: open.map((bug): EarningsTask => ({
      id: bug.id,
      title: bug.title,
      reward: bug.lockedPriceZik ?? 0,
      where: `#${bug.number} · ${bug._count.bids === 1 ? "1 bid" : `${bug._count.bids} bids`} · ${bug.project.name}`,
      href: issueHref(bug),
    })),
    activity: latest.map(activityOf),
  };
}