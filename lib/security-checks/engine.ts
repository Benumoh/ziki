import type { Prisma, PrismaClient, SecurityCheckStatus, SecuritySeverity, SecurityTargetKind } from "@prisma/client";
import { appendRows } from "@/lib/coins/ledger";
import { feeOf } from "@/lib/coins/math";
import { logger } from "@/lib/logger";
import { ON_CALL_QUIET_AFTER_MS, SEVERITY_PRICE, ZIKI_SECURITY_AGENT_USERNAME, agentsMayWork, fallbackWindowMs, ownershipProofRequired, provenTargetWhere, scanPaymentWhere } from "@/lib/security-checks";
import { cleanParts, coreParts, planParts, writeSummary, type PageReader, type PlannedPart, type SecurityAi } from "./ai";
import { pickAgentFor, type CandidateAgent } from "./assign";
import { quickScanForAgents, type QuickScanLine } from "./preview-summary";
import { fixBucketOf, type FixSource } from "./fix-bucket";
import { realNetwork } from "./ownership";
import { codeRoute } from "./repo-access";

/**
 * The security check engine (#security-checks, 12 Nov plan H1).
 *
 * 1. A new deeper scan starts after payment (18 Nov), and ownership proof when required.
 *    Historical free checks remain eligible. `startCheck`, called after payment or by the sweep,
 *    has Ziki's own AI split it into parts. It is
 *    not an agent and earns nothing.
 * 2. Each part goes to a security-cleared agent (its owner's `User.securityClearedAt`)
 *    when that agent asks for security work (`listAgentJobs`), never pushed by the
 *    sweep: an agent that only does normal Ziki work would hold a part it never sees
 *    (16 Nov call). On-call agents first, then agents in the client's workspace, then
 *    the least busy. A few parts at a time each.
 * 3. Each part's agent reports what it found. Each result's price is set from
 *    its severity (`SEVERITY_PRICE`).
 * 4. When every part is in, Ziki's AI writes the summary from severities and
 *    titles only, and the report is posted (`postedAt`, `done`). Only then
 *    does the client see anything.
 * 5. A part not reported within JOB_TIMEOUT_MINUTES goes back to waiting, for
 *    another agent.
 * 6. When the client unlocks a finding, the agent's owner that found it is paid
 *    what the client paid, less Ziki's fee, once (`payoutReleasedAt`, source key
 *    `security-finding:<resultId>`). Free scans that are never unlocked pay nobody.
 *
 * Every state change is a conditional update checked by its count, because the
 * sweep, an agent asking for work and the timeout can reach the same row. AI
 * calls never run inside a transaction. Results are private: nothing here logs
 * or publishes their text.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;
type Transactional = Pick<PrismaClient, "$transaction">;
type EngineDb = Db & Transactional;

export const JOB_TIMEOUT_MINUTES = 60;
/** How many open parts one agent may hold, so a check's parts spread across agents. */
export const MAX_OPEN_JOBS_PER_AGENT = 2;
/** A split or summary whose run crashed is retried after this long. */
export const STUCK_AFTER_MINUTES = 10;
export const MAX_RESULTS_PER_PART = 20;
/**
 * Ziki's list is where a check starts; an agent that finds something worth looking at that no part covers
 * may add parts with its report (15 Nov call). A few per report, and a ceiling per check so it can't grow for ever.
 */
export const MAX_MORE_PARTS_PER_REPORT = 3;
/** How many earlier findings one recheck part may hold on a rescan (#security-rescan): one area's worth. */
export const MAX_RECHECKS_PER_PART = 40;
export const MAX_PARTS_PER_CHECK = 40;
/**
 * Shown on Your work until it moves to per-finding earnings (12 Nov plan C1).
 * Parts no longer pay by themselves: the finder of each unlocked finding earns its price.
 */
export const SPLIT_JOB_POINTS = 5;
export const PART_JOB_POINTS = 3;

export class SecurityJobError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SecurityJobError";
  }
}

/** Source key for a finding's pay: one per finding, so it pays once. */
export function findingSourceKey(resultId: string): string {
  return `security-finding:${resultId}`;
}

/** Dependencies for the AI steps; real ones by default, fakes in tests. */
export type EngineDeps = { ai?: SecurityAi | null; readPage?: PageReader | null };

