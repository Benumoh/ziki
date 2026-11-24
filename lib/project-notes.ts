
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import type { AgentContext } from "@/lib/agents/require-agent";
import { audit } from "@/lib/agents/audit";
import { isOrganisationAdmin } from "@/lib/organisation-role";
import type { SessionAppUser } from "@/lib/auth-helpers";

export const notesInput = z.object({
  body: z.string().trim().min(1).max(100_000),
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  reason: z.string().trim().min(1).max(500),
}).strict();


export const noteCommentInput = z.object({ body: z.string().trim().min(1).max(10_000), parentId: z.string().trim().min(1).max(64).optional() }).strict();
export const restoreNotesInput = z.object({ expectedVersion: z.number().int().min(1).max(2_147_483_646), reason: z.string().trim().min(1).max(500) }).strict();
/**
 * Promoting a note comment (#notes-promote): the whole new notes, with the
 * comment's learning worked in, against the version you read, and why.
 */
export const promoteNoteCommentInput = notesInput;
export type NotesActor = {
  userId: string; name: string; organisationId: string; projectId: string; canEdit: boolean;
  agent?: AgentContext;
};

/** A project id never grants access. Recheck membership, archives and key scope. */
export async function agentNotesActor(agent: AgentContext, projectId: string): Promise<NotesActor> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organisationId: agent.organisationId, archivedAt: null, organisation: { archivedAt: null } },
    select: { id: true },
  });
  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId: agent.organisationId, userId: agent.ownerId } }, select: { role: true },
  });
  if (!project || !membership) throw new IssueApiError(404, "Project not found.");
  return {
    userId: agent.ownerId, name: agent.name, organisationId: agent.organisationId, projectId, agent,
    // #notes-promote: no agent edits the notes directly, whoever its owner is. Only a
    // merger agent changes them, by promoting a discussion comment or restoring a revision.
    canEdit: agent.level === "merger",
  };
}

export async function humanNotesActor(user: SessionAppUser, organisationId: string, projectId: string): Promise<NotesActor> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organisationId, archivedAt: null, organisation: { archivedAt: null } }, select: { id: true },
  });
  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId, userId: user.id } }, select: { role: true },
  });
  const projectMembership = !membership ? await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } }, select: { id: true },
  }) : null;
  if (!project || (!membership && !projectMembership && user.role !== "super_admin")) throw new IssueApiError(404, "Project not found.");
  return { userId: user.id, name: user.name || "Organisation member", organisationId, projectId,
    canEdit: membership ? isOrganisationAdmin(membership.role, user.role) : user.role === "super_admin" };
}

export function requireNotesEditor(actor: NotesActor) {
  if (!actor.canEdit) {
    throw new IssueApiError(
      403,
      actor.agent
        ? "Only a merger agent changes the official notes, by promoting a notes comment. Post what you learned as a notes comment instead."
        : "Only organisation owners and admins can edit official notes.",
    );
  }
}

export async function readProjectNotes(actor: NotesActor) {
  const notes = await prisma.projectNotes.findUnique({ where: { projectId: actor.projectId } });
  return { notes, version: notes?.version ?? 0, canEdit: actor.canEdit };
}

async function notesAudit(db: Prisma.TransactionClient, actor: NotesActor, action: string, target: string, payload: Prisma.InputJsonValue) {
  if (actor.agent) await audit(actor.agent, action, target, payload, { db });
}

const STALE_NOTES = "Notes changed. Reload the latest version before saving your draft.";

/** Writes the next version and its immutable revision in the caller's transaction. */
async function writeNotesVersion(db: Prisma.TransactionClient, actor: NotesActor, data: z.infer<typeof notesInput>) {
  const editor = { editorUserId: actor.userId, editorAgentId: actor.agent?.agentId ?? null, editorName: actor.name };
  const version = data.expectedVersion + 1;
  if (data.expectedVersion === 0) {
    await db.projectNotes.create({ data: { projectId: actor.projectId, body: data.body, version, ...editor } });
  } else {
    const updated = await db.projectNotes.updateMany({
      where: { projectId: actor.projectId, version: data.expectedVersion },
      data: { body: data.body, version, ...editor },
    });
    if (updated.count !== 1) throw new IssueApiError(409, STALE_NOTES);
  }
  const revision = await db.projectNoteRevision.create({ data: {
    projectId: actor.projectId, body: data.body, version, reason: data.reason, ...editor,
  } });
  return { version, revisionId: revision.id };
}

