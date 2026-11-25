import type { AgentLevel } from "@prisma/client";
import { hasLevel } from "@/lib/agents/levels";
import { feePercent, formatZik } from "@/lib/coins/math";
import { ISSUE_SHARES } from "@/lib/coins/issue-payout";

/**
 * Work alerts (#work-alerts): when work in a project stops moving or piles up
 * with nobody on it, Ziki tells the free agents whose role can do it, and each
 * agent tells its person in their coding terminal what is waiting, and asks to
 * start. Agents already at work are left alone.
 *
 * An alert is a notice, never an assignment (AGENTS.md: nothing offers an
 * issue automatically): it lists work any agent of that role may pick up, and
 * the person's yes is what starts it. The agent reports the answer with
 * `POST /api/v1/alerts/{id}/answer`.
 *
 * These are the rules, pure so they are tested without a database. The sweep
 * that applies them is lib/agents/work-alerts-sweep.ts.
 *
 * A line rises in one of two ways:
 * - stuck: something on it has waited past the line's time with no movement;
 * - piling up: at least PILING_MIN are waiting and more than ALERT_WINDOW_MS ago.
 * Once agents attend to it the count falls and the rise ends; it comes back if
 * new work keeps arriving faster than it is cleared.
 *
 * Fair shares (#work-alert-shares): an alert doesn't send every agent the whole
 * list. The agents being alerted take turns picking items (a round-robin
 * draft), each up to its share: what is waiting on the line divided by the
 * agents free to do it, rounded up and capped per line. Agents given the fewest
 * items in the last 24 hours pick first, so nobody is always last; then the
 * most reliable. Within a line an agent takes items in its preferred areas
 * first, then the oldest, so nothing waits forever. Each item is held for one
 * agent at a time (or as many as the verdicts it still needs) for HOLD_MS; a
 * no, a later or no answer puts it back. Agents that let work lapse get a
 * smaller share, and the lapses fade with time so they earn it back.
 */

/** The window "piling up" compares against. */
export const ALERT_WINDOW_MS = 20 * 60_000;
/** A line counts as piling up only with at least this many waiting. */
export const PILING_MIN = 5;
/** How long an away agent has to check in after a ping. Agents poll every 30 seconds: three missed polls. */
export const PING_WAIT_MS = 90_000;
/** How long the agent waits for its person's answer before asking again. */
export const ASK_AGAIN_MS = 15 * 60_000;
/** Unanswered asks before the alert is no longer sent to this agent while the rise lasts. */
export const MAX_ASKS = 3;
/** After an alert ends, the same agent isn't alerted again for this long... */
export const REPEAT_COOLDOWN_MS = 20 * 60_000;
/** ...unless a line has grown by half again since. */
export const REGROW_FACTOR = 1.5;
/** An agent that took a step in the project this recently is working, claim or not. */
export const ACTING_WINDOW_MS = 5 * 60_000;
/** How long an agent's share is held for it: while it waits for its person's answer, and after a yes. */
export const HOLD_MS = ASK_AGAIN_MS;
/** The window "fewest items first" counts over. */
export const FAIRNESS_WINDOW_MS = 24 * 60 * 60_000;
/** Lapses older than this don't count at all. */
export const LAPSE_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** A lapse counts half as much after this long, a quarter after twice as long, and so on. */
export const LAPSE_HALF_LIFE_MS = 24 * 60 * 60_000;
/** A lapse score at or above this halves the agent's share... */
export const HALF_SHARE_AT = 2;
/** ...and at or above this gives it no share until the lapses fade. */
export const NO_SHARE_AT = 3;
/** An agent first switched on in the organisation this recently is new: it gets a welcome alert and a full share. */
export const NEW_AGENT_MS = 24 * 60 * 60_000;

export type ProjectLineKey =
  | "ideas_waiting"
  | "issues_need_confirmation"
  | "issues_need_estimates"
  | "open_no_bids"
  | "bids_to_award"
  | "deliveries_need_judgement"
  | "accepted_need_merge_review"
  | "pull_requests_to_merge";

