"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { OWNERS_ONLY_MESSAGE } from "@/lib/security-checks";
import { connectCode, connectRefusal, nameRepo, type CodeScanOutcome, type CodeScanSource } from "@/lib/security-checks/code-scan";
import { prisma } from "@/lib/prisma";
import { saveCodeFindings } from "@/lib/security-checks/code-findings";
import { saveQuickScan } from "@/lib/security-checks/entry";
import { previewScan } from "@/lib/security-checks/preview";
import { summarisePreview } from "@/lib/security-checks/preview-summary";
import { repoAccessFor } from "@/lib/security-checks/repo-reader";
import { withSiteAddress } from "@/lib/security-checks/site-address";
import { targetAddress } from "@/lib/security-checks/target";

/**
 * Connect code (#security-code-scan; 18 Nov call, Mark: connect first, pay later): the website scan's Code scan page.
 * Only workspace owners and admins, only on their own scans, as for the deeper scan
 * (app/actions/security-deeper-scan.ts). Connecting charges nothing: Ziki reads the repo for free at once and saves
 * what it found, and the code scan's own page then asks for its price before agents start. The browser sends only
 * the scan and how the code is named.
 */
async function access() {
  const user = await requireUser();
  const workspace = await currentOrganisationAccess(user.id, user.role);
  if (!workspace.organisationId || !workspace.admin) return null;
  return { userId: user.id, organisationId: workspace.organisationId };
}

const ID = /^[a-zA-Z0-9_-]{1,100}$/;

/** Connect the code and run Ziki's free check of it. Never pays. */
export async function connectCodeScan(checkId: string, source: CodeScanSource): Promise<CodeScanOutcome> {
  if (typeof checkId !== "string" || !ID.test(checkId)) return { ok: false, reason: "not_found", error: "That scan isn't in your scans." };
  const clean: CodeScanSource | null =
    source && source.kind === "link" && typeof source.repo === "string"
      ? { kind: "link", repo: source.repo.slice(0, 300) }
      : source && source.kind === "project" && typeof source.projectId === "string" && ID.test(source.projectId)
        ? { kind: "project", projectId: source.projectId }
        : null;
  if (!clean) return { ok: false, reason: "bad_repo", error: "Paste a GitHub repo, or pick a project." };
  const who = await access();
  if (!who) return { ok: false, reason: "not_found", error: OWNERS_ONLY_MESSAGE };

  const named = await nameRepo(who.organisationId, clean);
  if ("ok" in named) return named;
  // A free scan like any other: within the free-scan limits (when they're on).
  const refused = await connectRefusal(who.organisationId, named.repo);
  if (refused) return { ok: false, reason: "limit", error: refused };
  // Read the repo first (a private one through the project's GitHub App). A repo Ziki can't read now isn't connected:
  // the free check is what connecting gives, and the code scan's price is asked for only once it's shown.
  const target = { kind: "repo" as const, value: named.repo };
  const result = await previewScan(targetAddress(target), { visitor: `user:${who.userId}`, repoAccess: await repoAccessFor(who.organisationId, target) });
  if (!result.ok) return { ok: false, reason: "unreachable", error: result.reason };

  const outcome = await connectCode(who.organisationId, who.userId, checkId, named);
  if (outcome.ok) {
    // What the free check found: the code scan's quick scan, shown on its page before anything is paid.
    const check = await prisma.securityCheck.findUnique({ where: { id: outcome.checkId }, select: { targetId: true } });
    if (check) {
      await saveQuickScan(check.targetId, await withSiteAddress(summarisePreview(result)));
      await saveCodeFindings(prisma, outcome.checkId, result);
    }
  }
  if (outcome.ok) {
    revalidatePath("/security");
    revalidatePath(`/security/checks/${checkId}`);
  }
  return outcome;
}
