import type { PrismaClient, PointRole } from "@prisma/client";
import { pointsNumber } from "./rules";

/**
 * Where a person's points came from (#points-sources), for spotting farming:
 * by kind of action, by agent, by day, the most recent entries, and signals
 * worth a second look. Read from the ledger alone. Each entry's `sourceKey`
 * says what earned it (lib/points/rules.ts builds them), e.g.
 * `comment-upvote:<commentId>:<voterId>`, `importance:<issueId>:<userId>`.
 */

/** How many entries are read at most; enough for any real account, bounded for a farmed one. */
const ENTRY_LIMIT = 5000;
const RECENT = 40;
const DAYS = 14;

/** The kind of action, from the start of the sourceKey, in plain words. */
const KIND_LABEL: Record<string, string> = {
  solver: "Solved an issue",
  reporter: "Reported an issue",
  reviewer: "Judged delivered work",
  "reviewer-confirm": "Confirmed an issue",
  "triager-clear": "Cleared as not a duplicate",
  "duplicate-marker": "Marked a duplicate",
  dispatcher: "Dispatched an issue",
  idea: "Gave an opinion on an idea",
  signup: "Signup bonus",
  "comment-upvote": "Comment upvoted by someone",
  importance: "Marked an issue important",
  "bid-vote": "Voted on a bid",
  job: "Research job accepted",
  undo: "Correction (points taken back)",
  multiplier: "Points multiplier adjustment",
};
const ROLE_LABEL: Record<PointRole, string> = {
  solver: "Solved an issue",
  reporter: "Reported an issue",
  reviewer: "Reviewed",
  triager: "Triage",
  submission: "Research job accepted",
  dispatcher: "Dispatched an issue",
  idea: "Gave an opinion on an idea",
  signup: "Signup bonus",
  comment: "Comment upvoted by someone",
  vote: "Voted",
};
/** Small, repeatable actions: the ones farming leans on. */
const SMALL_KINDS = new Set(["idea", "comment-upvote", "importance", "bid-vote", "triager-clear", "duplicate-marker", "reviewer-confirm"]);

function kindOf(sourceKey: string, role: PointRole): { kind: string; label: string } {
  const prefix = sourceKey.split(":")[0] ?? "";
  if (KIND_LABEL[prefix]) return { kind: prefix, label: KIND_LABEL[prefix] };
  if (prefix.startsWith("split-")) return { kind: "goal-split", label: "Share of a goal split" };
  return { kind: role, label: ROLE_LABEL[role] ?? role };
}

export type PointSourceRow = { kind: string; label: string; count: number; points: number };
export type PointAgentRow = { agentId: string | null; name: string; count: number; points: number; kinds: string[] };
export type PointDayRow = { day: string; count: number; points: number };
export type PointSignal = { level: "warn" | "info"; text: string };
export type PointRecentRow = {
  id: string;
  at: Date;
  label: string;
  points: number;
  corrected: boolean;
  agentName: string | null;
  issue: { number: number; projectSlug: string | null } | null;
  idea: { number: number; projectSlug: string | null } | null;
};
export type PointSources = {
  total: number;
  entries: number;
  truncated: boolean;
  bySource: PointSourceRow[];
  byAgent: PointAgentRow[];
  byDay: PointDayRow[];
  signals: PointSignal[];
  recent: PointRecentRow[];
};

