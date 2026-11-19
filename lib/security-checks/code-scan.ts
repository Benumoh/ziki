import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendRows, CoinError, lockUser, walletBalance } from "@/lib/coins/ledger";
import { assertCanSpendOnSecurity, loanState } from "@/lib/coins/loan";
import { CODE_SCAN_PRICE_ZIKS, ownershipProofRequired } from "@/lib/security-checks";
import { newOwnershipToken } from "./entry";
import { parseSecurityTarget } from "./target";

/**
 * Connect code (#security-code-scan, 18 Nov): from a website scan's Code scan step, the person names their code and
 * pays CODE_SCAN_PRICE_ZIKS; the repo becomes its own target with a paid scan, and agents start reading it at once.
 * Two ways to name it (Chloe's Connect code window):
 * - **Read-only:** a public GitHub repo's link. Agents read it without signing in.
 * - **Connect GitHub and fix for me:** one of the workspace's projects with GitHub connected (`repoUrl` and the
 *   GitHub App). Its repo is scanned, and the scan's findings go to that project (`SecurityCheck.projectId`), where
 *   agents fix them in pull requests through the existing Move to your app flow.
 * A website scan gets one code scan (`codeScanForId` is unique), so a double click pays once. Paying and opening the
 * scan happen in one transaction. It never pays by itself.
 */

export type CodeScanSource = { kind: "link"; repo: string } | { kind: "project"; projectId: string };

export type CodeScanFailure =
  | { ok: false; reason: "not_found" | "bad_repo" | "no_github" | "already_started"; error: string; checkId?: string }
  | { ok: false; reason: "insufficient_ziks"; error: string; needed: number; balance: number; canBorrow: boolean };

export type CodeScanOutcome = { ok: true; checkId: string } | CodeScanFailure;

/** A project the person can send the code scan to: GitHub connected. */
export type CodeProject = { id: string; name: string; repo: string };

export type CodeScanQuote =
  | { ok: true; site: string; price: number; balance: number; canBorrow: boolean; projects: CodeProject[] }
  | { ok: false; reason: "not_found" | "already_started"; error: string; checkId?: string };

const NOT_FOUND = "That scan isn't in your scans.";
const ALREADY = "This site's code is already being scanned.";
const BAD_REPO = "Paste a GitHub repo, like github.com/your-team/your-repo.";
const NO_GITHUB = "That project doesn't have GitHub connected. Connect it in the project's settings first.";

/** The person's own website scan, not removed, with its code scan if it has one. */
async function siteScan(organisationId: string, userId: string, checkId: string) {
  return prisma.securityCheck.findFirst({
    where: { id: checkId, organisationId, requestedById: userId, status: { not: "cancelled" } },
    select: { id: true, target: { select: { value: true } }, codeScan: { select: { id: true } } },
  });
}

/** `https://github.com/acme/web.git` → `acme/web`; null when it isn't a GitHub repo. */
function repoOf(input: string): string | null {
  const parsed = parseSecurityTarget(input);
  return parsed.ok && parsed.target.kind === "repo" ? parsed.target.value : null;
}

/** The workspace's projects with GitHub connected, for "Connect GitHub and fix for me". */
async function githubProjects(organisationId: string): Promise<CodeProject[]> {
  const projects = await prisma.project.findMany({
    where: { organisationId, archivedAt: null, githubInstallationId: { not: null }, repoUrl: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, repoUrl: true },
  });
  return projects.flatMap((project) => {
    const repo = project.repoUrl ? repoOf(project.repoUrl) : null;
    return repo ? [{ id: project.id, name: project.name, repo }] : [];
  });
}

/** What the Connect code window shows: the price, the wallet, and the projects with GitHub. Charges nothing. */
export async function codeScanQuote(organisationId: string, userId: string, checkId: string): Promise<CodeScanQuote> {
  const scan = await siteScan(organisationId, userId, checkId);
  if (!scan) return { ok: false, reason: "not_found", error: NOT_FOUND };
  if (scan.codeScan) return { ok: false, reason: "already_started", error: ALREADY, checkId: scan.codeScan.id };
  const [balance, loan, projects] = await Promise.all([walletBalance(prisma, userId), loanState(prisma, userId), githubProjects(organisationId)]);
  return { ok: true, site: scan.target.value, price: CODE_SCAN_PRICE_ZIKS, balance, canBorrow: loan.canBorrow, projects };
}

