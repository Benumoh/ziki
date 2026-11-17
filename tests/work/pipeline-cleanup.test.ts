import { beforeEach, describe, expect, it, vi } from "vitest";

/** Pipeline cleanup (#pipeline-cleanup): open issues rejected or marked duplicate two days ago are closed. */
const db = vi.hoisted(() => ({
  bug: { findMany: vi.fn(), findUnique: vi.fn() },
  bugActivity: { findMany: vi.fn() },
  membership: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ closeInTransaction: vi.fn(), lockedRow: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/close-suggestions", () => ({
  closeInTransaction: mocks.closeInTransaction,
  lockedRow: mocks.lockedRow,
}));

import {
  cleanupDecision,
  cleanupEvidence,
  pipelineCleanupMode,
  pipelineCutoff,
  sweepPipelineCleanup,
  type CleanupInput,
} from "@/lib/pipeline-cleanup";
import { closedLabel, isCloseReason } from "@/lib/close-reasons";

const now = new Date("2026-11-13T12:00:00Z");
const cutoff = pipelineCutoff(now);
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
const input = (over: Partial<CleanupInput> = {}): CleanupInput => ({
  status: "open",
  duplicateOfId: null,
  duplicateMarkedAt: null,
  confirmations: [],
  updatedAt: daysAgo(10),
  ...over,
});

describe("cleanupDecision", () => {
  it("closes a duplicate marked more than two days ago", () => {
    expect(cleanupDecision(input({ duplicateOfId: "b1", duplicateMarkedAt: daysAgo(3) }), cutoff)).toMatchObject({ reason: "duplicate" });
  });

  it("keeps a duplicate marked within two days", () => {
    expect(cleanupDecision(input({ duplicateOfId: "b1", duplicateMarkedAt: daysAgo(1) }), cutoff)).toBeNull();
  });

  it("falls back to the last update when a duplicate's marking is unknown", () => {
    expect(cleanupDecision(input({ duplicateOfId: "b1", updatedAt: daysAgo(1) }), cutoff)).toBeNull();
    expect(cleanupDecision(input({ duplicateOfId: "b1", updatedAt: daysAgo(5) }), cutoff)).toMatchObject({ reason: "duplicate" });
  });

  it("closes an issue whose rejects outnumber its confirms, two days after the last entry", () => {
    const confirmations = [
      { verdict: "reject", updatedAt: daysAgo(4) },
      { verdict: "reject", updatedAt: daysAgo(3) },
      { verdict: "confirm", updatedAt: daysAgo(5) },
    ];
    expect(cleanupDecision(input({ confirmations }), cutoff)).toMatchObject({ reason: "rejected", rejects: 2, confirms: 1 });
  });

  it("waits while the latest confirmation entry is newer than two days", () => {
    const confirmations = [{ verdict: "reject", updatedAt: daysAgo(3) }, { verdict: "neutral", updatedAt: daysAgo(1) }];
    expect(cleanupDecision(input({ confirmations }), cutoff)).toBeNull();
  });

  it("keeps an issue that confirms outweigh or tie", () => {
    const tie = [{ verdict: "reject", updatedAt: daysAgo(5) }, { verdict: "confirm", updatedAt: daysAgo(5) }];
    expect(cleanupDecision(input({ confirmations: tie }), cutoff)).toBeNull();
  });

  it("leaves anything past Open alone: in progress, delivered, live or closed", () => {
    for (const status of ["in_progress", "done", "merge", "resolved", "closed"]) {
      expect(cleanupDecision(input({ status, duplicateOfId: "b1", duplicateMarkedAt: daysAgo(9) }), cutoff)).toBeNull();
    }
  });
});