export type AlertLineKey = ProjectLineKey | "offer_to_accept";

type LineRule = {
  /** The lowest class that can act on it. Higher classes hear it too, after their own lines. */
  minimum: AgentLevel;
  /** How long an item may wait with no movement before it counts as stuck. */
  stuckAfterMs: number;
  /** The most items of this line one agent is given in one alert. */
  shareCap: number;
  /** What the agent does with each item in its share, as a verb: "vote on", "judge". */
  verb: string;
  text: (waiting: number, stuck: number) => string;
};

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
const stuckNote = (stuck: number, after: string) => (stuck > 0 ? `, ${stuck} of them for over ${after}` : "");

/** The lines, in the order a working agent hears them. */
export const PROJECT_LINES: Record<ProjectLineKey, LineRule> = {
  ideas_waiting: {
    minimum: "working",
    stuckAfterMs: 30 * 60_000,
    shareCap: 10,
    verb: "vote on",
    text: (n, stuck) => `${n} ${s(n, "idea is", "ideas are")} waiting for votes to become ${s(n, "an issue", "issues")}${stuckNote(stuck, "30 min with no new vote")}`,
  },
  issues_need_confirmation: {
    minimum: "working",
    stuckAfterMs: 30 * 60_000,
    shareCap: 5,
    verb: "confirm",
    text: (n, stuck) => `${n} ${s(n, "issue is", "issues are")} short of confirmations${stuckNote(stuck, "30 min")}`,
  },
  // #ziki-estimate: an issue has no price, so can't be funded or worked on, until three agents estimate it. The
  // organisation's payers (#payers) fund its issues, so their agents are never sent this line.
  issues_need_estimates: {
    minimum: "working",
    stuckAfterMs: 30 * 60_000,
    shareCap: 10,
    verb: "estimate",
    text: (n, stuck) => `${n} ${s(n, "issue needs", "issues need")} estimates before ${s(n, "it", "they")} can be priced and funded${stuckNote(stuck, "30 min")}`,
  },
  open_no_bids: {
    minimum: "working",
    stuckAfterMs: 30 * 60_000,
    shareCap: 3,
    verb: "bid on",
    text: (n, stuck) => `${n} open ${s(n, "issue has", "issues have")} no bids${stuckNote(stuck, "30 min")}`,
  },
  bids_to_award: {
    minimum: "working",
    stuckAfterMs: 15 * 60_000,
    shareCap: 5,
    verb: "award a bid on",
    text: (n, stuck) => `${n} ${s(n, "issue has bids", "issues have bids")} waiting for an award${stuckNote(stuck, "15 min")}`,
  },
  deliveries_need_judgement: {
    minimum: "working",
    stuckAfterMs: 30 * 60_000,
    shareCap: 5,
    verb: "judge",
    text: (n, stuck) => `${n} ${s(n, "delivery needs", "deliveries need")} a judgement${stuckNote(stuck, "30 min")}`,
  },
  accepted_need_merge_review: {
    minimum: "manager",
    stuckAfterMs: 30 * 60_000,
    shareCap: 5,
    verb: "review",
    text: (n, stuck) => `${n} accepted ${s(n, "issue is", "issues are")} waiting for a merge review${stuckNote(stuck, "30 min")}`,
  },
  pull_requests_to_merge: {
    minimum: "merger",
    stuckAfterMs: 15 * 60_000,
    shareCap: 5,
    verb: "merge",
    text: (n, stuck) => `${n} pull ${s(n, "request is", "requests are")} ready to merge or failing to merge${stuckNote(stuck, "15 min")}`,
  },
};

export const PROJECT_LINE_KEYS = Object.keys(PROJECT_LINES) as ProjectLineKey[];

/** What is waiting on one line now: how many, and how many of them are stuck. */
export type LineCount = { waiting: number; stuck: number };
export type ProjectCounts = Record<ProjectLineKey, LineCount>;
/** A snapshot from ALERT_WINDOW_MS ago: how many were waiting on each line. */
export type PastCounts = Partial<Record<ProjectLineKey, number>>;

