"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { OWNERS_ONLY_MESSAGE } from "@/lib/security-checks";
import { parseSecurityTarget, PRIVATE_TARGET_ERROR, targetAddress } from "@/lib/security-checks/target";
import { addTargetAndCheck, nextStepPath, refusedMessage, saveQuickScan } from "@/lib/security-checks/entry";
import { previewScan } from "@/lib/security-checks/preview";
import { summarisePreview, type PreviewSummary } from "@/lib/security-checks/preview-summary";
import type { ParsedTarget } from "@/lib/security-checks/target";
import {
  ASSISTANT_HISTORY_MAX,
  ASSISTANT_MESSAGE_MAX,
  askSecurityAssistant,
  type AssistantTurn,
} from "@/lib/security-checks/assistant";

/**
 * Ziki's security chat, signed in (#security-checks, plan part C3). A plain
 * link is added straight away without asking the AI, so it costs nothing and
 * is instant. Anything else goes to the assistant, which answers and picks
 * out the site. Once a site is clear, Dave's quick scan looks at it and the
 * chat shows the counts (never what was found). Nothing is saved until the
 * client clicks "Show it's yours" (`addSecurityAsset`), which adds the asset
 * and goes on to prove it. A public GitHub repo gets a quick look too (its file
 * names only); a private one says so and still goes on.
 */

export type ChatAnswer =
  | { kind: "reply"; reply: string }
  | { kind: "go"; reply: string; href: string }
  /** The quick scan of a site, before anything is saved: counts only. `summary` is null when the scan couldn't run. */
  | { kind: "scan"; reply: string; target: string; summary: PreviewSummary | null; note: string | null; canAdd: boolean }
  | { kind: "error"; error: string };

/** Messages one person may send the assistant in an hour. */
const ASSISTANT_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };

const NO_WORKSPACE = "Join or create a workspace to secure your assets.";
const ASK_FOR_ADDRESS = "Paste your website, a server address or a GitHub repo, and I'll set up a scan.";

export async function talkToSecurityAssistant(history: AssistantTurn[]): Promise<ChatAnswer> {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) return { kind: "error", error: NO_WORKSPACE };
  if (!access.admin) return { kind: "error", error: OWNERS_ONLY_MESSAGE };

  const turns = cleanHistory(history);
  const last = turns.at(-1);
  if (!last || last.role !== "user") return { kind: "error", error: "Type what you want to secure." };

  // A plain link needs no AI.
  const direct = parseSecurityTarget(last.text);
  if (direct.ok) return scanOrGo(user.id, direct.target, `Got it. Here's a quick look at ${direct.target.value}.`);
  if (direct.error === PRIVATE_TARGET_ERROR) return { kind: "reply", reply: PRIVATE_TARGET_ERROR };

  const limit = checkRateLimit(`security-assistant:${user.id}`, ASSISTANT_RATE_LIMIT);
  if (!limit.allowed) return { kind: "error", error: RATE_LIMIT_MESSAGE };

  const answer = await askSecurityAssistant(turns);
  if (!answer) return { kind: "reply", reply: ASK_FOR_ADDRESS };
  if (answer.target) {
    const picked = parseSecurityTarget(answer.target);
    if (picked.ok) return scanOrGo(user.id, picked.target, answer.reply);
    if (picked.error === PRIVATE_TARGET_ERROR) return { kind: "reply", reply: PRIVATE_TARGET_ERROR };
  }
  return { kind: "reply", reply: answer.reply };
}

/**
 * "Show it's yours" under a quick scan: now the asset is added (a target and a
 * check, within the monthly limit) and the client goes on to prove it.
 */
export async function addSecurityAsset(link: string): Promise<ChatAnswer> {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) return { kind: "error", error: NO_WORKSPACE };
  if (!access.admin) return { kind: "error", error: OWNERS_ONLY_MESSAGE };
  const parsed = parseSecurityTarget(typeof link === "string" ? link : "");
  if (!parsed.ok) return { kind: "error", error: parsed.error };
  // The quick scan the client just saw, run again here (Dave's scan keeps it for ten minutes) rather than trusted from the page.
  let summary: PreviewSummary | null = null;
  const result = await previewScan(targetAddress(parsed.target), { visitor: `user:${user.id}` });
  if (result.ok) summary = summarisePreview(result);
  return addAndGo(access.organisationId, user.id, parsed.target, "", summary);
}

/**
 * Every asset (a website, a server or a public repo) gets the quick scan first;
 * nothing is saved until Show it's yours. A site the scan couldn't reach can't
 * be added from here; a private repo (the scan can't see it) or a scan that
 * only hit the limit still can.
 */
async function scanOrGo(userId: string, target: ParsedTarget, reply: string): Promise<ChatAnswer> {
  // The card carries the address (a repo's GitHub address), because its Show it's yours button sends it back to be added.
  const address = targetAddress(target);
  const result = await previewScan(address, { visitor: `user:${userId}` });
  if (!result.ok) return { kind: "scan", reply, target: address, summary: null, note: result.reason, canAdd: target.kind === "repo" || result.retryAfterSeconds !== undefined };
  return { kind: "scan", reply, target: address, summary: summarisePreview(result), note: null, canAdd: true };
}

async function addAndGo(
  organisationId: string,
  userId: string,
  target: Parameters<typeof addTargetAndCheck>[2],
  reply: string,
  summary: PreviewSummary | null = null,
): Promise<ChatAnswer> {
  const added = await addTargetAndCheck(organisationId, userId, target);
  if ("refused" in added) return { kind: "reply", reply: refusedMessage(added.refused, target.value) };
  if (summary) await saveQuickScan(added.targetId, summary);
  revalidatePath("/security");
  // Not proven yet: on to "Show it's yours". Proven already: back to Assets, where the free scan starts.
  return { kind: "go", reply, href: nextStepPath(added) };
}

/** Only well-formed turns, trimmed to the limits, at most the last few. */
function cleanHistory(history: unknown): AssistantTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn): turn is AssistantTurn =>
      typeof turn === "object" && turn !== null &&
      ((turn as AssistantTurn).role === "user" || (turn as AssistantTurn).role === "assistant") &&
      typeof (turn as AssistantTurn).text === "string",
    )
    .map((turn) => ({ role: turn.role, text: turn.text.trim().slice(0, ASSISTANT_MESSAGE_MAX) }))
    .filter((turn) => turn.text)
    .slice(-ASSISTANT_HISTORY_MAX);
}