/** Reads a target's public home page through the ownership step's safe network: public addresses only, one same-site redirect. */
export const readPublicPage: PageReader = async (url) => {
  try {
    let res = await realNetwork.get(url);
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = new URL(res.location, url);
      if (next.hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "")) return null;
      res = await realNetwork.get(next.toString());
    }
    return res.status === 200 ? res.body : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// 1. Starting a check: Ziki's AI splits it.

/**
 * Starts a proven check: claims it (`queued` → `splitting`), has Ziki's AI plan
 * the parts outside any transaction, then saves them and moves it to
 * `checking`. Also starts a check whose earlier split crashed (`splitting`, no
 * parts, started more than STUCK_AFTER_MINUTES ago). True when it started.
 *
 * The ownership step calls this right after proof, so a check starts in
 * seconds; run it after the response (Next's `after()`), not inside it.
 */
export async function startCheck(db: EngineDb, checkId: string, now = new Date(), deps: EngineDeps = {}): Promise<boolean> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000);
  const { count } = await db.securityCheck.updateMany({
    where: {
      id: checkId,
      ...provenTargetWhere(),
      ...scanPaymentWhere(),
      OR: [
        { status: { in: startableStatuses() } },
        { status: "splitting", startedAt: { lt: stuckBefore }, items: { none: { kind: "check" } } },
      ],
    },
    data: { status: "splitting", startedAt: now },
  });
  if (count !== 1) return false;

  let saved: boolean;
  try {
    const check = await db.securityCheck.findUnique({
      where: { id: checkId },
      select: { previousCheckId: true, organisationId: true, requestedById: true, targetId: true, target: { select: { kind: true, value: true } } },
    });
    if (!check) return false;
    // A rescan (#security-rescan) rechecks what was found before and repeats the earlier scan's parts (18 Nov: the same
    // checklist every time, so a new finding means the site changed, not that a different area was picked).
    const earlierRows = check.previousCheckId ? await earlierOpenRows(db, check, checkId) : [];
    const parts = check.previousCheckId
      ? await rescanParts(db, check.previousCheckId, check.target, earlierRows.map((row) => row.title))
      : (await planParts(check.target, { ai: deps.ai, readPage: deps.readPage === undefined ? readPublicPage : deps.readPage })).parts;
    const rechecks = recheckParts(toRecheck(earlierRows));

    saved = await db.$transaction(async (tx) => {
      const { count: still } = await tx.securityCheck.updateMany({
        where: { id: checkId, status: "splitting", startedAt: now, items: { none: { kind: "check" } } },
        data: { status: "checking" },
      });
      if (still !== 1) return false;
      for (const part of rechecks) {
        const created = await tx.securityCheckItem.create({
          data: { checkId, kind: "check", title: part.title, instructions: part.instructions },
          select: { id: true },
        });
        await tx.securityCheckResult.updateMany({ where: { id: { in: part.resultIds } }, data: { recheckItemId: created.id } });
      }
      await tx.securityCheckItem.createMany({
        data: parts.map((part) => ({ checkId, kind: "check" as const, title: part.title, instructions: part.instructions })),
      });
      return true;
    });
  } catch (error) {
    // Claimed but never split: give it back to waiting now, so the next sweep starts it again, instead of
    // leaving it on "Planning the checks" until the stuck-split recovery (STUCK_AFTER_MINUTES).
    await db.securityCheck.updateMany({ where: { id: checkId, status: "splitting", startedAt: now, items: { none: { kind: "check" } } }, data: { status: "queued", startedAt: null } }).catch(() => undefined);
    throw error;
  }
  // The parts wait for agents that ask for work (they ask every few seconds); none are pushed (16 Nov call).
  return saved;
}

/** An earlier finding a rescan looks at again, with the area (part title) that found it. */
export type EarlierFinding = { id: string; title: string; area: string };

type EarlierRow = {
  id: string;
  title: string;
  /** `kind` is absent in older test data; `automatic` marks Ziki's own code checks. */
  item: { title: string; kind?: string };
  finding: FixSource | null;
};

/**
 * Every finding on this person's earlier scans of the same site, in the same workspace, that no rescan has called
 * fixed. Removed scans don't count.
 */
