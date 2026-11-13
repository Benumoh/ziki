import "server-only";
import type {
  IdeaStatus,
  Prisma,
  SecurityCheckItemStatus,
  SecurityCheckStatus,
  SecuritySeverity,
  SecurityTargetKind,
  Status,
  Substatus,
} from "@prisma/client";
import { issuePath } from "@/lib/issue-ref";
import { prisma } from "@/lib/prisma";
import { refOf } from "@/lib/project-paths";
import { safeHref } from "@/lib/rich-text";
import { SEVERITY_PRICE, isReportPosted } from "@/lib/security-checks";
import { SECURITY_SEVERITIES } from "@/lib/security-severity";

/**
 * What a client may see of one security check (#security-checks, 12 Nov plan
 * part S): the page and the PDF both read the report through
 * `loadCheckReport`, so they always show the same thing.
 *
 * - Until Ziki has posted the report (`isReportPosted`), no result is read at
 *   all: the client sees progress only.
 * - Once posted, every finding shows its severity, the part that found it (its
 *   vague title) and its price. Only an unlocked finding (`unlockedAt`) has its
 *   title, description and how to fix read from the database, so a locked
 *   finding's text never reaches the page, the HTML or the PDF.
 */

export type SeverityCounts = Record<SecuritySeverity, number>;

/** One part of the check, as the client sees it on the progress screen. */
export type ReportPart = { id: string; title: string; status: SecurityCheckItemStatus };

/** Who found a problem, enough to draw its Ziki avatar. */
export type ReportAgent = { id: string; name: string; avatar: string | null };

type FindingCommon = {
  id: string;
  severity: SecuritySeverity;
  /** The vague title: the part of the check that found it ("Login form"). */
  area: string;
  /** What unlocking it costs, in coins. */
  priceCoins: number;
  /** The agent that found it; null if it has since been removed. */
  agent: ReportAgent | null;
};

/** A finding not unlocked yet: no title, description or fix, by construction. */
export type LockedFinding = FindingCommon & { locked: true };

/** An unlocked finding, in full. */
export type UnlockedFinding = FindingCommon & {
  locked: false;
  title: string;
  description: string;
  howToFix: string;
  /** Where its fix is, once it was sent with Fix on Ziki and became a private finding; null until then. */
  fix: ResultFix | null;
};

export type ReportFinding = LockedFinding | UnlockedFinding;

/** Where a sent problem's fix stands. "fixing" until its issue is Live ("fixed"), or closed or rejected ("closed"). */
export type FixBucket = "fixing" | "fixed" | "closed";

/** A sent problem's fix, read from its private finding (#security-findings): what the finding's own page shows. */
export type ResultFix = {
  findingHref: string;
  bucket: FixBucket;
  /** The issue's step (Ziki's status words and colours); null before the idea becomes an issue. */
  substatus: Substatus | null;
  /** The stage in words while there is no issue: "Reported", "Waiting for verdicts", "Rejected", "Archived". */
  stageLabel: string | null;
  issue: { number: number; href: string } | null;
  pullRequestHref: string | null;
  /** The latest independent re-check (Independent verification on the finding's page). */
  recheck: { passed: boolean; by: string | null } | null;
};

type FindingRow = {
  id: string;
  project: { slug: string; organisation: { slug: string } };
  bug: { number: number; status: Status; substatus: Substatus; pullRequestUrl: string | null; isDeleted: boolean } | null;
  idea: { status: IdeaStatus; isDeleted: boolean } | null;
  verifications: { passed: boolean; reviewer: { name: string | null } | null }[];
};

/** A finding's fix, as its own page and the Findings dashboard see it. Deleted ideas and issues don't count. */
export function fixOf(finding: FindingRow | null): ResultFix | null {
  if (!finding) return null;
  const bug = finding.bug && !finding.bug.isDeleted ? finding.bug : null;
  const idea = finding.idea && !finding.idea.isDeleted ? finding.idea : null;
  const latest = finding.verifications[0];
  const bucket: FixBucket =
    bug?.status === "resolved"
      ? "fixed"
      : bug?.status === "closed" || (!bug && (idea?.status === "rejected" || idea?.status === "archived"))
        ? "closed"
        : "fixing";
  const stageLabel = bug
    ? null
    : idea?.status === "open"
      ? "Waiting for verdicts"
      : idea?.status === "rejected"
        ? "Rejected"
        : idea?.status === "archived"
          ? "Archived"
          : "Reported";
  return {
    findingHref: `/security/findings/${finding.id}`,
    bucket,
    substatus: bug?.substatus ?? null,
    stageLabel,
    issue: bug ? { number: bug.number, href: issuePath(refOf(finding.project), bug.number) } : null,
    pullRequestHref: bug?.pullRequestUrl ? safeHref(bug.pullRequestUrl) : null,
    recheck: latest ? { passed: latest.passed, by: latest.reviewer?.name ?? null } : null,
  };
}