/** A unique-key race on the first version is a stale write too. */
function staleOnConflict(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    throw new IssueApiError(409, STALE_NOTES);
  }
  throw error;
}

/**
 * A person's direct edit in the app (organisation owners and admins). Agents
 * never edit the notes directly (#notes-promote): a merger agent promotes a
 * comment (`promoteNoteComment`) or restores a revision.
 */
export async function saveProjectNotes(actor: NotesActor, input: unknown) {
  requireNotesEditor(actor);
  const data = notesInput.parse(input);
  try {
    return await prisma.$transaction(async (db) => {
      const { version, revisionId } = await writeNotesVersion(db, actor, data);
      await notesAudit(db, actor, "notes.saved", actor.projectId, { version, revisionId });
      return { notes: await db.projectNotes.findUniqueOrThrow({ where: { projectId: actor.projectId } }), version };
    });
  } catch (error) {
    staleOnConflict(error);
  }
}

/**
 * Promotes a notes comment into the official notes (#notes-promote): a merger
 * agent works what the comment learned into the notes, sending the whole new
 * notes against the version it read. In one step the notes take the new
 * version (its revision reason names the comment), and the comment is retired
 * from the discussion with its replies, recorded as taken in by that version.
 * Only a merger agent may; nobody adds to the notes directly.
 */
export async function promoteNoteComment(actor: NotesActor, commentId: string, input: unknown) {
  if (actor.agent?.level !== "merger") {
    throw new IssueApiError(403, "Only a merger agent promotes notes comments into the official notes.");
  }
  const data = promoteNoteCommentInput.parse(input);
  try {
    return await prisma.$transaction(async (db) => {
      const comment = await db.projectNoteComment.findFirst({
        where: { id: commentId, projectId: actor.projectId },
        select: { id: true, retiredAt: true, promotedInVersion: true },
      });
      if (!comment) throw new IssueApiError(404, "Comment not found.");
      if (comment.retiredAt) {
        throw new IssueApiError(409, `This comment was already promoted into the notes (version ${comment.promotedInVersion ?? "?"}).`);
      }
      const { version, revisionId } = await writeNotesVersion(db, actor, {
        ...data,
        reason: `Promote notes comment ${comment.id}: ${data.reason}`.slice(0, 500),
      });
      const retired = { retiredAt: new Date(), promotedInVersion: version, promotedByAgentId: actor.agent?.agentId ?? null };
      await db.projectNoteComment.updateMany({
        where: { OR: [{ id: comment.id }, { parentId: comment.id }], projectId: actor.projectId, retiredAt: null },
        data: retired,
      });
      await notesAudit(db, actor, "notes.comment_promoted", comment.id, { projectId: actor.projectId, version, revisionId });
      return {
        notes: await db.projectNotes.findUniqueOrThrow({ where: { projectId: actor.projectId } }),
        version,
        comment: { id: comment.id, ...retired },
      };
    });
  } catch (error) {
    staleOnConflict(error);
  }
}

const cursorSchema = z.object({ id: z.string().min(1).max(191), createdAt: z.string().datetime() }).strict();
export function notesPage(params: URLSearchParams) {
  const limit = z.coerce.number().int().min(1).max(100).safeParse(params.get("limit") ?? 20);
  if (!limit.success) throw new IssueApiError(400, "limit must be an integer from 1 to 100.");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  const raw = params.get("cursor");
  if (raw !== null) {
    try {
      if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    } catch { throw new IssueApiError(400, "Invalid notes cursor."); }
  }
  return { limit: limit.data, cursor };
}
function pageResult<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last
    ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })).toString("base64url") : null };
}

/** A note comment's vote counts and the person's own vote (#732). */
function withVotes<T extends { votes: { userId: string; value: number }[] }>(actor: NotesActor, { votes, ...comment }: T) {
  const mine = votes.find((vote) => vote.userId === actor.userId)?.value ?? 0;
  return {
    ...comment,
    upvotes: votes.filter((vote) => vote.value === 1).length,
    downvotes: votes.filter((vote) => vote.value === -1).length,
    upvoted: mine === 1,
    myVote: mine,
  };
}

/**
 * The notes discussion: top-level notes in order, a page at a time, each with
 * its replies (corrections and adaptations) oldest first.
 */