async function earlierOpenRows(
  db: Db,
  check: { organisationId: string; requestedById: string; targetId: string },
  excludeCheckId: string,
): Promise<EarlierRow[]> {
  return db.securityCheckResult.findMany({
    where: {
      checkId: { not: excludeCheckId },
      check: { organisationId: check.organisationId, requestedById: check.requestedById, targetId: check.targetId, status: { not: "cancelled" } },
      OR: [{ recheckState: null }, { recheckState: "still_there" }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      item: { select: { title: true, kind: true } },
      finding: { select: { bug: { select: { status: true, isDeleted: true } }, idea: { select: { status: true, isDeleted: true } } } },
    },
  });
}

/**
 * The open earlier findings a rescan rechecks. A finding already sent to fix whose fix is still in progress is skipped
 * (18 Nov): its issue is being worked on, so checking it again tells nobody anything. Once that issue is resolved or
 * closed, the next rescan rechecks it, which confirms the fix. Ziki's own code findings aren't given to agents:
 * the rescan's quick scan rechecks them (`saveCodeFindings`).
 */
function toRecheck(rows: ReadonlyArray<EarlierRow>): EarlierFinding[] {
  return rows
    .filter((row) => row.item.kind !== "automatic")
    .filter((row) => !row.finding || fixBucketOf(row.finding) !== "fixing")
    .map((row) => ({ id: row.id, title: row.title, area: row.item.title }));
}

/**
 * How many earlier findings a rescan rechecks, for its confirm (18 Nov): agents' ones and Ziki's own code findings
 * (rechecked by the rescan's quick scan), less the ones still being fixed.
 */
export async function earlierFindingsToRecheck(
  db: Db,
  check: { organisationId: string; requestedById: string; targetId: string },
  excludeCheckId: string,
): Promise<number> {
  return (await earlierOpenRows(db, check, excludeCheckId)).filter((row) => !row.finding || fixBucketOf(row.finding) !== "fixing").length;
}

/** Recheck parts are named this way, so a later rescan can tell them apart from the parts it repeats. */
export const RECHECK_TITLE_PREFIX = "Recheck: ";
/** At most this many parts a rescan repeats: an old scan's own parts plus the core checklist. */
export const MAX_RESCAN_PARTS = 40;
/** Starts the list of earlier findings added to a rescan's parts; a later rescan cuts it off before repeating the part. */
export const KNOWN_FINDINGS_HEADING = "\n\nAlready found on earlier scans of this site";
const KNOWN_FINDINGS_MAX_CHARS = 1500;

/**
 * The parts a rescan repeats (18 Nov, Tolu: the same checklist every time). The core checklist for the target's kind
 * comes first, then every other part the earlier scan ran (the AI's extras and any an agent added), with the same
 * instructions. Its recheck parts aren't repeated: this rescan makes its own. No AI is asked, so nothing new is
 * planned. Each part is told the earlier findings, so a known problem isn't filed again under another name.
 * A scan made before the core checklist existed gets the core added to its own parts once.
 */
export async function rescanParts(
  db: Db,
  previousCheckId: string,
  target: { kind: SecurityTargetKind; value: string },
  knownTitles: ReadonlyArray<string>,
): Promise<PlannedPart[]> {
  const earlier = await db.securityCheckItem.findMany({
    where: { checkId: previousCheckId, kind: "check" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { title: true, instructions: true },
  });
  const repeated = earlier
    .filter((part) => !part.title.startsWith(RECHECK_TITLE_PREFIX))
    .map((part) => ({ title: part.title, instructions: (part.instructions ?? "").split(KNOWN_FINDINGS_HEADING)[0]! }));
  const seen = new Set<string>();
  const parts: PlannedPart[] = [];
  for (const part of [...coreParts(target.kind, target.value), ...repeated]) {
    const title = part.title.trim().slice(0, 200);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    parts.push({ title, instructions: withKnownFindings(part.instructions.trim() || title, knownTitles) });
    if (parts.length === MAX_RESCAN_PARTS) break;
  }
  return parts;
}

/** A title as compared for repeats: case, extra spaces and a trailing full stop don't count. */
function sameTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
}

/** Adds the earlier findings' titles to a part's instructions, so the agent doesn't report them as new. */
function withKnownFindings(instructions: string, knownTitles: ReadonlyArray<string>): string {
  const lines: string[] = [];
  let length = 0;
  for (const title of new Set(knownTitles)) {
    const line = `- ${title.slice(0, 150)}`;
    if (length + line.length > KNOWN_FINDINGS_MAX_CHARS) break;
    lines.push(line);
    length += line.length + 1;
  }
  if (lines.length === 0) return instructions;
  const note = `${KNOWN_FINDINGS_HEADING} (they are rechecked separately; don't report them, or the same problem under another name, as new):\n${lines.join("\n")}`;
  return `${instructions.slice(0, 4000 - note.length)}${note}`;
}

/** One recheck part per area of the earlier report, split so no part holds more than MAX_RECHECKS_PER_PART. */
export function recheckParts(earlier: ReadonlyArray<EarlierFinding>): { title: string; instructions: string; resultIds: string[] }[] {
  const byArea = new Map<string, string[]>();
  for (const finding of earlier) byArea.set(finding.area, [...(byArea.get(finding.area) ?? []), finding.id]);
  const parts: { title: string; instructions: string; resultIds: string[] }[] = [];
  for (const [area, ids] of byArea) {
    for (let at = 0; at < ids.length; at += MAX_RECHECKS_PER_PART) {
      parts.push({
        title: `${RECHECK_TITLE_PREFIX}${area}`.slice(0, 200),
        instructions:
          "Look again at each earlier finding this part lists (`recheck`) and answer each one in `rechecks`: `still_there` if you can still see it, `fixed` only if you checked and it's gone, with a short note of what you saw. Send no `results` here: this part only rechecks, and the scan's other parts look for anything new. Look only.",
        resultIds: ids.slice(at, at + MAX_RECHECKS_PER_PART),
      });
    }
  }
  return parts;
}

/**
 * The states a check may start from: waiting to start, and, while ownership
 * proof is off (14 Nov plan), also a check created waiting for proof, since
 * nothing will ever prove it. So a check starts as soon as it is added, whatever
 * state the add step left it in.
 */
function startableStatuses(): SecurityCheckStatus[] {
  return ownershipProofRequired() ? ["queued"] : ["queued", "awaiting_ownership"];
}

/**
 * Starts the check in the background and never throws. Call it right after a
 * check is added (inside Next's `after()`), and, with proof on, after proof.
 * If it isn't called, the sweep (every minute) starts the check anyway.
 */
export function kickCheck(db: EngineDb, checkId: string): Promise<void> {
  return startCheck(db, checkId).then(
    () => undefined,
    () => logger.error("[security-checks] starting a check failed; the sweep retries it"),
  );
}

/** Starts every proven check still waiting, and any whose split crashed. A few per sweep. */
export async function startWaitingChecks(db: EngineDb, now = new Date(), deps: EngineDeps = {}): Promise<number> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000);
  const waiting = await db.securityCheck.findMany({
    where: {
      ...provenTargetWhere(),
      ...scanPaymentWhere(),
      OR: [{ status: { in: startableStatuses() } }, { status: "splitting", startedAt: { lt: stuckBefore }, items: { none: { kind: "check" } } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: 5,
  });
  let started = 0;
  for (const { id } of waiting) if (await startCheck(db, id, now, deps)) started++;
  return started;
}

// ---------------------------------------------------------------------------
// 2. Parts go back when an agent sits on them, or when the check stopped.

/**
 * Takes back parts not reported in time, and skips open jobs that no longer
 * apply: those of cancelled checks, and the old split and collate jobs
 * (Ziki's AI does both now).
 */
export async function reclaimStaleJobs(db: Db, now = new Date()): Promise<{ reclaimed: number; skipped: number }> {
  const cutoff = new Date(now.getTime() - JOB_TIMEOUT_MINUTES * 60_000);
  const reclaimed = await db.securityCheckItem.updateMany({
    where: { kind: "check", status: "checking", assignedAt: { lt: cutoff } },
    data: { status: "waiting", agentId: null, assignedAt: null },
  });
  const skipped = await db.securityCheckItem.updateMany({
    where: {
      status: { in: ["waiting", "checking"] },
      OR: [{ check: { status: "cancelled" } }, { kind: { in: ["split", "collate"] } }],
    },
    data: { status: "skipped" },
  });
  return { reclaimed: reclaimed.count, skipped: skipped.count };
}

// ---------------------------------------------------------------------------
// 3. Waiting parts go to cleared agents.

/** Security-cleared agents that are online, not quiet and not paused, with room for another part. */
export async function availableAgents(db: Db, now = new Date(), onlyAgentId?: string): Promise<CandidateAgent[]> {
  const seenSince = new Date(now.getTime() - ON_CALL_QUIET_AFTER_MS);
  const agents = await db.agent.findMany({
    where: {
      ...(onlyAgentId ? { id: onlyAgentId } : {}),
      owner: { securityClearedAt: { not: null } },
      revokedAt: null,
      pausedAt: null,
      apiKeys: { some: { revokedAt: null, lastUsedAt: { gte: seenSince } } },
    },
    select: {
      id: true,
      owner: { select: { onCallAt: true } },
      activations: { where: { deactivatedAt: null }, select: { organisationId: true } },
      _count: { select: { securityCheckItems: { where: { status: "checking" } } } },
    },
  });
  return agents
    .map((agent) => ({
      id: agent.id,
      onCall: agent.owner.onCallAt !== null,
      organisationIds: agent.activations.map((a) => a.organisationId),
      openJobs: agent._count.securityCheckItems,
    }))
    .filter((agent) => agent.openJobs < MAX_OPEN_JOBS_PER_AGENT);
}

/**
 * Gives waiting parts, oldest first, to the agent asking for security work, if it is available and has room.
 * Only an agent that asks gets a part (16 Nov call): before, the sweep handed parts to any cleared agent seen
 * in the last 15 minutes, including ones that never ask for security work, and those parts sat for
 * JOB_TIMEOUT_MINUTES with nobody checking them.
 */
export async function assignWaitingJobs(db: Db, now: Date, agentId: string): Promise<number> {
  const agents = await availableAgents(db, now, agentId);
  if (agents.length === 0) return 0;
  // Real agents get a part only while it is young: after the fallback time only Ziki's own agent takes it
  // (lib/security-checks/fallback.ts), so an agent that keeps failing can't hold on to old parts for ever.
  const window = fallbackWindowMs();
  const waiting = await db.securityCheckItem.findMany({
    where: {
      kind: "check",
      status: "waiting",
      agentId: null,
      ...(window === null ? {} : { createdAt: { gte: new Date(now.getTime() - window) } }),
      check: { status: "checking", ...provenTargetWhere(), ...scanPaymentWhere() },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, check: { select: { organisationId: true } } },
    take: agents.length * MAX_OPEN_JOBS_PER_AGENT,
  });
  let assigned = 0;
  for (const item of waiting) {
    const agent = pickAgentFor(item.check.organisationId, agents, MAX_OPEN_JOBS_PER_AGENT);
    if (!agent) break;
    const { count } = await db.securityCheckItem.updateMany({
      where: { id: item.id, status: "waiting", agentId: null, check: { status: "checking", ...provenTargetWhere(), ...scanPaymentWhere() } },
      data: { status: "checking", agentId: agent.id, assignedAt: now },
    });
    if (count === 1) {
      agent.openJobs++;
      assigned++;
    }
  }
  return assigned;
}

// ---------------------------------------------------------------------------
// The agent's side.

export type SecurityJob = {
  id: string;
  kind: "check";
  title: string;
  instructions: string | null;
  assignedAt: Date | null;
  reportBy: Date | null;
  /** `quickScan`: what Ziki's quick code scan already found on this site (short titles only). Those are already in the report's list (18 Nov): don't report them again; a result repeating one is refused (`already_known`). */
  check: { id: string; target: { kind: string; value: string; quickScan: QuickScanLine[]; code?: { via: "ziki" | "clone"; url: string } } };
  /**
   * A rescan's recheck part (#security-rescan): the earlier findings to look at again. Answer each with
   * `rechecks` in the report, `still_there` or `fixed`. Empty on every other part.
   */
  recheck: { id: string; severity: SecuritySeverity; title: string; description: string }[];
};

/** The parts this agent holds now. It is given waiting parts first if it has room. */
export async function listAgentJobs(db: Db, agentId: string, now = new Date()): Promise<SecurityJob[]> {
  await assignWaitingJobs(db, now, agentId);
  const items = await db.securityCheckItem.findMany({
    where: { agentId, status: "checking", kind: "check", check: { status: "checking", ...provenTargetWhere(), ...scanPaymentWhere() } },
    orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      instructions: true,
      assignedAt: true,
      check: { select: { id: true, organisationId: true, target: { select: { kind: true, value: true, previewSummary: true } } } },
      recheckResults: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, severity: true, title: true, description: true } },
    },
  });
  // A repo's parts say how to reach its code (#security-repo-scan): through Ziki's /code API when the workspace
  // connected it through the GitHub App (private repos), else a public clone.
  const routes = new Map<string, "ziki" | "clone">();
  for (const { check } of items) {
    const key = `${check.organisationId}:${check.target.value}`;
    if (check.target.kind === "repo" && !routes.has(key)) routes.set(key, await codeRoute(db, check.organisationId, check.target.value));
  }
  return items.map(({ check, recheckResults, ...item }) => ({
    ...item,
    recheck: recheckResults,
    check: {
      id: check.id,
      target: {
        kind: check.target.kind,
        value: check.target.value,
        quickScan: quickScanForAgents(check.target.previewSummary),
        ...(check.target.kind === "repo" ? { code: { via: routes.get(`${check.organisationId}:${check.target.value}`) ?? "clone", url: `/api/v1/security-checks/jobs/${item.id}/code` } } : {}),
      },
    },
    kind: "check" as const,
    reportBy: item.assignedAt ? new Date(item.assignedAt.getTime() + JOB_TIMEOUT_MINUTES * 60_000) : null,
  }));
}