const FINDING_OF_RESULT = {
  finding: {
    select: {
      id: true,
      project: { select: { slug: true, organisation: { select: { slug: true } } } },
      bug: { select: { number: true, status: true, substatus: true, pullRequestUrl: true, isDeleted: true } },
      idea: { select: { status: true, isDeleted: true } },
      verifications: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { passed: true, reviewer: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.SecurityCheckResultSelect;

type ReportBase = {
  checkId: string;
  status: SecurityCheckStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** `value` is the tidy form ("settle.ng"); `input` is what the client typed. */
  target: { id: string; kind: SecurityTargetKind; value: string; input: string; verified: boolean };
  parts: ReportPart[];
  progress: { done: number; total: number; percent: number };
  /** How many different agents worked on the parts. */
  agentCount: number;
};

/** Before the report is posted: progress only, nothing about the results. */
export type UnpostedReport = ReportBase & { posted: false };

/** The posted report: Ziki's summary, then every finding worst first, locked or unlocked. */
export type PostedReport = ReportBase & {
  posted: true;
  /** Ziki AI's plain summary, kept general so it gives away no locked finding. */
  summary: string | null;
  findings: ReportFinding[];
  counts: SeverityCounts;
  total: number;
  /** Finished parts that found nothing, by title. */
  clearParts: string[];
};

export type CheckReport = UnpostedReport | PostedReport;

/** Lower is worse: critical first. */
function severityRank(severity: SecuritySeverity): number {
  return SECURITY_SEVERITIES.indexOf(severity);
}

/** Worst first, then the oldest, then by id so the order never wobbles. */
export function worstFirst<T extends { id: string; severity: SecuritySeverity; createdAt: Date }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function countBySeverity(rows: readonly { severity: SecuritySeverity }[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of rows) counts[row.severity] += 1;
  return counts;
}

/** Finished parts out of all parts. A skipped part counts as finished. */
export function partsProgress(parts: readonly { status: SecurityCheckItemStatus }[]): ReportBase["progress"] {
  const total = parts.length;
  const done = parts.filter((part) => part.status === "done" || part.status === "skipped").length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Parts an agent finished without finding anything. */
export function clearPartTitles(parts: readonly ReportPart[], results: readonly { itemId: string }[]): string[] {
  const withResults = new Set(results.map((result) => result.itemId));
  return parts.filter((part) => part.status === "done" && !withResults.has(part.id)).map((part) => part.title);
}

/** The locked findings of a report, and what unlocking all of them costs. */
export function lockedOf(report: PostedReport): { findings: LockedFinding[]; totalCoins: number } {
  const findings = report.findings.filter((finding): finding is LockedFinding => finding.locked);
  return { findings, totalCoins: findings.reduce((sum, finding) => sum + finding.priceCoins, 0) };
}

/**
 * The report for one check, or null when the check doesn't exist, belongs to
 * another workspace, or was asked for by someone else: each check is its
 * requester's alone, as on the pay page (#640). Callers answer "not found".
 */
export async function loadCheckReport(checkId: string, organisationId: string, userId: string): Promise<CheckReport | null> {
  const check = await prisma.securityCheck.findFirst({
    where: { id: checkId, organisationId, requestedById: userId },
    select: {
      id: true,
      status: true,
      postedAt: true,
      summary: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      target: { select: { id: true, kind: true, value: true, input: true, verifiedAt: true } },
      items: {
        where: { kind: "check" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, title: true, status: true, agentId: true },
      },
    },
  });
  if (!check) return null;

  const parts = check.items.map(({ id, title, status }) => ({ id, title, status }));
  const base: ReportBase = {
    checkId: check.id,
    status: check.status,
    createdAt: check.createdAt,
    startedAt: check.startedAt,
    finishedAt: check.finishedAt,
    target: {
      id: check.target.id,
      kind: check.target.kind,
      value: check.target.value,
      input: check.target.input,
      verified: check.target.verifiedAt !== null,
    },
    parts,
    progress: partsProgress(parts),
    agentCount: new Set(check.items.map((item) => item.agentId).filter(Boolean)).size,
  };

  // Not posted yet: progress only, so no result is read, not even a count.
  if (!isReportPosted(check)) return { ...base, posted: false };

  // Every finding: only what a locked one may show. No text at all.
  const rows = await prisma.securityCheckResult.findMany({
    where: { checkId: check.id },
    select: {
      id: true,
      itemId: true,
      severity: true,
      priceCoins: true,
      unlockedAt: true,
      createdAt: true,
      item: { select: { title: true, agent: { select: { id: true, name: true, avatar: true } } } },
    },
  });
  // The text, read only for findings the client has unlocked.
  const unlocked = rows.some((row) => row.unlockedAt !== null)
    ? await prisma.securityCheckResult.findMany({
        where: { checkId: check.id, unlockedAt: { not: null } },
        select: { id: true, title: true, description: true, howToFix: true, ...FINDING_OF_RESULT },
      })
    : [];
  const textById = new Map(unlocked.map((row) => [row.id, row]));

  return {
    ...base,
    posted: true,
    summary: check.summary,
    counts: countBySeverity(rows),
    total: rows.length,
    clearParts: clearPartTitles(parts, rows),
    findings: worstFirst(rows).map((row): ReportFinding => {
      const common = {
        id: row.id,
        severity: row.severity,
        area: row.item.title,
        priceCoins: row.priceCoins ?? SEVERITY_PRICE[row.severity],
        agent: row.item.agent ?? null,
      };
      const text = textById.get(row.id);
      return text
        ? { ...common, locked: false, title: text.title, description: text.description, howToFix: text.howToFix, fix: fixOf(text.finding) }
        : { ...common, locked: true };
    }),
  };
}
