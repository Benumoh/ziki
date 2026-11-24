import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGER_VOTE_WEIGHT } from "@/lib/voting";
import { removeUpvote, upvoteIssue } from "@/lib/agent-api/votes";

/** Importance marks (#importance): a plain toggle per person, weighted by class, with a correct tally. */
const bugId = "bug-1";
const projectId = "project-1";

const db = vi.hoisted(() => ({
  bug: { findUnique: vi.fn(), update: vi.fn() },
  vote: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), groupBy: vi.fn() },
  agentEvent: { create: vi.fn(), findUnique: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const mark = { agentId: "agent-1" };

const agent = {
  agentId: "agent-1",
  name: "Ada",
  ownerId: "user-ada",
  organisationId: "organisation-zedu",
  level: "working" as const,
  burst: false,
  keyId: "key-1",
};

describe("agent upvotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
    // Upvotes apply to issues; an idea takes verdicts instead (#idea-verdicts).
    db.$queryRaw.mockResolvedValue([{ id: bugId, convertedToIssueAt: new Date("2026-10-20T00:00:00Z") }]);
    db.agentEvent.create.mockResolvedValue({ id: "evt-1" });
    db.agentEvent.findUnique.mockResolvedValue({ id: "evt-1" });
    db.webhookSubscription.findMany.mockResolvedValue([]);
    db.bug.update.mockResolvedValue({});
    db.vote.groupBy.mockResolvedValue([{ value: 1, _count: { _all: 1 } }]);
  });

  it("records the owner upvote once and publishes it", async () => {
    db.vote.findUnique.mockResolvedValue(null);
    db.vote.create.mockResolvedValue({ id: "vote-1" });

    const result = await upvoteIssue(agent, projectId, bugId);

    expect(result).toEqual({ important: true, importance: 1, changed: true, weight: 1 });
    expect(db.vote.create).toHaveBeenCalledWith({
      data: { userId: "user-ada", bugId, value: 1, ...mark },
    });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: bugId }, data: { voteCount: 1 } });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "issue.importance",
        actorAgentId: "agent-1",
        bugId,
        payload: expect.objectContaining({ userId: "user-ada", importance: 1, important: true }),
      }),
    }));
  });

  it("changes nothing when the owner already marked it with this weight", async () => {
    db.vote.findUnique.mockResolvedValue({ id: "vote-1", value: 1, agentId: null });
    db.bug.findUnique.mockResolvedValue({ voteCount: 3 });

    const result = await upvoteIssue(agent, projectId, bugId);

    expect(result).toEqual({ important: true, importance: 3, changed: false, weight: 1 });
    expect(db.vote.create).not.toHaveBeenCalled();
    expect(db.vote.update).not.toHaveBeenCalled();
    expect(db.agentEvent.create).not.toHaveBeenCalled();
  });

  it("removes the owner upvote and recounts", async () => {
    db.vote.findUnique.mockResolvedValue({ id: "vote-1", value: 1 });
    db.vote.groupBy.mockResolvedValue([]);

    const result = await removeUpvote(agent, projectId, bugId);

    expect(result).toEqual({ important: false, importance: 0, changed: true, weight: 0 });
    expect(db.vote.delete).toHaveBeenCalledWith({ where: { id: "vote-1" } });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "issue.importance",
        payload: expect.objectContaining({ important: false, importance: 0 }),
      }),
    }));
  });

  it("stores a manager agent's upvote as MANAGER_VOTE_WEIGHT and counts it that many times", async () => {
    db.vote.findUnique.mockResolvedValue(null);
    db.vote.create.mockResolvedValue({ id: "vote-1" });
    db.vote.groupBy.mockResolvedValue([
      { value: 1, _count: { _all: 2 } },
      { value: MANAGER_VOTE_WEIGHT, _count: { _all: 1 } },
    ]);

    const result = await upvoteIssue({ ...agent, level: "manager" }, projectId, bugId);

    expect(db.vote.create).toHaveBeenCalledWith({
      data: { userId: "user-ada", bugId, value: MANAGER_VOTE_WEIGHT, ...mark },
    });
    expect(result).toEqual({ important: true, importance: 2 + MANAGER_VOTE_WEIGHT, changed: true, weight: MANAGER_VOTE_WEIGHT });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: bugId }, data: { voteCount: 2 + MANAGER_VOTE_WEIGHT } });
  });

  it("counts a manager agent's upvote once on its owner's own report", async () => {
    db.$queryRaw.mockResolvedValue([{ id: bugId, reporterId: "user-ada", beneficiaryUserId: "user-ada", convertedToIssueAt: new Date("2026-10-20T00:00:00Z") }]);
    db.vote.findUnique.mockResolvedValue(null);
    db.vote.create.mockResolvedValue({ id: "vote-1" });

    const result = await upvoteIssue({ ...agent, level: "manager" }, projectId, bugId);

    expect(result.weight).toBe(1);
    expect(db.vote.create).toHaveBeenCalledWith({ data: { userId: "user-ada", bugId, value: 1, ...mark } });
  });

});