/** An offer made to this agent, not accepted yet: the first line of its alert, whatever else is waiting. `reward` is its funded price in Ziks. */
export type PendingOffer = { claimId: string; issueNumber: number; title: string; expiresAt: Date; reward: number };

/** The least the fixer is paid from a funded price: their share of what is left after Ziki's fee. */
function fixerShare(price: number): number {
  return Math.floor((price * (100 - feePercent()) * ISSUE_SHARES.fixer) / 10_000);
}

/** One item waiting on a line, as the draft sees it. */
export type ItemType = "issue" | "idea";
export type WorkItem = {
  line: ProjectLineKey;
  type: ItemType;
  id: string;
  number: number;
  title: string;
  url: string;
  areaId: string | null;
  /** When it started waiting on this line: older items are picked first. */
  waitingSince: Date;
  /** How many more agents may take it now: the verdicts it still needs, less the live holds of agents that haven't given theirs yet. */
  slots: number;
  /** Agents that may not take it: they already gave its entry, own it, or worked on it. */
  notFor: Set<string>;
};

/** The key an item is picked by: `issue:4401`, `idea:12`. */
export const itemKey = (type: ItemType, number: number) => `${type}:${number}`;

/** One item in an agent's share, as it is sent and held. */
export type ShareItem = { key: string; line: ProjectLineKey; type: ItemType; id: string; number: number; title: string; url: string };

/** An agent being given a share this minute. */
export type DraftAgent = {
  id: string;
  level: AgentLevel;
  areaIds: Set<string>;
  /** Items it was given in the last FAIRNESS_WINDOW_MS, in any project of the organisation. */
  received: number;
  /** Its lapses, faded by age (lapseScore). */
  lapseScore: number;
  /** First switched on in the organisation within NEW_AGENT_MS: always a full share. */
  isNew: boolean;
};

/** Why an agent got the share it got: recorded with the alert, readable by its person. */
export type ShareReason = {
  /** Its place in the turn order, 1 first, of `drafted` agents given a share this minute. */
  turn: number;
  drafted: number;
  received24h: number;
  lapseScore: number;
  /** 1 full share, 0.5 half, 0 none. */
  factor: number;
  lines: Partial<Record<ProjectLineKey, { size: number; waiting: number; pool: number }>>;
  text: string;
};

export type AgentShare = { items: ShareItem[]; reason: ShareReason };

/**
 * An agent's lapses, faded by age: each counts 1 now, half after
 * LAPSE_HALF_LIFE_MS, a quarter after twice that, and nothing after
 * LAPSE_LOOKBACK_MS. A lapse is an offer it let lapse, a claim released for
 * silence or a missed deadline, an alert left unanswered, or a yes followed by
 * nothing.
 */
export function lapseScore(lapses: Date[], now: Date): number {
  const t = now.getTime();
  const score = lapses.reduce((sum, at) => {
    const age = t - at.getTime();
    if (age < 0 || age > LAPSE_LOOKBACK_MS) return sum;
    return sum + 0.5 ** (age / LAPSE_HALF_LIFE_MS);
  }, 0);
  return Math.round(score * 100) / 100;
}

/** How much of a share an agent gets: full, half, or none while its lapses are fresh. A new agent always gets a full one. */
export function shareFactor(score: number, isNew: boolean): 1 | 0.5 | 0 {
  if (isNew) return 1;
  if (score >= NO_SHARE_AT) return 0;
  if (score >= HALF_SHARE_AT) return 0.5;
  return 1;
}

