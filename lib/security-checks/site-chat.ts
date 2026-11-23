import type { Prisma, SecurityCheckStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHECK_STATUS_LABEL } from "@/lib/security-checks";
import type { PreviewSummary } from "./preview-summary";
import { readQuickScan } from "./entry";
import { partsProgress } from "./report";
import { targetAddress } from "./target";

/**
 * The saved chat under one site's scan on Security (#security-checks, 14 Nov
 * call): one per site per person, kept in the database so it carries on after
 * a refresh or on another device. The history sent to Claude is read here,
 * on the server, never taken from the browser.
 */

/** Most messages loaded and sent to Claude; older ones stay saved but aren't sent. */
export const SITE_CHAT_HISTORY = 20;
/** Longest message a person may send. */
export const SITE_CHAT_MESSAGE_MAX = 600;

export type SiteChatMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: Date };

/** This person's chat about one site, oldest first: the last `take` messages. */
export async function loadSiteChat(organisationId: string, userId: string, targetId: string, take = SITE_CHAT_HISTORY): Promise<SiteChatMessage[]> {
  const rows = await prisma.securityChatMessage.findMany({
    where: { organisationId, userId, targetId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, role: true, text: true, createdAt: true },
  });
  return rows.reverse().map((row) => ({ ...row, role: row.role === "assistant" ? "assistant" : "user" }));
}

/** Whether this person already has a chat about this site (a site removed and added again keeps its chat). */
export async function hasSiteChat(organisationId: string, userId: string, targetId: string): Promise<boolean> {
  return Boolean(await prisma.securityChatMessage.findFirst({ where: { organisationId, userId, targetId }, select: { id: true } }));
}

export async function saveSiteMessage(organisationId: string, userId: string, targetId: string, role: "user" | "assistant", text: string): Promise<void> {
  await prisma.securityChatMessage.create({ data: { organisationId, userId, targetId, role, text: text.slice(0, 2000) } });
}

/** Where a scan is now: its status and how many of its parts are finished. */
export type ScanProgressNote = { status: SecurityCheckStatus; done: number; total: number };

/** What the report side says: ready with its counts, or still being checked (and where it's got to). */
type ReportNote = { posted: boolean; findings: number; unlocked: number; progress?: ScanProgressNote };

function quickCounts(quick: PreviewSummary): string {
  const counts = (["critical", "high", "medium", "low"] as const).filter((s) => quick.counts[s]).map((s) => `${quick.counts[s]} ${s}`).join(", ");
  return quick.total ? `${quick.total} problems (${counts})` : "nothing found";
}

function reportLine(report: ReportNote): string {
  if (report.posted) return `Agents' report: ready, ${report.findings} findings, ${report.unlocked} unlocked.`;
  const progress = report.progress;
  if (!progress) return "Agents' report: agents are still checking it.";
  const parts = progress.total ? `, ${progress.done} of ${progress.total} parts done` : "";
  return `Agents' report: not ready yet. Status: ${CHECK_STATUS_LABEL[progress.status]}${parts}.`;
}

/**
 * What Claude is told about the site: the quick scan's counts and the titles of
 * what it found (what any browser can see, already shown on the page), where
 * the agents have got to, and the report's counts. Never a finding's detail or fix.
 */
export function siteContextNote(site: string, quick: PreviewSummary | null, report: ReportNote): string {
  const lines = [`Site: ${site}.`];
  if (quick) {
    lines.push(`Quick browser scan: ${quickCounts(quick)}.`);
    for (const row of quick.rows ?? []) if (row.title) lines.push(`- ${row.severity}: ${row.title} (${row.label})`);
  } else {
    lines.push("No quick browser scan for this one.");
  }
  lines.push(reportLine(report));
  return lines.join("\n");
}

const SCAN_SELECT = {
  status: true,
  postedAt: true,
  target: { select: { id: true, kind: true, value: true, previewSummary: true } },
  results: { select: { unlockedAt: true } },
  items: { select: { status: true } },
} satisfies Prisma.SecurityCheckSelect;

function reportOf(check: Prisma.SecurityCheckGetPayload<{ select: typeof SCAN_SELECT }>): ReportNote {
  const { done, total } = partsProgress(check.items);
  return {
    posted: check.postedAt !== null,
    findings: check.results.length,
    unlocked: check.results.filter((r) => r.unlockedAt !== null).length,
    progress: { status: check.status, done, total },
  };
}

/** One of this person's scans, with what the chat needs: its site, quick scan and report. Null if not theirs. */
export async function siteChatScan(organisationId: string, userId: string, checkId: string) {
  const check = await prisma.securityCheck.findFirst({ where: { id: checkId, organisationId, requestedById: userId }, select: SCAN_SELECT });
  if (!check) return null;
  return {
    targetId: check.target.id,
    site: targetAddress(check.target),
    quick: readQuickScan(check.target.previewSummary),
    report: reportOf(check),
  };
}

/** Most of a person's scans the Security chat is told about, newest first. */
export const CHAT_SCANS_MAX = 10;

/**
 * What the Security chat is told about this person's own scans in this
 * workspace, so it can answer "what's happening with my site?" (15 Nov call):
 * one line per scan with the same facts as a site's chat, counts only. Empty
 * when they have none.
 */
export async function scansContextNote(organisationId: string, userId: string): Promise<string> {
  const checks = await prisma.securityCheck.findMany({
    where: { organisationId, requestedById: userId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    take: CHAT_SCANS_MAX,
    select: SCAN_SELECT,
  });
  return checks
    .map((check) => {
      const quick = readQuickScan(check.target.previewSummary);
      const quickLine = quick ? `Quick browser scan: ${quickCounts(quick)}.` : "No quick browser scan.";
      return `- ${targetAddress(check.target)}: ${quickLine} ${reportLine(reportOf(check))}`;
    })
    .join("\n");
}