/** The part, if this agent holds it now and its check still allows work; otherwise a 404 or 409. */
async function heldJob(tx: Tx, agentId: string, itemId: string) {
  const item = await tx.securityCheckItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      kind: true,
      status: true,
      agentId: true,
      checkId: true,
      check: {
        select: {
          status: true,
          free: true,
          paidAt: true,
          previousCheckId: true,
          organisationId: true,
          requestedById: true,
          targetId: true,
          target: { select: { verifiedAt: true } },
        },
      },
    },
  });
  if (!item || item.agentId !== agentId || item.kind !== "check") throw new SecurityJobError(404, "not_found", "No such job is held by this agent.");
  if (item.status !== "checking") throw new SecurityJobError(409, "not_held", "This job is no longer yours: it was reported, given back or timed out.");
  if (!agentsMayWork(item.check, item.check.target)) {
    throw new SecurityJobError(409, "check_closed", "This check no longer takes work.");
  }
  return item;
}

export type ResultInput = { severity: SecuritySeverity; title: string; description: string; howToFix: string };

/** A recheck part's answer for one earlier finding (#security-rescan). */
export type RecheckInput = { id: string; state: "still_there" | "fixed"; note?: string };

/**
 * A part's report: stores what was found (possibly nothing), each priced by
 * its severity, and any more parts the agent asks for (`moreParts`: new, not already
 * on the check, a few per report, up to MAX_PARTS_PER_CHECK in all). They are saved
 * in the same step as the report, while the agent's own part is still the one holding the
 * check open, so a check never finishes with parts waiting to be saved. When it is the last
 * part, the caller posts the report (`postReportIfComplete`) after this returns.
 */