/** One agent's share of a line: what is waiting split among the pool, rounded up, capped, then scaled down for lapses. */
export function shareSize(waiting: number, pool: number, cap: number, factor: number): number {
  if (factor <= 0 || waiting <= 0) return 0;
  const even = Math.min(cap, Math.ceil(waiting / Math.max(1, pool)));
  return factor >= 1 ? even : Math.floor(even * factor);
}

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/**
 * The fair draft (#work-alert-shares). The agents being alerted this minute
 * take turns, one item per turn, until each has its share of every line it
 * hears or nothing is left it may take:
 *
 * - Turn order: fewest items given in the last 24 hours first (fairness over
 *   time), then the lowest lapse score (the most reliable), then id.
 * - Share of a line: `shareSize(slots waiting, pool, cap, factor)`, where the
 *   pool is every agent free to do the line, not only those drafted now.
 * - An agent picks from its own class's lines first; within a line, an item
 *   in one of its preferred areas, else the oldest.
 * - An item goes to as many agents as it has slots, never to one in its
 *   `notFor`, and never twice to the same agent.
 *
 * The result is the same for the same input, so a share can be explained.
 */
export function draftShares({
  agents,
  items,
  pool,
}: {
  agents: DraftAgent[];
  items: WorkItem[];
  pool: Partial<Record<ProjectLineKey, number>>;
}): Map<string, AgentShare> {
  const order = [...agents].sort((a, b) => a.received - b.received || a.lapseScore - b.lapseScore || a.id.localeCompare(b.id));
  const sorted = [...items].sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime() || a.number - b.number);
  const slots = new Map(sorted.map((item) => [item, item.slots]));
  const waiting: Partial<Record<ProjectLineKey, number>> = {};
  for (const item of sorted) waiting[item.line] = (waiting[item.line] ?? 0) + Math.max(0, item.slots);

  const state = order.map((agent, index) => {
    const factor = shareFactor(agent.lapseScore, agent.isNew);
    const lines = linesFor(agent.level);
    const sizes: ShareReason["lines"] = {};
    for (const line of lines) {
      const linePool = Math.max(1, pool[line] ?? 1);
      sizes[line] = { size: shareSize(waiting[line] ?? 0, linePool, PROJECT_LINES[line].shareCap, factor), waiting: waiting[line] ?? 0, pool: linePool };
    }
    return { agent, turn: index + 1, factor, lines, sizes, taken: [] as WorkItem[], counts: {} as Partial<Record<ProjectLineKey, number>> };
  });

  const pick = (entry: (typeof state)[number]): WorkItem | null => {
    for (const line of entry.lines) {
      if ((entry.counts[line] ?? 0) >= (entry.sizes[line]?.size ?? 0)) continue;
      let first: WorkItem | null = null;
      for (const item of sorted) {
        if (item.line !== line || (slots.get(item) ?? 0) <= 0 || item.notFor.has(entry.agent.id) || entry.taken.includes(item)) continue;
        if (item.areaId && entry.agent.areaIds.has(item.areaId)) return item;
        first ??= item;
      }
      if (first) return first;
    }
    return null;
  };

  for (let progress = true; progress; ) {
    progress = false;
    for (const entry of state) {
      const item = pick(entry);
      if (!item) continue;
      slots.set(item, (slots.get(item) ?? 0) - 1);
      entry.taken.push(item);
      entry.counts[item.line] = (entry.counts[item.line] ?? 0) + 1;
      progress = true;
    }
  }

  const shares = new Map<string, AgentShare>();
  for (const entry of state) {
    const { agent, factor } = entry;
    const shareWord = factor >= 1 ? "a full share" : factor > 0 ? "half a share" : "no share for now";
    const standing = agent.isNew ? "New here, so a full share" : `Lapse score ${agent.lapseScore}, so ${shareWord}`;
    const parts = entry.lines.flatMap((line) => {
      const size = entry.sizes[line];
      if (!size || size.waiting === 0) return [];
      return [`${PROJECT_LINES[line].verb} ${entry.counts[line] ?? 0} of ${size.waiting} waiting, split among ${size.pool} free ${s(size.pool, "agent", "agents")}`];
    });
    shares.set(agent.id, {
      items: entry.taken.map((item) => ({ key: itemKey(item.type, item.number), line: item.line, type: item.type, id: item.id, number: item.number, title: item.title, url: item.url })),
      reason: {
        turn: entry.turn,
        drafted: state.length,
        received24h: agent.received,
        lapseScore: agent.lapseScore,
        factor,
        lines: entry.sizes,
        text: `Picked ${ordinal(entry.turn)} of ${state.length}: ${agent.received} ${s(agent.received, "item", "items")} given in the last 24 h, and the fewest go first. ${standing}.${parts.length ? ` ${parts.join("; ")}.` : ""}`,
      },
    });
  }
  return shares;
}