describe("close reason and evidence", () => {
  it("adds rejected as a close reason with its label", () => {
    expect(isCloseReason("rejected")).toBe(true);
    expect(closedLabel("rejected")).toBe("Closed: rejected");
  });

  it("says why it was closed", () => {
    expect(cleanupEvidence({ reason: "rejected", since: now, rejects: 3, confirms: 1 })).toContain("3 reject, 1 confirm");
    expect(cleanupEvidence({ reason: "duplicate", since: now, rejects: 0, confirms: 0 })).toContain("duplicate");
  });
});

describe("pipelineCleanupMode", () => {
  it("is off unless set to dry_run or on", () => {
    expect(pipelineCleanupMode(undefined)).toBe("off");
    expect(pipelineCleanupMode("yes")).toBe("off");
    expect(pipelineCleanupMode("DRY_RUN")).toBe("dry_run");
    expect(pipelineCleanupMode(" on ")).toBe("on");
  });
});

describe("sweepPipelineCleanup", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "b9", number: 9, title: "Old ticket", status: "open", organisationId: "o1", projectId: "p1",
    duplicateOfId: null, updatedAt: daysAgo(10), duplicateOf: null, project: { slug: "desktop", name: "Desktop" },
    confirmations: [{ verdict: "reject", updatedAt: daysAgo(4) }],
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.bug.findMany.mockResolvedValue([row(), row({ id: "b10", number: 10, duplicateOfId: "b1", duplicateOf: { number: 1 }, confirmations: [] })]);
    db.bugActivity.findMany.mockResolvedValue([{ bugId: "b10", createdAt: daysAgo(3) }]);
    db.membership.findFirst.mockResolvedValue({ userId: "owner-1" });
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    mocks.lockedRow.mockResolvedValue({ status: "open", substatus: "open", isBoosted: false });
  });

  it("does nothing when off", async () => {
    const res = await sweepPipelineCleanup({ mode: "off", now });
    expect(res).toMatchObject({ found: 0, closed: 0 });
    expect(db.bug.findMany).not.toHaveBeenCalled();
  });

  it("only counts in a dry run", async () => {
    const res = await sweepPipelineCleanup({ mode: "dry_run", now });
    expect(res).toMatchObject({ found: 2, closed: 0, byReason: { rejected: 1, duplicate: 1 } });
    expect(mocks.closeInTransaction).not.toHaveBeenCalled();
  });

  it("closes each issue with its reason, rechecked under the lock", async () => {
    db.bug.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "b9" ? row() : row({ id: "b10", number: 10, duplicateOfId: "b1", confirmations: [] }));
    const res = await sweepPipelineCleanup({ mode: "on", now });
    expect(res).toMatchObject({ found: 2, closed: 2, skipped: 0 });
    const reasons = mocks.closeInTransaction.mock.calls.map((call) => call[5].reason);
    expect(reasons.sort()).toEqual(["duplicate", "rejected"]);
    const dup = mocks.closeInTransaction.mock.calls.find((call) => call[5].reason === "duplicate");
    expect(dup?.[5].duplicateOfId).toBe("b1");
    expect(dup?.[1]).toMatchObject({ userId: "owner-1", agentId: null });
  });

  it("skips an issue that changed before it was locked", async () => {
    db.bug.findUnique.mockResolvedValue(row({ confirmations: [{ verdict: "confirm", updatedAt: daysAgo(4) }] }));
    mocks.lockedRow.mockResolvedValueOnce({ status: "in_progress", substatus: "in_progress", isBoosted: false });
    const res = await sweepPipelineCleanup({ mode: "on", now });
    expect(res.closed).toBe(0);
    expect(res.skipped).toBe(2);
  });

  it("skips, without failing the batch, when a close is refused", async () => {
    db.bug.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "b9" ? row() : row({ id: "b10", number: 10, duplicateOfId: "b1", confirmations: [] }));
    mocks.closeInTransaction.mockRejectedValueOnce(new Error("refused"));
    const res = await sweepPipelineCleanup({ mode: "on", now });
    expect(res).toMatchObject({ closed: 1, skipped: 1 });
  });
});