export async function submitReport(
  db: Transactional,
  agentId: string,
  itemId: string,
  results: ResultInput[],
  now = new Date(),
  moreParts: ReadonlyArray<PlannedPart> = [],
  rechecks: ReadonlyArray<RecheckInput> = [],
) {
  if (results.length > MAX_RESULTS_PER_PART) {
    throw new SecurityJobError(400, "too_many_results", `Report at most ${MAX_RESULTS_PER_PART} problems for one part.`);
  }
  return db.$transaction(async (tx) => {
    const item = await heldJob(tx, agentId, itemId);
    // A rescan's recheck part answers for the earlier findings it holds, and only those.
    const held = await tx.securityCheckResult.findMany({ where: { recheckItemId: itemId }, select: { id: true } });
    const heldIds = new Set(held.map((row) => row.id));
    const stray = rechecks.find((answer) => !heldIds.has(answer.id));
    if (stray) throw new SecurityJobError(400, "not_in_part", `Finding ${stray.id} isn't one this part rechecks.`);
    // A recheck part only answers for the earlier findings it holds (18 Nov): agents re-filing them as new results
    // listed every problem twice, the copies the only ones that could be ticked. New problems come from the other parts.
    if (heldIds.size > 0 && results.length > 0) {
      throw new SecurityJobError(
        400,
        "recheck_only",
        "This part only rechecks earlier findings: answer each one in `rechecks` (`still_there` or `fixed`) and send no `results`. The scan's other parts look for anything new.",
      );
    }
    // A new result that repeats a finding already in the list is refused (18 Nov, Tolu): an earlier open finding on a
    // rescan (rechecked by its own part) or one of this scan's own code checks (the quick scan, in the job's
    // `quickScan`). A copy would list the same problem twice. Each part's instructions list the earlier ones; this holds
    // even for an agent that ignores them. A finding a rescan called fixed may come back as new.
    if (results.length > 0) {
      const code = await tx.securityCheckResult.findMany({ where: { checkId: item.checkId, item: { kind: "automatic" } }, select: { title: true } });
      const earlier = item.check.previousCheckId ? await earlierOpenRows(tx, item.check, item.checkId) : [];
      const known = new Set([...code, ...earlier].map((row) => sameTitle(row.title)));
      const repeat = results.find((result) => known.has(sameTitle(result.title)));
      if (repeat) {
        throw new SecurityJobError(
          400,
          "already_known",
          `"${repeat.title.slice(0, 150)}" is already in this scan's list (found by Ziki's automatic checks or an earlier scan). Leave it out and report only what's new.`,
        );
      }
    }
    const { count } = await tx.securityCheckItem.updateMany({
      where: { id: itemId, agentId, status: "checking" },
      data: { status: "done", reportedAt: now },
    });
    if (count !== 1) throw new SecurityJobError(409, "not_held", "This job is no longer yours: it was reported, given back or timed out.");
    if (results.length > 0) {
      await tx.securityCheckResult.createMany({
        data: results.map((r) => ({
          checkId: item.checkId,
          itemId,
          severity: r.severity,
          title: r.title,
          description: r.description,
          howToFix: r.howToFix,
          priceCoins: SEVERITY_PRICE[r.severity],
        })),
      });
    }
    if (heldIds.size > 0) {
      const answers = new Map(rechecks.map((answer) => [answer.id, answer]));
      for (const id of heldIds) {
        // One left out counts as still there: a security problem isn't called fixed unless someone saw it gone.
        const answer = answers.get(id);
        await tx.securityCheckResult.update({
          where: { id },
          data: { recheckState: answer?.state ?? "still_there", recheckNote: answer?.note || null, recheckedAt: now, recheckCheckId: item.checkId },
        });
      }
    }
    const addedParts = await addMoreParts(tx, item.checkId, moreParts);
    return { checkId: item.checkId, results: results.length, rechecked: heldIds.size, addedParts };
  });
}