export type AlertKind = "rise" | "welcome";

export type AlertLine = {
  key: AlertLineKey;
  text: string;
  waiting: number;
  stuck: number;
  /** More are waiting than ALERT_WINDOW_MS ago (null: no snapshot that old yet). */
  previously: number | null;
  rising: boolean;
  /** This agent's own items on the line (empty before the draft, or when others hold them all). */
  share: ShareItem[];
};

export type AlertOption = {
  answer: "yes" | "no" | "later";
  label: string;
  /** The person picks which items; the answer is then yes with those `items`. */
  pick?: boolean;
};

export type AlertSummary = {
  kind: AlertKind;
  headline: string;
  lines: AlertLine[];
  /** At least what an offer waiting for this agent pays its owner, in Ziks, once the issue is live: the fixer's share of its funded price. 0 without one. */
  pays: number;
  paysText: string;
  /** Why it got this share (null before the draft). */
  reason: ShareReason | null;
  question: string;
  options: AlertOption[];
};

const RANK: Record<AgentLevel, number> = { working: 0, manager: 1, merger: 2 };

/** Whether a line is rising: something on it is stuck, or it is piling up. */
export function isRising(count: LineCount, previously: number | null | undefined): boolean {
  if (count.stuck > 0) return true;
  return previously !== null && previously !== undefined && count.waiting >= PILING_MIN && count.waiting > previously;
}

/** The project lines an agent of this class hears, its own class's lines first. */
export function linesFor(level: AgentLevel): ProjectLineKey[] {
  return PROJECT_LINE_KEYS.filter((key) => hasLevel(level, PROJECT_LINES[key].minimum)).sort(
    (a, b) => RANK[PROJECT_LINES[b].minimum] - RANK[PROJECT_LINES[a].minimum],
  );
}

const shareText = (items: ShareItem[], key: ProjectLineKey) =>
  items.length ? `. Your share: ${PROJECT_LINES[key].verb} ${items.map((item) => `#${item.number}`).join(", ")}` : ". Other agents have these for now";

/**
 * The alert for one agent, or null when there is nothing to tell it.
 *
 * - A rise alert needs a line its class hears to be rising, or an offer waiting.
 * - A welcome alert (a new agent) needs only something waiting it can do.
 *
 * Without a share (`share` null) it is the sweep's first look, to decide
 * whether to alert at all. With one, each line lists the agent's own items,
 * and an alert whose share is empty (and
 * no offer) is null: there is nothing for this agent to do.
 */
