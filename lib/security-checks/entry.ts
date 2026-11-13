import { randomBytes } from "node:crypto";
import { Prisma, type SecurityCheckStatus, type SecurityTargetKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PreviewSummary } from "./preview-summary";
import { SECURITY_CHECK_PRICE_COINS, FINISHED_CHECK_STATUSES, FREE_SCANS_PER_WORKSPACE_PER_MONTH, freeScanAllowed, freeScanMonthStart } from "@/lib/security-checks";
import type { ParsedTarget } from "@/lib/security-checks/target";

/**
 * Adding something to check (#security-checks, part 1): store the target once
 * per workspace and open a check for it. Ownership (part 2), agents (part 3)
 * and the report (part 4) take it from there through the database.
 */

export type AddedCheck = {
  targetId: string;
  checkId: string;
  /** Ownership was already proven for this target, so its free scan starts straight away. */
  verified: boolean;
  /** An unfinished check for this target already existed and was reused. */
  reused: boolean;
};

/** No free scan left (#security-checks, plan C1): why, and the site's last check if it had one. */
export type RefusedCheck = {
  refused: "target_used" | "workspace_limit";
  targetId: string;
  lastCheckId: string | null;
};

/** A fresh secret for the DNS TXT record or homepage tag. */
export function newOwnershipToken(): string {
  return `ziki-verify-${randomBytes(16).toString("hex")}`;
}

/**
 * Store the target (or reuse the workspace's existing one) and open a free
 * check (#security-checks, plan C1). The person's own unfinished check on that
 * target is reused rather than opening a second one. Checks are per person:
 * someone else in the workspace gets their own.
 *
 * Every check is free, within limits: a site gets one free scan, and a
 * workspace gets FREE_SCANS_PER_WORKSPACE_PER_MONTH a month. Past either, no
 * check is opened and the client is told why. Clients pay per finding, when
 * they unlock its fix.
 */
