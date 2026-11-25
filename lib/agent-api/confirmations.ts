import type { AgentLevel, ConfirmationVerdict, Prisma, PrismaClient, WorkTrack } from "@prisma/client";
import { PRODUCT_STEP_ONLY_MESSAGE, trackRules } from "@/lib/marketing/track";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { hasLevel } from "@/lib/agents/levels";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { ENTRY_SUMMARY_MAX_CHARS, entryDescription, entrySummary } from "@/lib/agent-api/entry-fields";
import { workflowFor } from "@/lib/workflow";
import { parseIssueRef } from "@/lib/issue-ref";
import { statusChangedSummary } from "@/lib/activity-log";
import { ownsIssue, readConfirmations, type ReadConfirmation } from "@/lib/issue-stage";
import { isThresholdOnly } from "@/lib/governance";
import { linkAttachments } from "@/lib/attachment-link";
import { MAX_ATTACHMENTS_PER_ITEM } from "@/lib/attachments";
import { moveTo } from "@/lib/issue-substatus";
import { canSeeEvidenceFiles, evidenceFilesSchema, evidenceFilesView, uniqueEvidenceFiles, type EvidenceFile, type EvidenceFilesView } from "@/lib/agent-api/evidence-files";

/**
 * Confirmations (#issue-confirmations). An issue at Requires confirmation
 * takes one entry per person, and so does one whose work started before it was
 * confirmed (`takesConfirmations`): `confirm` (it is real and not a duplicate),
 * `reject` (it is not real, or, with `duplicateOfId`, it duplicates another
 * issue) or `neutral`. Every entry has a summary of at most two sentences and
 * a full description — nobody gives a bare verdict. Giving it again replaces
 * the person's entry. Replies to an entry are plain comments.
 *
 * Agents give entries for their owner (`POST /api/v1/issues/{id}/confirmations`),
 * people in the web app (`app/actions/confirmations.ts`); both come here.
 *
 * - Weights (#confirmation-weights): a person may give one entry of each
 *   class, so twice: with a manager (or merger) agent, counting the project's
 *   managerVoteWeight, and with a worker agent or in the web app, counting 1.
 *   Anyone may confirm their own issue; that entry counts 1.
 * - The issue is confirmed once the weighted confirms reach the project's
 *   `confirmationsNeeded` (`readConfirmations`, the one rule). Any agent then moves it to Open
 *   (`openConfirmedIssue`); in a threshold-only project the confirm that
 *   reaches the threshold opens it.
 * - Evidence: an entry may attach several files (`attachmentIds`), such as
 *   screenshots, and should name the lines of code where the issue was found.
 * - Pay (#one-payment): the reporter and the counted confirmers earn their
 *   shares of the issue's funded Ziks when it pays out, once it is live
 *   (lib/coins/issue-payout.ts). A duplicate is never fixed, so it pays nobody.
 */

export const CONFIRMATION_VERDICTS = ["confirm", "reject", "neutral"] as const satisfies readonly ConfirmationVerdict[];
export const CONFIRMATION_SUMMARY_MAX_CHARS = ENTRY_SUMMARY_MAX_CHARS;

const ref = z.string().trim().min(1).max(191);

/** The entry's body. Summary and description follow the idea verdict rules (`ideaVerdictFields`). */
export const confirmationSchema = z
  .object({
    projectId: ref.optional(),
    verdict: z.enum(CONFIRMATION_VERDICTS),
    summary: entrySummary,
    description: entryDescription,
    /** With reject: the issue this one duplicates, by id or number. */
    duplicateOfId: ref.optional(),
    /** Uploaded files (screenshots) attached as evidence, from POST /api/v1/attachments. */
    attachmentIds: z.array(ref).max(MAX_ATTACHMENTS_PER_ITEM).optional(),
    /**
     * The files, and optionally the lines, where the issue is (#confirmation-files):
     * [{ path, lines? }]. Required with confirm. Other agents see them only once
     * they have confirmed too.
     */
    files: evidenceFilesSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.verdict === "confirm" && !(body.files && body.files.length > 0)) {
      ctx.addIssue({ code: "custom", path: ["files"], message: "A confirm needs files: the files (and lines) where you found the issue, as [{ path, lines? }]." });
    }
    if (body.duplicateOfId && body.verdict !== "reject") {
      ctx.addIssue({ code: "custom", path: ["duplicateOfId"], message: "duplicateOfId only goes with reject: this issue duplicates that one." });
    }
  });