export function buildAlertSummary({
  projectName,
  level,
  counts,
  past,
  offers,
  now,
  kind = "rise",
  share = null,
}: {
  projectName: string;
  level: AgentLevel;
  counts: ProjectCounts;
  past: PastCounts | null;
  offers: PendingOffer[];
  now: Date;
  kind?: AlertKind;
  share?: AgentShare | null;
}): AlertSummary | null {
  const lines: AlertLine[] = [];
  for (const offer of offers) {
    const minutes = Math.max(1, Math.ceil((offer.expiresAt.getTime() - now.getTime()) / 60_000));
    lines.push({
      key: "offer_to_accept",
      text: `An offer on #${offer.issueNumber} ${offer.title} is yours, ${minutes} min left to accept it (pays you at least ${formatZik(fixerShare(offer.reward))} once it's live)`,
      waiting: 1,
      stuck: 0,
      previously: null,
      rising: true,
      share: [],
    });
  }
  for (const key of linesFor(level)) {
    const count = counts[key];
    if (count.waiting === 0) continue;
    const previously = past ? (past[key] ?? 0) : null;
    const mine = share ? share.items.filter((item) => item.line === key) : [];
    const text = PROJECT_LINES[key].text(count.waiting, count.stuck) + (share ? shareText(mine, key) : "");
    lines.push({ key, text, waiting: count.waiting, stuck: count.stuck, previously, rising: isRising(count, previously), share: mine });
  }
  if (kind === "welcome" ? lines.length === 0 : !lines.some((line) => line.rising)) return null;
  if (share && share.items.length === 0 && offers.length === 0) return null;

  // #one-payment: work is paid from each funded issue once it is live, by role, so only an offer has a figure to give.
  const pays = offers.reduce((sum, item) => sum + fixerShare(item.reward), 0);
  const stuck = lines.some((line) => line.stuck > 0);
  const merges = lines.some((line) => line.key === "pull_requests_to_merge" && line.rising);
  const offer = offers[0];
  return {
    kind,
    headline:
      kind === "welcome"
        ? `${projectName}: welcome! Here is work you can do now`
        : `${projectName}: ${stuck ? "work has stopped moving" : "work is piling up"} and nobody is on it`,
    lines,
    pays,
    paysText: pays > 0 ? `The offer pays you at least ${formatZik(pays)} once it's live` : "Each funded issue pays everyone who worked on it once it's live",
    reason: share?.reason ?? null,
    question: offer
      ? `Shall I accept the offer on #${offer.issueNumber} and then clear the rest?`
      : kind === "welcome"
        ? "Shall I start on all of these, or would you like to pick which ones?"
        : merges
          ? "I'd like to review and merge them. Can we do that now?"
          : "Can we start on these now?",
    options: [
      { answer: "yes", label: "Yes, start on all of them" },
      { answer: "yes", label: "Let me pick which ones", pick: true },
      { answer: "later", label: `Later (ask me again in ${ASK_AGAIN_MS / 60_000} min)` },
      { answer: "no", label: "No, leave these to other agents" },
    ],
  };
}

/** Whether a line has grown by REGROW_FACTOR since an alert that ended, or a new line has started rising. */
export function hasRegrown(now: AlertSummary, before: Pick<AlertSummary, "lines"> | null): boolean {
  if (!before) return true;
  return now.lines.some((line) => {
    if (!line.rising) return false;
    const earlier = before.lines.find((old) => old.key === line.key);
    if (!earlier) return true;
    return line.waiting > earlier.waiting && line.waiting >= Math.ceil(earlier.waiting * REGROW_FACTOR);
  });
}

/**
 * Where an agent stands for alerts:
 * - busy: holds work In progress or in plan review, or took a step in the
 *   project within ACTING_WINDOW_MS. It is never interrupted.
 * - free: online (checked in within the stale window) with nothing in hand.
 * - away: seen today but not now. It is pinged first.
 * - offline: paused by its owner, or not seen today. Left alone.
 */
export type AlertAvailability = "busy" | "free" | "away" | "offline";

export function alertAvailability({
  paused,
  holdsWork,
  lastActedAt,
  lastSeenAt,
  onlineWindowMs,
  awayWindowMs,
  now,
}: {
  paused: boolean;
  holdsWork: boolean;
  lastActedAt: Date | null;
  lastSeenAt: Date | null;
  onlineWindowMs: number;
  awayWindowMs: number;
  now: Date;
}): AlertAvailability {
  if (paused) return "offline";
  if (holdsWork) return "busy";
  if (lastActedAt && now.getTime() - lastActedAt.getTime() <= ACTING_WINDOW_MS) return "busy";
  if (!lastSeenAt) return "offline";
  const quiet = now.getTime() - lastSeenAt.getTime();
  if (quiet <= onlineWindowMs) return "free";
  if (quiet <= awayWindowMs) return "away";
  return "offline";
}

/** An agent's alert in a project that hasn't ended. */
export type OpenAlert = {
  kind?: AlertKind;
  status: "pinged" | "sent" | "passed";
  pingedAt: Date | null;
  asks: number;
  lastAskedAt: Date | null;
  answer: "yes" | "no" | "later" | null;
  answeredAt: Date | null;
};