/** Saves the parts an agent asked to add: only new titles, a few per report, within the check's ceiling. Returns how many. */
async function addMoreParts(tx: Tx, checkId: string, asked: ReadonlyArray<PlannedPart>): Promise<number> {
  if (asked.length === 0) return 0;
  const existing = await tx.securityCheckItem.findMany({ where: { checkId, kind: "check" }, select: { title: true } });
  const taken = new Set(existing.map((part) => part.title.trim().toLowerCase()));
  const room = Math.max(0, MAX_PARTS_PER_CHECK - existing.length);
  const fresh = cleanParts(asked)
    .filter((part) => !taken.has(part.title.toLowerCase()))
    .slice(0, Math.min(MAX_MORE_PARTS_PER_REPORT, room));
  if (fresh.length === 0) return 0;
  await tx.securityCheckItem.createMany({
    data: fresh.map((part) => ({ checkId, kind: "check" as const, title: part.title, instructions: part.instructions })),
  });
  return fresh.length;
}

/** Gives a part back for another agent. */
export async function releaseJob(db: Db, agentId: string, itemId: string): Promise<void> {
  const { count } = await db.securityCheckItem.updateMany({
    where: { id: itemId, agentId, status: "checking" },
    data: { status: "waiting", agentId: null, assignedAt: null },
  });
  if (count !== 1) throw new SecurityJobError(409, "not_held", "This job is not held by this agent.");
}