export async function addTargetAndCheck(
  organisationId: string,
  userId: string,
  target: ParsedTarget,
  now = new Date(),
): Promise<AddedCheck | RefusedCheck> {
  const stored = await findOrCreateTarget(organisationId, userId, target);
  const verified = stored.verifiedAt !== null;

  const open = await prisma.securityCheck.findFirst({
    where: { targetId: stored.id, organisationId, requestedById: userId, status: { notIn: [...FINISHED_CHECK_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (open) return { targetId: stored.id, checkId: open.id, verified, reused: true };

  const [targetFreeScans, workspaceFreeScansThisMonth] = await Promise.all([
    prisma.securityCheck.count({ where: { targetId: stored.id, free: true } }),
    prisma.securityCheck.count({ where: { organisationId, free: true, createdAt: { gte: freeScanMonthStart(now) } } }),
  ]);
  const answer = freeScanAllowed({ targetFreeScans, workspaceFreeScansThisMonth });
  if (!answer.allowed) {
    const last = await prisma.securityCheck.findFirst({
      where: { targetId: stored.id, organisationId, requestedById: userId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return { refused: answer.reason, targetId: stored.id, lastCheckId: last?.id ?? null };
  }

  const check = await prisma.securityCheck.create({
    data: {
      organisationId,
      targetId: stored.id,
      requestedById: userId,
      free: true,
      priceCoins: SECURITY_CHECK_PRICE_COINS,
      // A target proven once never asks again: its new checks are ready for agents.
      status: verified ? "queued" : "awaiting_ownership",
    },
    select: { id: true },
  });
  return { targetId: stored.id, checkId: check.id, verified, reused: false };
}

/** What to tell the client when there's no free scan left, in plain words. */
export function refusedMessage(refused: RefusedCheck["refused"], site: string, now = new Date()): string {
  if (refused === "target_used") return `${site} has already been scanned. Open its report to unlock fixes.`;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const day = next.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return `You've used this month's ${FREE_SCANS_PER_WORKSPACE_PER_MONTH} scans. More start on ${day}.`;
}

async function findOrCreateTarget(organisationId: string, userId: string, target: ParsedTarget) {
  const where = { organisationId_kind_value: { organisationId, kind: target.kind, value: target.value } };
  const select = { id: true, verifiedAt: true } as const;
  const existing = await prisma.securityTarget.findUnique({ where, select });
  if (existing) return existing;
  try {
    return await prisma.securityTarget.create({
      data: {
        organisationId,
        kind: target.kind,
        value: target.value,
        input: target.input,
        addedById: userId,
        ownershipToken: newOwnershipToken(),
      },
      select,
    });
  } catch (error) {
    // Two people added the same target at once: use the one that won.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.securityTarget.findUnique({ where, select });
      if (winner) return winner;
    }
    throw error;
  }
}

/** Keep the quick scan's counts with the asset (#security-checks), so the client can see it again later. Never what was found. */
export async function saveQuickScan(targetId: string, summary: PreviewSummary, now = new Date()): Promise<void> {
  await prisma.securityTarget.update({ where: { id: targetId }, data: { previewSummary: summary, previewAt: now } });
}

/** Where the client goes next for a new check: show it's theirs, or, if already proven, back to Assets where its free scan starts. */
export function nextStepPath(check: { targetId: string; checkId: string; verified: boolean }): string {
  return check.verified ? `/security?check=${encodeURIComponent(check.checkId)}&added=1` : `/security/targets/${check.targetId}/verify`;
}

export type WorkspaceCheckRow = {
  id: string;
  targetId: string;
  kind: SecurityTargetKind;
  value: string;
  status: SecurityCheckStatus;
  verified: boolean;
  /** The report has been posted (isReportPosted), so findings can be unlocked. */
  posted: boolean;
  /** Findings reported, and how many of them the client has unlocked. */
  findings: number;
  unlocked: number;
  createdAt: Date;
};

/** Where a site is, for the Assets sidebar: waiting for proof, being checked, or its report is ready to fix. */
export type SiteStage = "prove" | "checking" | "fix" | "cancelled";
export const SITE_FILTERS = ["all", "prove", "checking", "fix"] as const;
export type SiteFilter = (typeof SITE_FILTERS)[number];

export function siteStage(check: Pick<WorkspaceCheckRow, "status" | "verified" | "posted">): SiteStage {
  if (check.status === "cancelled") return "cancelled";
  if (check.status === "awaiting_ownership" && !check.verified) return "prove";
  return check.posted ? "fix" : "checking";
}

export function parseSiteFilter(value: unknown): SiteFilter {
  return SITE_FILTERS.includes(value as SiteFilter) ? (value as SiteFilter) : "all";
}

/** The workspace's checks, newest first: the returning user's list on the Security page. */
export async function listWorkspaceChecks(organisationId: string, userId: string, take = 20): Promise<WorkspaceCheckRow[]> {
  const rows = await prisma.securityCheck.findMany({
    // Only the checks this person asked for: others in the workspace don't see them.
    where: { organisationId, requestedById: userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      status: true,
      postedAt: true,
      createdAt: true,
      target: { select: { id: true, kind: true, value: true, verifiedAt: true } },
      results: { select: { unlockedAt: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    targetId: row.target.id,
    kind: row.target.kind,
    value: row.target.value,
    status: row.status,
    verified: row.target.verifiedAt !== null,
    posted: row.postedAt !== null,
    findings: row.results.length,
    unlocked: row.results.filter((result) => result.unlockedAt !== null).length,
    createdAt: row.createdAt,
  }));
}

/** A saved quick scan, read back from the database: anything that isn't one comes back as null. */
export function readQuickScan(value: unknown): PreviewSummary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as Partial<PreviewSummary>;
  if (typeof summary.target !== "string" || typeof summary.total !== "number" || !Array.isArray(summary.areas) || !summary.counts || !summary.risk) return null;
  return summary as PreviewSummary;
}