export async function listNoteComments(actor: NotesActor, params: URLSearchParams) {
  const { limit, cursor } = notesPage(params);
  // #notes-promote: promoted comments leave the discussion; `?status=promoted` lists them.
  const status = params.get("status") ?? "open";
  if (status !== "open" && status !== "promoted") throw new IssueApiError(400, "status must be open or promoted.");
  const voteSelect = { select: { userId: true, value: true } };
  const rows = await prisma.projectNoteComment.findMany({
    where: { projectId: actor.projectId, parentId: null, retiredAt: status === "open" ? null : { not: null }, ...(cursor ? { OR: [
      { createdAt: { gt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
    ] } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1,
    // `myVote` is the person's vote (#732): theirs whether they gave it in the app or through any of their agents.
    include: {
      votes: voteSelect,
      replies: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { votes: voteSelect } },
    },
  });
  const result = pageResult(rows, limit);
  return { ...result, items: result.items.map(({ replies, ...comment }) => ({
    ...withVotes(actor, comment),
    replies: replies.map((reply) => withVotes(actor, reply)),
  })) };
}

/**
 * Adds a note comment (#732): any member of the project's organisation, in the
 * app or through an agent, or a reply to one (`parentId`), such as a
 * correction or an adaptation of what it learned. Comments are contributions;
 * they never change the official notes on their own: a merger agent promotes
 * the ones worth keeping (`promoteNoteComment`).
 */
export async function addNoteComment(actor: NotesActor, input: unknown) {
  const data = noteCommentInput.parse(input);
  const agentId = actor.agent?.agentId ?? null;
  return prisma.$transaction(async (db) => {
    if (data.parentId) {
      // A reply goes under a top-level note in this project: one level deep.
      const parent = await db.projectNoteComment.findFirst({ where: { id: data.parentId, projectId: actor.projectId }, select: { parentId: true, retiredAt: true } });
      if (!parent) throw new IssueApiError(404, "The note you are replying to was not found.");
      if (parent.parentId) throw new IssueApiError(422, "Reply to the note itself: replies are one level deep.");
      if (parent.retiredAt) throw new IssueApiError(409, "That comment is now part of the official notes; post a new comment instead.");
    }
    const comment = await db.projectNoteComment.create({ data: { projectId: actor.projectId, agentId,
      ownerId: actor.userId, authorName: actor.name, body: data.body, parentId: data.parentId ?? null } });
    await notesAudit(db, actor, "notes.commented", comment.id, { projectId: actor.projectId });
    return { comment };
  });
}

/**
 * Votes on a note comment (#732): up (1), down (-1), or takes the vote back
 * (0). One vote per person: a member in the app and each of their agents share
 * it, so repeating it changes nothing and voting the other way replaces it.
 */
export async function voteNoteComment(actor: NotesActor, commentId: string, value: 1 | -1 | 0) {
  const userId = actor.userId;
  const agentId = actor.agent?.agentId ?? null;
  return prisma.$transaction(async (db) => {
    const comment = await db.projectNoteComment.findFirst({ where: { id: commentId, projectId: actor.projectId }, select: { id: true, ownerId: true, agentId: true } });
    if (!comment) throw new IssueApiError(404, "Comment not found.");
    if (value === 0) await db.projectNoteCommentVote.deleteMany({ where: { commentId, userId } });
    else {
      await db.projectNoteCommentVote.upsert({
        where: { commentId_userId: { commentId, userId } },
        create: { commentId, userId, agentId, value },
        update: { value, agentId },
      });
    }

    const action = value === 1 ? "notes.comment_upvoted" : value === -1 ? "notes.comment_downvoted" : "notes.comment_unvoted";
    await notesAudit(db, actor, action, commentId, { projectId: actor.projectId });
    const [upvotes, downvotes] = await Promise.all([
      db.projectNoteCommentVote.count({ where: { commentId, value: 1 } }),
      db.projectNoteCommentVote.count({ where: { commentId, value: -1 } }),
    ]);
    return { upvoted: value === 1, myVote: value, upvotes, downvotes };
  });
}

export async function listNoteRevisions(actor: NotesActor, params: URLSearchParams) {
  const { limit, cursor } = notesPage(params);
  const rows = await prisma.projectNoteRevision.findMany({
    where: { projectId: actor.projectId, ...(cursor ? { OR: [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
  });
  return pageResult(rows, limit);
}

export async function restoreProjectNotes(actor: NotesActor, revisionId: string, input: unknown) {
  requireNotesEditor(actor);
  const data = restoreNotesInput.parse(input);
  const revision = await prisma.projectNoteRevision.findFirst({ where: { id: revisionId, projectId: actor.projectId } });
  if (!revision) throw new IssueApiError(404, "Revision not found.");
  return saveProjectNotes(actor, { ...data, body: revision.body, reason: `Restore v${revision.version}: ${data.reason}`.slice(0, 500) });
}
