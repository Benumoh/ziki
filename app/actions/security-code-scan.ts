"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { OWNERS_ONLY_MESSAGE } from "@/lib/security-checks";
import { codeScanQuote, startCodeScan, type CodeScanOutcome, type CodeScanQuote, type CodeScanSource } from "@/lib/security-checks/code-scan";
import { kickCheck } from "@/lib/security-checks/engine";
import { prisma } from "@/lib/prisma";

/**
 * Connect code (#security-code-scan, 18 Nov): the website scan's Code scan step. Only workspace owners and admins,
 * only on their own scans, as for the deeper scan (app/actions/security-deeper-scan.ts). The price and the owner are
 * worked out on the server; the browser sends only the scan and how the code is named.
 */
async function access() {
  const user = await requireUser();
  const workspace = await currentOrganisationAccess(user.id, user.role);
  if (!workspace.organisationId || !workspace.admin) return null;
  return { userId: user.id, organisationId: workspace.organisationId };
}

const ID = /^[a-zA-Z0-9_-]{1,100}$/;

/** The Connect code window's numbers and projects. Charges nothing. */
export async function codeScanCost(checkId: string): Promise<CodeScanQuote> {
  if (typeof checkId !== "string" || !ID.test(checkId)) return { ok: false, reason: "not_found", error: "That scan isn't in your scans." };
  const who = await access();
  if (!who) return { ok: false, reason: "not_found", error: OWNERS_ONLY_MESSAGE };
  return codeScanQuote(who.organisationId, who.userId, checkId);
}

/** Pay for the code scan and start it. Only from the window's Pay button: never on load or after a top-up. */
export async function startPaidCodeScan(checkId: string, source: CodeScanSource): Promise<CodeScanOutcome> {
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
  const outcome = await startCodeScan(who.organisationId, who.userId, checkId, clean);
  if (outcome.ok) {
    after(() => kickCheck(prisma, outcome.checkId));
    revalidatePath("/security");
    revalidatePath(`/security/checks/${checkId}`);
  }
  return outcome;
}