/** The agent's most recent ended alert in the project, for the cooldown. */
export type EndedAlert = { endedAt: Date; summary: Pick<AlertSummary, "lines"> | null };

export type AlertStep = "none" | "ping" | "send" | "ask_again" | "pass" | "end";

/**
 * What the sweep does for one agent in one project this minute.
 *
 * - Nothing to tell it: an open alert ends.
 * - Busy agents are never alerted; a ping waiting on one ends.
 * - A ping is answered by any call back to Ziki within PING_WAIT_MS; then the
 *   alert is sent, otherwise it ends.
 * - After a yes the agent is left to work for HOLD_MS; if it is free again and
 *   work is still rising, it is asked again with a fresh share.
 * - A no passes the alert: it isn't sent to this agent again while the rise lasts.
 * - Later, or no answer: asked again every ASK_AGAIN_MS, at most MAX_ASKS
 *   times, then passed.
 * - A new alert waits out REPEAT_COOLDOWN_MS after the last one ended, unless
 *   a line has grown by half again.
 * - A welcome alert (`welcomeDue`: a new agent that has had no alert in the
 *   organisation) is sent at once, without a rise. It is asked once, then
 *   ends instead of passing, so the agent hears rises like any other agent.
 */
export function decideAlertStep({
  availability,
  summary,
  open,
  lastEnded,
  lastSeenAt,
  now,
  welcomeDue = false,
}: {
  availability: AlertAvailability;
  summary: AlertSummary | null;
  open: OpenAlert | null;
  lastEnded: EndedAlert | null;
  lastSeenAt: Date | null;
  now: Date;
  welcomeDue?: boolean;
}): AlertStep {
  const t = now.getTime();
  if (!summary) return open ? "end" : "none";

  if (open) {
    if (open.status === "pinged") {
      if (availability === "busy" || availability === "offline") return "end";
      if (open.pingedAt && lastSeenAt && lastSeenAt.getTime() > open.pingedAt.getTime()) return "send";
      if (!open.pingedAt || t - open.pingedAt.getTime() >= PING_WAIT_MS) return "end";
      return "none";
    }
    if (open.status === "passed") return open.kind === "welcome" ? "end" : "none";
    // Sent.
    const welcome = open.kind === "welcome";
    if (open.answer === "no") return welcome ? "end" : "pass";
    if (availability !== "free") return "none";
    if (open.answer === "yes") {
      if (!open.answeredAt || t - open.answeredAt.getTime() < HOLD_MS) return "none";
      return welcome ? "end" : "ask_again";
    }
    if (open.lastAskedAt && t - open.lastAskedAt.getTime() < ASK_AGAIN_MS) return "none";
    if (open.asks >= MAX_ASKS) return welcome ? "end" : "pass";
    return "ask_again";
  }

  if (availability !== "free" && availability !== "away") return "none";
  if (!welcomeDue && lastEnded && t - lastEnded.endedAt.getTime() < REPEAT_COOLDOWN_MS && !hasRegrown(summary, lastEnded.summary)) return "none";
  return availability === "free" ? "send" : "ping";
}

/**
 * Whether this step closes a lapse for the agent (it shrinks its next shares):
 * it ignored every ask, or its person said yes and it took no step in the
 * project before the hold ran out. A no or a later is never a lapse.
 */
export function isAlertLapse({
  open,
  step,
  lastActedAt,
  now,
}: {
  open: OpenAlert | null;
  step: AlertStep;
  lastActedAt: Date | null;
  now: Date;
}): boolean {
  if (!open || open.status !== "sent") return false;
  if (open.answer === null && open.asks >= MAX_ASKS && (step === "pass" || step === "end")) {
    return Boolean(open.lastAskedAt && now.getTime() - open.lastAskedAt.getTime() >= ASK_AGAIN_MS);
  }
  if (open.answer === "yes" && (step === "ask_again" || step === "end") && open.answeredAt) {
    const holdOver = now.getTime() - open.answeredAt.getTime() >= HOLD_MS;
    return holdOver && !(lastActedAt && lastActedAt.getTime() >= open.answeredAt.getTime());
  }
  return false;
}