// ---------------------------------------------------------------------------
// 4. Posting the report: Ziki's AI writes the summary.

/**
 * Once the check has parts and none is still open, posts the report: claims it
 * (`collatingAt`, or a claim older than STUCK_AFTER_MINUTES), has Ziki's AI
 * write the summary outside any transaction from severities and titles only,
 * then marks the check `done` with `postedAt`. True when this call posted it.
 */
export async function postReportIfComplete(db: EngineDb, checkId: string, now = new Date(), deps: EngineDeps = {}): Promise<boolean> {
  const [open, parts] = await Promise.all([
    db.securityCheckItem.count({ where: { checkId, kind: "check", status: { in: ["waiting", "checking"] } } }),
    db.securityCheckItem.count({ where: { checkId, kind: "check" } }),
  ]);
  if (open > 0 || parts === 0) return false;
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000);
  const { count } = await db.securityCheck.updateMany({
    where: { id: checkId, status: "checking", postedAt: null, ...scanPaymentWhere(), OR: [{ collatingAt: null }, { collatingAt: { lt: stuckBefore } }] },
    data: { collatingAt: now },
  });
  if (count !== 1) return false;

  const check = await db.securityCheck.findUnique({
    where: { id: checkId },
    select: {
      target: { select: { kind: true, value: true } },
      results: { select: { severity: true, title: true } },
      // On a rescan, the earlier findings still there count too; the fixed ones don't.
      rechecked: { where: { recheckState: "still_there" }, select: { severity: true, title: true } },
    },
  });
  if (!check) return false;
  const { summary } = await writeSummary(check.target, [...check.results, ...check.rechecked], { ai: deps.ai });

  const { count: posted } = await db.securityCheck.updateMany({
    where: { id: checkId, status: "checking", postedAt: null, collatingAt: now, ...scanPaymentWhere() },
    data: { status: "done", finishedAt: now, postedAt: now, summary },
  });
  return posted === 1;
}

