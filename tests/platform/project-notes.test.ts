import { beforeEach, describe, expect, it, vi } from "vitest";

/** Project notes (#732): only organisation admins (in the app) and merger agents (by promoting a comment, #notes-promote) change the official notes, each save is a revision, stale saves are refused, and everyone in the project may comment and vote once. */
const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn() }, membership: { findUnique: vi.fn() },
  projectNotes: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  projectNoteRevision: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  projectNoteComment: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  projectNoteCommentVote: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  agentAuditEvent: { create: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { agentNotesActor, saveProjectNotes, promoteNoteComment,
  addNoteComment, voteNoteComment, restoreProjectNotes, type NotesActor } from "@/lib/project-notes";
import type { AgentContext } from "@/lib/agents/require-agent";

const agent: AgentContext = { agentId: "agent", ownerId: "owner", organisationId: "organisation", name: "Worker", level: "working", keyId: "key", burst: false };
const actor: NotesActor = { projectId: "project", organisationId: "organisation", userId: "owner", name: "Worker", agent, canEdit: true };
const input = { body: "Use migrations only.", expectedVersion: 0, reason: "Initial guidance" };

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (run) => run(db));
  db.project.findFirst.mockResolvedValue({ id: "project" });
  db.membership.findUnique.mockResolvedValue({ role: "member" });
  db.projectNoteRevision.create.mockResolvedValue({ id: "revision" });
  db.projectNotes.findUniqueOrThrow.mockResolvedValue({ body: input.body, version: 1 });
  db.projectNotes.updateMany.mockResolvedValue({ count: 1 });
});

describe("project notes access", () => {
  it("does not let a key read another organisation's project", async () => {
    db.project.findFirst.mockResolvedValue(null);
    await expect(agentNotesActor(agent, "foreign")).rejects.toMatchObject({ status: 404 });
    expect(db.project.findFirst.mock.calls[0][0].where).toMatchObject({ id: "foreign", organisationId: "organisation" });
  });
  it("does not confer organisation authority from a site admin title", async () => {
    expect((await agentNotesActor({ ...agent, ownerRole: "admin" }, "project")).canEdit).toBe(false);
  });
  it("gives no working agent edit rights, even one a organisation admin owns; only a merger agent (#notes-promote)", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });
    expect((await agentNotesActor(agent, "project")).canEdit).toBe(false);
    expect((await agentNotesActor({ ...agent, level: "manager" }, "project")).canEdit).toBe(false);
    expect((await agentNotesActor({ ...agent, level: "merger" }, "project")).canEdit).toBe(true);
  });
});

describe("official notes and history", () => {
  it("refuses unauthorized writes before opening a transaction", async () => {
    await expect(saveProjectNotes({ ...actor, canEdit: false }, input)).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("creates the document, immutable revision and agent audit together", async () => {
    await expect(saveProjectNotes(actor, input)).resolves.toMatchObject({ version: 1 });
    expect(db.projectNotes.create).toHaveBeenCalledWith({ data: expect.objectContaining({ projectId: "project", version: 1, editorAgentId: "agent" }) });
    expect(db.projectNoteRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ reason: "Initial guidance", version: 1, editorUserId: "owner" }) });
    expect(db.agentAuditEvent.create).toHaveBeenCalled();
  });
  it("detects stale saves and never writes a revision for them", async () => {
    db.projectNotes.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveProjectNotes(actor, { ...input, expectedVersion: 3 })).rejects.toMatchObject({ status: 409 });
    expect(db.projectNoteRevision.create).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, body: " " }, { ...input, expectedVersion: -1 }, { ...input, reason: "" },
    { ...input, body: "x".repeat(100001) }, { ...input, editorAgentId: "forged" },
  ])("rejects malformed or forged official-note input", async (data) => {
    await expect(saveProjectNotes(actor, data)).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("cannot restore a revision from another project", async () => {
    db.projectNoteRevision.findFirst.mockResolvedValue(null);
    await expect(restoreProjectNotes(actor, "foreign", { expectedVersion: 2, reason: "Restore" })).rejects.toMatchObject({ status: 404 });
    expect(db.projectNoteRevision.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", projectId: "project" } });
  });
});

describe("promoting a notes comment (#notes-promote)", () => {
  const merger: NotesActor = { ...actor, agent: { ...agent, level: "merger" } };
  it("refuses any agent but a merger before touching the notes", async () => {
    await expect(promoteNoteComment({ ...actor, agent: { ...agent, level: "manager" } }, "c1", input)).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("saves the next version and retires the comment and its replies in the same step", async () => {
    db.projectNoteComment.findFirst.mockResolvedValue({ id: "c1", retiredAt: null, promotedInVersion: null });
    await expect(promoteNoteComment(merger, "c1", input)).resolves.toMatchObject({ version: 1, comment: { id: "c1", promotedInVersion: 1 } });
    expect(db.projectNoteRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 1, reason: expect.stringContaining("c1") }) });
    expect(db.projectNoteComment.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ id: "c1" }, { parentId: "c1" }], projectId: "project", retiredAt: null },
      data: expect.objectContaining({ promotedInVersion: 1, promotedByAgentId: "agent" }),
    });
  });
  it("refuses a comment already promoted, and a stale version, without retiring anything", async () => {
    db.projectNoteComment.findFirst.mockResolvedValue({ id: "c1", retiredAt: new Date(), promotedInVersion: 2 });
    await expect(promoteNoteComment(merger, "c1", input)).rejects.toMatchObject({ status: 409 });
    db.projectNoteComment.findFirst.mockResolvedValue({ id: "c2", retiredAt: null, promotedInVersion: null });
    db.projectNotes.updateMany.mockResolvedValue({ count: 0 });
    await expect(promoteNoteComment(merger, "c2", { ...input, expectedVersion: 3 })).rejects.toMatchObject({ status: 409 });
    expect(db.projectNoteComment.updateMany).not.toHaveBeenCalled();
  });
});

describe("people in the notes discussion (#732)", () => {
  const person: NotesActor = { projectId: "project", organisationId: "organisation", userId: "member", name: "Ada", canEdit: false };
  it("lets a member who can't edit the official notes add a comment, with no agent", async () => {
    db.projectNoteComment.create.mockResolvedValue({ id: "comment" });
    await addNoteComment(person, { body: "The staging URL changed." });
    expect(db.projectNoteComment.create).toHaveBeenCalledWith({ data: { projectId: "project", agentId: null, ownerId: "member", authorName: "Ada", body: "The staging URL changed.", parentId: null } });
    expect(db.projectNotes.updateMany).not.toHaveBeenCalled();
  });
});

describe("agent discussion", () => {
  it("keeps one vote per person, up or down, and never changes official guidance (#732)", async () => {
    db.projectNoteComment.findFirst.mockResolvedValue({ id: "comment", ownerId: "author", agentId: "author-agent" });
    db.projectNoteCommentVote.findUnique.mockResolvedValue(null);
    db.projectNoteCommentVote.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await voteNoteComment(actor, "comment", 1)).toMatchObject({ myVote: 1, upvotes: 1, downvotes: 0 });
    expect(db.projectNoteCommentVote.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { commentId_userId: { commentId: "comment", userId: "owner" } },
      update: expect.objectContaining({ value: 1 }),
    }));
    await voteNoteComment(actor, "comment", 0);
    expect(db.projectNoteCommentVote.deleteMany).toHaveBeenCalledWith({ where: { commentId: "comment", userId: "owner" } });
    expect(db.projectNotes.updateMany).not.toHaveBeenCalled();
    expect(db.projectNoteRevision.create).not.toHaveBeenCalled();
  });
});