/**
 * Pays CODE_SCAN_PRICE_ZIKS and opens the repo's paid scan, in one transaction: nobody pays without the scan, and a
 * second click finds the first one (`codeScanForId` is unique). The caller starts it (`kickCheck`) after answering.
 */
export async function startCodeScan(organisationId: string, userId: string, checkId: string, source: CodeScanSource, now = new Date()): Promise<CodeScanOutcome> {
  const scan = await siteScan(organisationId, userId, checkId);
  if (!scan) return { ok: false, reason: "not_found", error: NOT_FOUND };
  if (scan.codeScan) return { ok: false, reason: "already_started", error: ALREADY, checkId: scan.codeScan.id };

  let repo: string | null = null;
  let projectId: string | null = null;
  if (source.kind === "link") {
    repo = typeof source.repo === "string" ? repoOf(source.repo.trim()) : null;
    if (!repo) return { ok: false, reason: "bad_repo", error: BAD_REPO };
  } else {
    const project = (await githubProjects(organisationId)).find((candidate) => candidate.id === source.projectId);
    if (!project) return { ok: false, reason: "no_github", error: NO_GITHUB };
    repo = project.repo;
    projectId = project.id;
  }

  try {
    return await prisma.$transaction(async (tx): Promise<CodeScanOutcome> => {
      await lockUser(tx, userId);
      try {
        // Security may use a borrowed overdraft (lib/coins/loan.ts).
        await assertCanSpendOnSecurity(tx, userId, CODE_SCAN_PRICE_ZIKS);
      } catch (error) {
        if (error instanceof CoinError && error.code === "insufficient_ziks") {
          const [balance, loan] = await Promise.all([walletBalance(tx, userId), loanState(tx, userId)]);
          return { ok: false, reason: "insufficient_ziks", error: `The code scan costs ${CODE_SCAN_PRICE_ZIKS} Ziks and you have ${balance}.`, needed: CODE_SCAN_PRICE_ZIKS, balance, canBorrow: loan.canBorrow };
        }
        throw error;
      }
      // The repo is stored once per workspace, like any target the person adds.
      const target = await tx.securityTarget.upsert({
        where: { organisationId_kind_value: { organisationId, kind: "repo", value: repo! } },
        update: {},
        create: { organisationId, kind: "repo", value: repo!, input: `github.com/${repo}`, addedById: userId, ownershipToken: newOwnershipToken() },
        select: { id: true, verifiedAt: true },
      });
      const check = await tx.securityCheck.create({
        data: {
          organisationId,
          targetId: target.id,
          requestedById: userId,
          projectId,
          codeScanForId: scan.id,
          free: false,
          priceCoins: CODE_SCAN_PRICE_ZIKS,
          paidAt: now,
          // No proof step while it's switched off (14 Nov plan); with it on, the repo is proven first.
          status: target.verifiedAt !== null || !ownershipProofRequired() ? "queued" : "awaiting_ownership",
        },
        select: { id: true },
      });
      await appendRows(tx, [
        { account: "wallet", userId, kind: "check_payment", amount: -CODE_SCAN_PRICE_ZIKS, sourceKey: `code-scan:${check.id}:wallet` },
        { account: "revenue", kind: "check_payment", amount: CODE_SCAN_PRICE_ZIKS, sourceKey: `code-scan:${check.id}:revenue` },
      ]);
      return { ok: true, checkId: check.id };
    });
  } catch (error) {
    // A second click (or another tab) started it first: nothing was charged this time.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.securityCheck.findFirst({ where: { codeScanForId: scan.id }, select: { id: true } });
      return { ok: false, reason: "already_started", error: ALREADY, checkId: existing?.id };
    }
    throw error;
  }
}