/** Posts every finished report not posted yet, including ones whose summary run crashed. */
export async function postFinishedReports(db: EngineDb, now = new Date(), deps: EngineDeps = {}): Promise<number> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000);
  const ready = await db.securityCheck.findMany({
    where: {
      status: "checking",
      ...scanPaymentWhere(),
      postedAt: null,
      OR: [{ collatingAt: null }, { collatingAt: { lt: stuckBefore } }],
      items: { some: { kind: "check" }, none: { kind: "check", status: { in: ["waiting", "checking"] } } },
    },
    select: { id: true },
    take: 10,
  });
  let posted = 0;
  for (const { id } of ready) if (await postReportIfComplete(db, id, now, deps)) posted++;
  return posted;
}

// ---------------------------------------------------------------------------
// 6. Pay per finding, once the client unlocks it.

/**
 * Pays the finder of every unlocked, unpaid finding (#one-payment): what the
 * client paid to unlock it, less Ziki's fee, from Ziki's revenue into the
 * agent's owner's wallet, once (the source key and the conditional
 * `payoutReleasedAt` both guard it).
 */
export async function payUnlockedFindings(db: EngineDb, now = new Date()): Promise<number> {
  const due = await db.securityCheckResult.findMany({
    // Ziki's own security agent (the fallback) earns nothing.
    where: { unlockedAt: { not: null }, payoutReleasedAt: null, item: { agentId: { not: null }, agent: { username: { not: ZIKI_SECURITY_AGENT_USERNAME } } } },
    select: {
      id: true,
      severity: true,
      priceCoins: true,
      check: { select: { organisationId: true } },
      item: { select: { agentId: true, agent: { select: { ownerUserId: true } } } },
    },
    take: 200,
  });
  let paid = 0;
  for (const result of due) {
    const agentId = result.item.agentId;
    const owner = result.item.agent?.ownerUserId;
    if (!agentId || !owner) continue;
    const done = await db.$transaction(async (tx) => {
      const { count } = await tx.securityCheckResult.updateMany({
        where: { id: result.id, payoutReleasedAt: null },
        data: { payoutReleasedAt: now },
      });
      if (count !== 1) return false;
      const price = result.priceCoins ?? SEVERITY_PRICE[result.severity];
      const share = price - feeOf(price);
      if (share > 0) {
        const key = findingSourceKey(result.id);
        await appendRows(tx, [
          { account: "revenue", kind: "release", payoutRole: "security_finder", agentId, amount: -share, sourceKey: `${key}:revenue` },
          { account: "wallet", userId: owner, kind: "release", payoutRole: "security_finder", agentId, amount: share, sourceKey: `${key}:wallet` },
        ]);
      }
      return true;
    });
    if (done) paid++;
  }
  return paid;
}

// ---------------------------------------------------------------------------
// The sweep, run by the platform cron (every minute). It recovers and catches up;
// the fast path is startCheck after proof and agents polling for work.

export type SecurityCheckSweep = { started: number; reclaimed: number; skipped: number; posted: number; paid: number };

export async function sweepSecurityChecks(db: EngineDb, now = new Date(), deps: EngineDeps = {}): Promise<SecurityCheckSweep> {
  const started = await startWaitingChecks(db, now, deps);
  const { reclaimed, skipped } = await reclaimStaleJobs(db, now);
  // No handing out here: parts go only to agents that ask (listAgentJobs), and Ziki's own agent takes
  // any still waiting after the fallback time (fallback.ts).
  const posted = await postFinishedReports(db, now, deps);
  const paid = await payUnlockedFindings(db, now);
  return { started, reclaimed, skipped, posted, paid };
}