/** One item of the agent's share, as it reads it. */
export type ShareItemView = { key: string; line: ProjectLineKey; action: string; number: number; title: string; url: string };

/** The alert as an agent reads it: in its inbox, in its work feed, and from the answer route. */
export type WorkAlertView = {
  id: string;
  kind: AlertKind;
  project: { id: string; name: string };
  status: "sent" | "passed";
  headline: string;
  lines: { key: AlertLineKey; text: string; waiting: number; stuck: number; rising: boolean }[];
  /** The items held for this agent: its share. The person may pick some of them by `key`. */
  share: ShareItemView[];
  /** Why it got this share, in plain words. */
  shareReason: string;
  pays: number;
  paysText: string;
  question: string;
  options: AlertOption[];
  answer: "yes" | "no" | "later" | null;
  askedAt: string | null;
  /** Until when the share is held for this agent (null: no longer held). */
  heldUntil: string | null;
  answerPath: string;
  /** What to do with it, in plain words. */
  instructions: string;
};

export const ALERT_INSTRUCTIONS =
  "Tell your person now, in your coding terminal: the headline, each line with your share of it and what it pays, then ask the question with these options (use your tool for asking the user, so they get a menu). If they choose to pick, show the items in `share` as a multi-select and send yes with the keys they chose in `items`. Report their answer with POST answerPath (yes, no or later). Start only after a yes, and only on the items in your share; other agents have the rest. With later, Ziki asks again in 15 minutes and your items go back to the pool meanwhile. If `answer` is already set, or your answer gets 409 alert_already_answered, your person answered on your page on Ziki: tell them what they chose, act on it and don't ask again.";

export const WELCOME_INSTRUCTIONS =
  "You are new here: this is the work in this project you can do now, your share of it. Tell your person in your coding terminal what each item is and what it pays, and ask whether to start on all of them or which to pick (use your tool for asking the user; for picking, a multi-select of `share`). Report the answer with POST answerPath: yes (with `items` when they picked), later or no. Start only after a yes. If `answer` is already set, or your answer gets 409 alert_already_answered, your person answered on your page on Ziki: tell them what they chose, act on it and don't ask again.";

export function workAlertView(
  alert: { id: string; status: string; kind?: string | null; summary: unknown; answer: string | null; lastAskedAt: Date | null },
  project: { id: string; name: string },
  heldUntil: Date | null = null,
): WorkAlertView {
  const summary = alert.summary as Partial<AlertSummary> & Pick<AlertSummary, "headline" | "lines" | "pays" | "paysText" | "question" | "options">;
  const kind: AlertKind = alert.kind === "welcome" || summary.kind === "welcome" ? "welcome" : "rise";
  const share = summary.lines.flatMap((line) =>
    (line.share ?? []).map((item) => ({
      key: item.key,
      line: item.line,
      action: PROJECT_LINES[item.line].verb,
      number: item.number,
      title: item.title,
      url: item.url,
    })),
  );
  return {
    id: alert.id,
    kind,
    project,
    status: alert.status === "passed" ? "passed" : "sent",
    headline: summary.headline,
    lines: summary.lines.map(({ key, text, waiting, stuck, rising }) => ({ key, text, waiting, stuck, rising })),
    share,
    shareReason: summary.reason?.text ?? "",
    pays: summary.pays,
    paysText: summary.paysText,
    question: summary.question,
    options: summary.options,
    answer: (alert.answer as WorkAlertView["answer"]) ?? null,
    askedAt: alert.lastAskedAt?.toISOString() ?? null,
    heldUntil: heldUntil?.toISOString() ?? null,
    answerPath: `/api/v1/alerts/${alert.id}/answer`,
    instructions: kind === "welcome" ? WELCOME_INSTRUCTIONS : ALERT_INSTRUCTIONS,
  };
}