export async function pointSources(db: PrismaClient, scope: { tenantId: string; userId: string }, now = new Date()): Promise<PointSources> {
  const rows = await db.pointEntry.findMany({
    where: { tenantId: scope.tenantId, userId: scope.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ENTRY_LIMIT + 1,
    select: {
      id: true, role: true, points: true, sourceKey: true, correctedAt: true, createdAt: true,
      agent: { select: { id: true, name: true } },
      bug: { select: { number: true, reporterId: true, project: { select: { slug: true } } } },
      idea: { select: { number: true, reporterId: true, project: { select: { slug: true } } } },
    },
  });
  const truncated = rows.length > ENTRY_LIMIT;
  const entries = rows.slice(0, ENTRY_LIMIT);

  const sources = new Map<string, PointSourceRow>();
  const agents = new Map<string, PointAgentRow>();
  const days = new Map<string, PointDayRow>();
  const upvoters = new Map<string, number>();
  const hours = new Map<string, number>();
  let total = 0;
  let positive = 0;
  let smallPositive = 0;
  let ownWork = 0;
  let corrections = 0;

  const firstDay = new Date(now);
  firstDay.setUTCHours(0, 0, 0, 0);
  firstDay.setUTCDate(firstDay.getUTCDate() - (DAYS - 1));
  for (let i = 0; i < DAYS; i++) {
    const day = new Date(firstDay);
    day.setUTCDate(firstDay.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    days.set(key, { day: key, count: 0, points: 0 });
  }

  for (const entry of entries) {
    const points = pointsNumber(entry.points);
    const { kind, label } = kindOf(entry.sourceKey, entry.role);
    total += points;
    if (points > 0) positive += points;
    if (kind === "undo") corrections++;

    const source = sources.get(kind) ?? { kind, label, count: 0, points: 0 };
    source.count++;
    source.points += points;
    sources.set(kind, source);

    const agentKey = entry.agent?.id ?? "self";
    const agent = agents.get(agentKey) ?? { agentId: entry.agent?.id ?? null, name: entry.agent?.name ?? "Themself (no agent)", count: 0, points: 0, kinds: [] };
    agent.count++;
    agent.points += points;
    if (!agent.kinds.includes(label)) agent.kinds.push(label);
    agents.set(agentKey, agent);

    const day = days.get(entry.createdAt.toISOString().slice(0, 10));
    if (day) {
      day.count++;
      day.points += points;
    }
    const hour = entry.createdAt.toISOString().slice(0, 13);
    hours.set(hour, (hours.get(hour) ?? 0) + 1);

    if (points > 0 && SMALL_KINDS.has(kind)) smallPositive += points;
    if (kind === "comment-upvote") {
      const voter = entry.sourceKey.split(":")[2];
      if (voter) upvoters.set(voter, (upvoters.get(voter) ?? 0) + 1);
    }
    // Voting on, confirming or opining on their own report.
    const reporterId = entry.bug?.reporterId ?? entry.idea?.reporterId ?? null;
    if (reporterId === scope.userId && (kind === "importance" || kind === "bid-vote" || kind === "reviewer-confirm" || kind === "idea")) ownWork++;
  }

  const signals: PointSignal[] = [];
  if (entries.length >= 20 && positive > 0 && smallPositive / positive >= 0.5) {
    signals.push({ level: "warn", text: `${Math.round((smallPositive / positive) * 100)}% of their points come from small, repeatable actions (votes, verdicts, upvotes, confirmations), not delivered work.` });
  }
  const totalUpvotes = [...upvoters.values()].reduce((sum, n) => sum + n, 0);
  const [topVoter, topVoterCount] = [...upvoters.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (topVoter && topVoterCount >= 5 && topVoterCount / totalUpvotes >= 0.4) {
    const voter = await db.user.findUnique({ where: { id: topVoter }, select: { name: true, email: true } });
    signals.push({ level: "warn", text: `${voter?.name ?? voter?.email ?? "One person"} gave ${topVoterCount} of their ${totalUpvotes} comment upvotes.` });
  }
  const [busiestHour, busiestCount] = [...hours.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (busiestHour && busiestCount >= 20) {
    signals.push({ level: "warn", text: `${busiestCount} awards within one hour (${busiestHour.replace("T", " ")}:00 UTC).` });
  }
  if (ownWork >= 3) {
    signals.push({ level: "warn", text: `${ownWork} awards for voting on, confirming or giving an opinion on their own reports.` });
  }
  if (corrections > 0) {
    signals.push({ level: "info", text: `${corrections} ${corrections === 1 ? "award was" : "awards were"} taken back by a correction.` });
  }
  if (truncated) {
    signals.push({ level: "info", text: `Only the latest ${ENTRY_LIMIT.toLocaleString()} ledger entries are counted here.` });
  }

  const recent: PointRecentRow[] = entries.slice(0, RECENT).map((entry) => ({
    id: entry.id,
    at: entry.createdAt,
    label: kindOf(entry.sourceKey, entry.role).label,
    points: pointsNumber(entry.points),
    corrected: Boolean(entry.correctedAt),
    agentName: entry.agent?.name ?? null,
    issue: entry.bug ? { number: entry.bug.number, projectSlug: entry.bug.project?.slug ?? null } : null,
    idea: entry.idea ? { number: entry.idea.number, projectSlug: entry.idea.project?.slug ?? null } : null,
  }));

  return {
    total,
    entries: entries.length,
    truncated,
    bySource: [...sources.values()].sort((a, b) => b.points - a.points),
    byAgent: [...agents.values()].sort((a, b) => b.points - a.points),
    byDay: [...days.values()],
    signals,
    recent,
  };
}