export type ConfirmationInput = z.infer<typeof confirmationSchema>;

/** Who gives the entry: an agent on its owner's behalf, or a person in the web app. */
export type ConfirmationGiver = { organisationId: string; userId: string; agent?: { id: string; level: AgentLevel } };

type Db = PrismaClient | Prisma.TransactionClient;
type Scope = { organisationId: string; projectId: string };

/** What the independence rule needs about the issue. */
/** Marketing issues have no confirmation step (D2). */
function refuseProductStep(track: WorkTrack): void {
  if (!trackRules(track).hasProductSteps) {
    throw new IssueApiError(409, PRODUCT_STEP_ONLY_MESSAGE, { error: "wrong_track", message: PRODUCT_STEP_ONLY_MESSAGE });
  }
}

const bugSelect = {
  id: true,
  number: true,
  organisationId: true,
  projectId: true,
  status: true,
  substatus: true,
  track: true,
  isDeleted: true,
  reporterId: true,
  beneficiaryUserId: true,
  assigneeId: true,
  duplicateOfId: true,
  createdByAgentId: true,
  createdByAgent: { select: { ownerUserId: true } },
  idea: { select: { source: true } },
  claims: { select: { status: true, releasedAt: true, beneficiaryUserId: true, agentId: true, dispatcherUserId: true, agent: { select: { ownerUserId: true } } } },
} satisfies Prisma.BugSelect;

function invalid(error: z.ZodError): IssueApiError {
  const issue = error.issues[0];
  const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
  const message =
    field === "verdict" ? "verdict must be confirm, reject or neutral." : issue?.message ?? "Invalid confirmation.";
  return new IssueApiError(400, message, { error: "invalid_request", message, ...(field ? { field } : {}) });
}

/** Parses a raw body, throwing a 400 `IssueApiError` that names the field. */
export function parseConfirmation(raw: unknown): ConfirmationInput {
  const parsed = confirmationSchema.safeParse(raw ?? {});
  if (!parsed.success) throw invalid(parsed.error);
  return parsed.data;
}

/** One issue's confirmation state under the one rule (`readConfirmations`). */
export async function confirmationStateOf(bugId: string, db: Db = prisma): Promise<ReadConfirmation | null> {
  return (await readConfirmations(db, { id: bugId })).get(bugId) ?? null;
}

/** True once the project's required number of independent people confirmed the issue. */
export async function isConfirmed(bugId: string, db: Db = prisma): Promise<boolean> {
  return (await confirmationStateOf(bugId, db))?.confirmed ?? false;
}

/**
 * The people paid for confirming an issue, in the order they confirmed
 * (#confirmation-pay): the counted confirms, one per person, leaving out the
 * issue's own people (their confirm counts but earns no confirmer's share; the
 * reporter's share pays for it). A confirmer's place in this list sets their
 * weight in the confirmers' share when the issue pays out (`confirmationPayFactor`,
 * lib/coins/issue-payout.ts).
 */
export function paidConfirmerOrder(
  counted: readonly { verdict: string; onBehalfOfUserId: string }[],
  bug: Parameters<typeof ownsIssue>[1],
): string[] {
  return [...new Set(counted.filter((entry) => entry.verdict === "confirm" && !ownsIssue(entry.onBehalfOfUserId, bug)).map((entry) => entry.onBehalfOfUserId))];
}

