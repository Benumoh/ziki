import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CODE_SCAN_PRICE_ZIKS, freeScanAllowed, freeScanMonthStart, ownershipProofRequired } from "@/lib/security-checks";
import { newOwnershipToken, refusedMessage } from "./entry";
import { parseSecurityTarget } from "./target";

/**
 * Connect code (#security-code-scan; 18 Nov call, Mark: "connect to their code… without asking them for money yet"):
 * from a website scan's Code scan page, the person names their code, for free. The repo becomes its own target with
 * an unpaid scan linked to the website's (`codeScanForId`), and Ziki's free quick check of the repo is saved on it
 * (the caller runs it), so its page shows what was found before anything is paid. Its second page asks for
 * CODE_SCAN_PRICE_ZIKS before agents read the code (lib/security-checks/deeper-scan.ts). Two ways to name it
 * (Chloe's two options):
 * - **Read-only:** a public GitHub repo's link. Agents read it without signing in.
 * - **Connect GitHub and fix for me:** one of the workspace's projects with GitHub connected (`repoUrl` and the
 *   GitHub App). Its repo is scanned, and the scan's findings go to that project (`SecurityCheck.projectId`), where
 *   agents fix them in pull requests through the existing Move to your app flow.
 * A website scan gets one code scan (`codeScanForId` is unique), so a double click connects once. It never pays.
 */

export type CodeScanSource = { kind: "link"; repo: string } | { kind: "project"; projectId: string };

export type CodeScanOutcome =
  | { ok: true; checkId: string }
  | { ok: false; reason: "not_found" | "bad_repo" | "no_github" | "already_connected" | "unreachable" | "limit"; error: string; checkId?: string };

/** A project the person can send the code scan to: GitHub connected. */
export type CodeProject = { id: string; name: string; repo: string };

/** The repo a source names, before anything is stored, so the caller can run the free check on it first. */
export type NamedRepo = { repo: string; projectId: string | null };

const NOT_FOUND = "That scan isn't in your scans.";
const ALREADY = "This site's code is already connected.";
const BAD_REPO = "Paste a GitHub repo, like github.com/your-team/your-repo.";
const NO_GITHUB = "That project doesn't have GitHub connected. Connect it in the project's settings first.";

/** The person's own website scan, not removed, with its code scan if it has one. */
export async function siteScan(organisationId: string, userId: string, checkId: string) {
  return prisma.securityCheck.findFirst({
    where: { id: checkId, organisationId, requestedById: userId, status: { not: "cancelled" }, target: { kind: { not: "repo" } } },
    select: { id: true, target: { select: { value: true } }, codeScan: { select: { id: true } } },
  });
}

/** `https://github.com/acme/web.git` → `acme/web`; null when it isn't a GitHub repo. */
function repoOf(input: string): string | null {
  const parsed = parseSecurityTarget(input);
  return parsed.ok && parsed.target.kind === "repo" ? parsed.target.value : null;
}

/** The workspace's projects with GitHub connected, for "Connect GitHub and fix for me". */
export async function githubProjects(organisationId: string): Promise<CodeProject[]> {
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

/** Which repo the person named: a pasted link, or a project of theirs with GitHub connected. Stores nothing. */
export async function nameRepo(organisationId: string, source: CodeScanSource): Promise<NamedRepo | Extract<CodeScanOutcome, { ok: false }>> {
  if (source.kind === "link") {
    const repo = typeof source.repo === "string" ? repoOf(source.repo.trim()) : null;
    return repo ? { repo, projectId: null } : { ok: false, reason: "bad_repo", error: BAD_REPO };
  }
  const project = (await githubProjects(organisationId)).find((candidate) => candidate.id === source.projectId);
  return project ? { repo: project.repo, projectId: project.id } : { ok: false, reason: "no_github", error: NO_GITHUB };
}

/**
 * Connecting is a free scan, so it counts towards the same free-scan limits as adding a site on the Security page
 * (entry.ts `addTargetAndCheck`; 23 Nov, Sheyi): one free scan per repo, and the workspace's monthly allowance. Null
 * when it may go ahead. Checked before Ziki reads the repo.
 */
export async function connectRefusal(organisationId: string, repo: string, now = new Date()): Promise<string | null> {
  const [targetFreeScans, workspaceFreeScansThisMonth] = await Promise.all([
    prisma.securityCheck.count({ where: { organisationId, previousCheckId: null, target: { kind: "repo", value: repo } } }),
    prisma.securityCheck.count({ where: { organisationId, previousCheckId: null, createdAt: { gte: freeScanMonthStart(now) } } }),
  ]);
  const answer = freeScanAllowed({ targetFreeScans, workspaceFreeScansThisMonth });
  return answer.allowed ? null : refusedMessage(answer.reason, repo, now);
}

/**
 * Connects the code, free: stores the repo (once per workspace, like any target) and opens its unpaid scan, linked
 * to the website's. A second click, or another tab, finds the first one (`codeScanForId` is unique).
 */
export async function connectCode(organisationId: string, userId: string, checkId: string, named: NamedRepo): Promise<CodeScanOutcome> {
  const scan = await siteScan(organisationId, userId, checkId);
  if (!scan) return { ok: false, reason: "not_found", error: NOT_FOUND };
  if (scan.codeScan) return { ok: false, reason: "already_connected", error: ALREADY, checkId: scan.codeScan.id };
  try {
    return await prisma.$transaction(async (tx): Promise<CodeScanOutcome> => {
      const target = await tx.securityTarget.upsert({
        where: { organisationId_kind_value: { organisationId, kind: "repo", value: named.repo } },
        update: {},
        create: { organisationId, kind: "repo", value: named.repo, input: `github.com/${named.repo}`, addedById: userId, ownershipToken: newOwnershipToken() },
        select: { id: true, verifiedAt: true },
      });
      const check = await tx.securityCheck.create({
        data: {
          organisationId,
          targetId: target.id,
          requestedById: userId,
          projectId: named.projectId,
          codeScanForId: scan.id,
          free: false,
          // Not paid: its own page asks for this before agents start, and creating the row never starts them.
          priceCoins: CODE_SCAN_PRICE_ZIKS,
          // No proof step while it's switched off (14 Nov plan); with it on, the repo is proven first.
          status: target.verifiedAt !== null || !ownershipProofRequired() ? "queued" : "awaiting_ownership",
        },
        select: { id: true },
      });
      return { ok: true, checkId: check.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.securityCheck.findFirst({ where: { codeScanForId: scan.id }, select: { id: true } });
      return { ok: false, reason: "already_connected", error: ALREADY, checkId: existing?.id };
    }
    throw error;
  }
}