export type GivenConfirmation = {
  confirmation: {
    id: string;
    weightClass: string;
    verdict: ConfirmationVerdict;
    summary: string;
    description: string;
    duplicateOfId: string | null;
    onBehalfOfUserId: string;
    agentId: string | null;
    /** The files this entry points at; the giver always sees their own. */
    files: EvidenceFile[];
    createdAt: Date;
    updatedAt: Date;
  };
  /** True when this replaced the person's earlier entry. */
  replaced: boolean;
  confirmed: boolean;
  /** True when this entry is the one that confirmed the issue. */
  newlyConfirmed: boolean;
  /** True when this entry moved the issue to Open (threshold-only projects). */
  opened: boolean;
  confirmations: number;
  confirmationsNeeded: number;
};

const NOT_FOUND = "No such issue in this project.";

/**
 * Where an issue can be before it is confirmed. A bid can be awarded while the
 * issue awaits confirmation (#open-award), and a released claim sends it back
 * to Open, so its work can start, be delivered and be judged first; accepting
 * it still needs the confirmation (`merge.ts`), so it must still be possible
 * to give one there.
 */
const UNCONFIRMED_WORK_SUBSTATUSES: ReadonlySet<string> = new Set(["open", "in_progress", "requires_review", "accepted"]);

/**
 * Whether an issue takes confirmation entries: always at Requires
 * confirmation, and at the stages above until it is confirmed.
 */
export function takesConfirmations(substatus: string, confirmed: boolean): boolean {
  if (substatus === "requires_confirmation") return true;
  return !confirmed && UNCONFIRMED_WORK_SUBSTATUSES.has(substatus);
}

/** Resolves `duplicateOfId` (an id or a number) to another issue in the organisation. */
async function resolveDuplicate(tx: Prisma.TransactionClient, organisationId: string, bugId: string, raw: string): Promise<string> {
  const parsed = parseIssueRef(raw.replace(/^#/, ""));
  const canonical = await tx.bug.findFirst({
    where: { organisationId, isDeleted: false, ...(parsed.kind === "number" ? { number: parsed.number } : { id: parsed.id }) },
    select: { id: true },
  });
  if (!canonical || canonical.id === bugId) {
    const message = "duplicateOfId must be another issue in this organisation.";
    throw new IssueApiError(400, message, { error: "invalid_request", message, field: "duplicateOfId" });
  }
  return canonical.id;
}

/**
 * Records `giver`'s confirmation entry on an issue (by number or id),
 * replacing any earlier one of theirs. Throws `IssueApiError`.
 */
export async function giveConfirmation(
  giver: ConfirmationGiver,
  scope: Scope,
  issueRef: string,
  raw: unknown,
): Promise<GivenConfirmation> {
  const input = parseConfirmation(raw);
  const parsedRef = parseIssueRef(issueRef);

  return prisma.$transaction(async (tx) => {
    const found = await tx.bug.findFirst({
      where: { ...scope, isDeleted: false, ...(parsedRef.kind === "number" ? { number: parsedRef.number } : { id: parsedRef.id }) },
      select: { id: true },
    });
    if (!found) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
    // Two people can confirm at the same moment. Lock the issue so the second
    // sees the first and the reporter is still paid exactly once.
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${found.id} FOR UPDATE`;
    const bug = await tx.bug.findUnique({ where: { id: found.id }, select: bugSelect });
    if (!bug || bug.isDeleted) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
    refuseProductStep(bug.track);

    const before = await confirmationStateOf(bug.id, tx);
    const wasConfirmed = before?.confirmed ?? false;
    if (!takesConfirmations(bug.substatus, wasConfirmed)) {
      const message = "This issue is not at Requires confirmation and is already confirmed, so it takes no confirmations.";
      throw new IssueApiError(409, message, { error: "not_confirming", message, status: bug.status, substatus: bug.substatus });
    }

    const duplicateOfId = input.duplicateOfId ? await resolveDuplicate(tx, bug.organisationId, bug.id, input.duplicateOfId) : null;

    // One entry per person per class: a manager agent's and a worker's (or the person's) are separate.
    const weightClass = giver.agent && hasLevel(giver.agent.level, "manager") ? "manager" : "working";
    const key = { bugId_onBehalfOfUserId_weightClass: { bugId: bug.id, onBehalfOfUserId: giver.userId, weightClass } };
    const existing = await tx.issueConfirmation.findUnique({ where: key, select: { id: true } });
    const data = {
      agentId: giver.agent?.id ?? null,
      verdict: input.verdict,
      summary: input.summary,
      description: input.description,
      duplicateOfId,
      files: uniqueEvidenceFiles(input.files ?? []),
      // Giving it again after an undo is a new entry.
      undoneAt: null,
    };
    const confirmation = await tx.issueConfirmation.upsert({
      where: key,
      create: { bugId: bug.id, onBehalfOfUserId: giver.userId, weightClass, ...data },
      update: data,
      select: {
        id: true, weightClass: true, verdict: true, summary: true, description: true, duplicateOfId: true,
        onBehalfOfUserId: true, agentId: true, files: true, createdAt: true, updatedAt: true,
      },
    });

    // Evidence: the giver's own uploads, attached to this entry.
    const requested = [...new Set(input.attachmentIds ?? [])];
    if (requested.length > 0) {
      const linked = await linkAttachments(tx, { ids: requested, uploaderId: giver.userId, bugId: bug.id, confirmationId: confirmation.id });
      if (linked !== requested.length) {
        const message = "One or more attachmentIds weren't found, belong to someone else, or are already attached.";
        throw new IssueApiError(422, message, { error: "invalid_attachments", message, field: "attachmentIds" });
      }
    }

    const after = await confirmationStateOf(bug.id, tx);
    const confirmed = after?.confirmed ?? false;
    const newlyConfirmed = confirmed && !wasConfirmed;
    const needed = after?.needed ?? (await workflowFor(bug.projectId, tx)).confirmationsNeeded;

    // A confirmed issue waits for an agent to move it to Open (openConfirmedIssue);
    // in a threshold-only project the confirm that reaches the threshold opens it.
    // An issue whose work started first stays where it is.
    const opened =
      confirmed && bug.substatus === "requires_confirmation" && isThresholdOnly(await workflowFor(bug.projectId, tx));
    if (opened) await moveToOpen(tx, bug.id, giver.userId, "threshold");

    // Confirming earns the confirmers' share when the issue pays out (#one-payment), not on its own.

    const payload = {
      confirmationId: confirmation.id,
      verdict: input.verdict,
      onBehalfOfUserId: giver.userId,
      summary: input.summary,
      // Lets an undo tell whether the entry was given again since.
      entryAt: confirmation.updatedAt.toISOString(),
      ...(existing ? { replaced: true } : {}),
      ...(duplicateOfId ? { duplicateOfId } : {}),
      ...(newlyConfirmed ? { confirmed: true } : {}),
    };
    // Only agent actions are audited (and so can be undone); a person's entry is theirs.
    if (giver.agent) {
      await audit({ agentId: giver.agent.id, organisationId: bug.organisationId }, "issue.confirmation", `bug:${bug.id}`, payload, { bugId: bug.id, db: tx });
    }
    await publish(tx, { organisationId: bug.organisationId, type: "issue.confirmation", actorAgentId: giver.agent?.id ?? null, bugId: bug.id, payload });
    if (newlyConfirmed) {
      await publish(tx, {
        organisationId: bug.organisationId,
        type: "issue.confirmed",
        actorAgentId: giver.agent?.id ?? null,
        bugId: bug.id,
        payload: { issueId: bug.id, confirmationId: confirmation.id },
      });
    }

    return {
      confirmation: { ...confirmation, files: evidenceFilesView(confirmation.files, true).files ?? [] },
      replaced: Boolean(existing),
      confirmed,
      newlyConfirmed,
      opened,
      confirmations: after?.accepts ?? 0,
      confirmationsNeeded: needed,
    };
  });
}

/** Moves a confirmed issue from Requires confirmation to Open, with its activity entry. */
async function moveToOpen(tx: Prisma.TransactionClient, bugId: string, actorId: string, via: "threshold" | "agent"): Promise<void> {
  await tx.bug.update({ where: { id: bugId }, data: moveTo("open") });
  await tx.bugActivity.create({
    data: {
      bugId,
      actorId,
      type: "status_changed",
      summary: statusChangedSummary("requires_confirmation", "open"),
      metadata: { field: "status", from: "requires_confirmation", to: "open", via: via === "threshold" ? "confirmed" : "opened_by_agent" },
    },
  });
}

/**
 * `POST /api/v1/issues/{id}/open` (working): once an issue's weighted
 * confirms reach the project's threshold, any agent moves it from Requires
 * confirmation to Open, where it takes bids (#confirmation-weights).
 * 409 `not_confirming` when it isn't at Requires confirmation; 409
 * `below_threshold` while the confirms are short.
 */
export async function openConfirmedIssue(
  agent: { agentId: string; ownerId: string; organisationId: string },
  scope: Scope,
  issueRef: string,
): Promise<{ issueId: string; status: "open"; substatus: "open"; confirmations: number; confirmationsNeeded: number }> {
  const parsedRef = parseIssueRef(issueRef);
  return prisma.$transaction(async (tx) => {
    const found = await tx.bug.findFirst({
      where: { ...scope, isDeleted: false, ...(parsedRef.kind === "number" ? { number: parsedRef.number } : { id: parsedRef.id }) },
      select: { id: true },
    });
    if (!found) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${found.id} FOR UPDATE`;
    const bug = await tx.bug.findUnique({ where: { id: found.id }, select: { id: true, status: true, substatus: true, organisationId: true, track: true } });
    if (!bug) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
    refuseProductStep(bug.track);
    if (bug.substatus !== "requires_confirmation") {
      const message = "This issue is not at Requires confirmation.";
      throw new IssueApiError(409, message, { error: "not_confirming", message, status: bug.status, substatus: bug.substatus });
    }
    const state = await confirmationStateOf(bug.id, tx);
    const confirmations = state?.accepts ?? 0;
    const confirmationsNeeded = state?.needed ?? 0;
    if (!state?.confirmed) {
      const message = `It has ${confirmations} of the ${confirmationsNeeded} confirmations it needs before it can move to Open.`;
      throw new IssueApiError(409, message, { error: "below_threshold", message, confirmations, confirmationsNeeded });
    }
    await moveToOpen(tx, bug.id, agent.ownerId, "agent");
    const payload = { issueId: bug.id, from: "requires_confirmation", to: "open", confirmations, confirmationsNeeded };
    await audit({ agentId: agent.agentId, organisationId: bug.organisationId }, "issue.opened", `bug:${bug.id}`, payload, { bugId: bug.id, db: tx });
    await publish(tx, { organisationId: bug.organisationId, type: "issue.updated", actorAgentId: agent.agentId, bugId: bug.id, payload: { ...payload, values: moveTo("open") } });
    return { issueId: bug.id, ...moveTo("open"), confirmations, confirmationsNeeded };
  });
}

export type ConfirmationReply = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  agentId: string | null;
  agentName: string | null;
  createdAt: Date;
  editedAt: Date | null;
};

export type ConfirmationView = {
  id: string;
  /** "manager" counts the project's managerVoteWeight; "working" counts 1. */
  weightClass: string;
  /** What it counts for now (1 on the person's own issue; 0 when it doesn't count). */
  weight: number;
  verdict: ConfirmationVerdict;
  summary: string;
  description: string;
  duplicateOf: { id: string; number: number; projectSlug: string; orgSlug: string } | null;
  onBehalfOfUserId: string;
  by: string;
  agentId: string | null;
  agentName: string | null;
  /** Whether it counts toward the rule (independent, after the latest edit, not undone). */
  counted: boolean;
  undone: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Evidence files (screenshots); served at /api/attachments/{id}. */
  attachments: { id: string; filename: string; contentType: string }[];
  replies: ConfirmationReply[];
  /** The penalty another confirmer gave it (#confirmation-penalties), if any. */
  penalty: { id: string; reason: string; byAgentName: string; createdAt: Date } | null;
  /** The agent's global reputation (#agent-reputation); null for a person's own entry. */
  agentReputation: number | null;
} & EvidenceFilesView;

export type ConfirmationList = {
  issueId: string;
  issueNumber: number;
  status: string;
  confirmed: boolean;
  confirmations: number;
  rejections: number;
  confirmationsNeeded: number;
  entries: ConfirmationView[];
};

/**
 * Who is reading the list, for the files rule (#confirmation-files): another
 * confirmer's files show only once the viewer has a confirm of their own on
 * the issue; their own entries and organisation admins always see them. Without
 * a viewer every entry's files are hidden.
 */
export type ConfirmationViewer = { userId: string; admin?: boolean };

/** Every confirmation entry on an issue (by number or id), newest first, with its replies. */
export async function listConfirmations(
  scope: { organisationId: string; projectId?: string },
  issueRef: string,
  viewer: ConfirmationViewer | null,
  db: PrismaClient = prisma,
): Promise<ConfirmationList> {
  const parsed = parseIssueRef(issueRef);
  const bug = await db.bug.findFirst({
    where: { ...scope, isDeleted: false, ...(parsed.kind === "number" ? { number: parsed.number } : { id: parsed.id }) },
    select: { id: true, number: true, status: true, substatus: true, projectId: true },
  });
  if (!bug) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
  const [state, rows] = await Promise.all([
    confirmationStateOf(bug.id, db),
    db.issueConfirmation.findMany({
      where: { bugId: bug.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true, weightClass: true, verdict: true, summary: true, description: true, duplicateOfId: true,
        onBehalfOfUserId: true, agentId: true, undoneAt: true, createdAt: true, updatedAt: true, files: true,
        onBehalfOf: { select: { name: true } },
        attachments: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, contentType: true } },
        agent: { select: { name: true, reputation: true } },
        penalty: { select: { id: true, reason: true, createdAt: true, agent: { select: { name: true } } } },
        replies: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true, body: true, authorId: true, agentId: true, createdAt: true, editedAt: true,
            author: { select: { name: true } },
            agent: { select: { name: true } },
          },
        },
      },
    }),
  ]);
  const duplicateIds = [...new Set(rows.map((row) => row.duplicateOfId).filter((id): id is string => Boolean(id)))];
  const duplicates = duplicateIds.length
    ? await db.bug.findMany({ where: { id: { in: duplicateIds } }, select: { id: true, number: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } } })
    : [];
  const duplicateById = new Map(duplicates.map((d) => [d.id, { id: d.id, number: d.number, projectSlug: d.project.slug, orgSlug: d.project.organisation.slug }]));
  const counted = new Map(state?.counted.map((entry) => [entry.id, entry.weight]) ?? []);
  const needed = state?.needed ?? (await workflowFor(bug.projectId, db)).confirmationsNeeded;
  const hasOwnConfirm = Boolean(viewer) && rows.some((row) => row.onBehalfOfUserId === viewer?.userId && row.verdict === "confirm" && !row.undoneAt);
  const evidenceViewer = viewer ? { ...viewer, hasOwnEntry: hasOwnConfirm } : null;
  return {
    issueId: bug.id,
    issueNumber: bug.number,
    status: bug.status,
    confirmed: state?.confirmed ?? false,
    confirmations: state?.accepts ?? 0,
    rejections: state?.rejects ?? 0,
    confirmationsNeeded: needed,
    entries: rows.map(({ onBehalfOf, agent, replies, duplicateOfId, undoneAt, files, penalty, ...row }) => ({
      ...row,
      ...evidenceFilesView(files, canSeeEvidenceFiles(evidenceViewer, row.onBehalfOfUserId)),
      penalty: penalty
        ? { id: penalty.id, reason: penalty.reason, byAgentName: penalty.agent.name, createdAt: penalty.createdAt }
        : null,
      agentReputation: agent?.reputation ?? null,
      duplicateOf: (duplicateOfId && duplicateById.get(duplicateOfId)) || null,
      by: onBehalfOf.name,
      agentName: agent?.name ?? null,
      counted: counted.has(row.id),
      weight: counted.get(row.id) ?? 0,
      undone: Boolean(undoneAt),
      replies: replies.map(({ author, agent: replyAgent, ...reply }) => ({
        ...reply,
        authorName: author.name,
        agentName: replyAgent?.name ?? null,
      })),
    })),
  };
}
