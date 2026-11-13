import { describe, expect, it, vi } from "vitest";
import { cancelOnCallInvite, inviteToOnCall, rankCandidates, respondToOnCallInvite } from "@/lib/security-checks/on-call";

/** A fake Prisma client: every model method is a mock, and $transaction runs the callback on the same fake. */
function fakeDb() {
  const db = {
    agent: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    onCallInvite: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  return db;
}
const asDb = (db: ReturnType<typeof fakeDb>) => db as never;
const now = new Date("2026-11-13T10:00:00Z");

describe("who Ziki recommends for on call (#on-call)", () => {
  it("puts agents meeting the bar first, then by active hours a day, fixes and rating", () => {
    const ranked = rankCandidates([
      { agentId: "busy-low", activeHours: 100, activeDays: 14, fixes: 9, rating: 4.9 },
      { agentId: "bar", activeHours: 14 * 12, activeDays: 14, fixes: 0, rating: null },
      { agentId: "busy-high", activeHours: 120, activeDays: 14, fixes: 1, rating: 3 },
    ]);
    expect(ranked.map((c) => c.agentId)).toEqual(["bar", "busy-high", "busy-low"]);
    expect(ranked[0]).toMatchObject({ hoursPerDay: 12, meetsBar: true });
    expect(ranked[1]!.meetsBar).toBe(false);
  });
});

describe("inviting an agent to go on call (#on-call)", () => {
  const agent = { id: "a1", name: "AGALA", ownerUserId: "owner", revokedAt: null, onCallAt: null, onCallInvites: [] };

  it("creates the invite and tells the owner in their inbox", async () => {
    const db = fakeDb();
    db.agent.findUnique.mockResolvedValue(agent);
    db.onCallInvite.create.mockResolvedValue({ id: "inv1" });
    expect(await inviteToOnCall(asDb(db), { username: "@AGALA", invitedById: "admin", clearForSecurity: true })).toEqual({ inviteId: "inv1" });
    expect(db.agent.findUnique.mock.calls[0][0].where).toEqual({ username: "agala" });
    expect(db.onCallInvite.create.mock.calls[0][0].data).toEqual({ agentId: "a1", invitedById: "admin", clearForSecurity: true });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ userId: "owner", kind: "on_call_invite" });
  });

  it("refuses an unknown, revoked, already on-call or already invited agent", async () => {
    const cases: [unknown, string][] = [
      [null, "not_found"],
      [{ ...agent, revokedAt: now }, "revoked"],
      [{ ...agent, onCallAt: now }, "already_on_call"],
      [{ ...agent, onCallInvites: [{ id: "old" }] }, "already_invited"],
    ];
    for (const [found, code] of cases) {
      const db = fakeDb();
      db.agent.findUnique.mockResolvedValue(found);
      await expect(inviteToOnCall(asDb(db), { agentId: "a1", invitedById: "admin", clearForSecurity: false })).rejects.toMatchObject({ code });
      expect(db.onCallInvite.create).not.toHaveBeenCalled();
    }
  });

  it("lets a super admin withdraw only a pending invite", async () => {
    const db = fakeDb();
    db.onCallInvite.updateMany.mockResolvedValue({ count: 0 });
    await expect(cancelOnCallInvite(asDb(db), "inv1", now)).rejects.toMatchObject({ code: "not_pending" });
  });
});

describe("the owner answering an invite (#on-call)", () => {
  const invite = (clearForSecurity: boolean) => ({ id: "inv1", status: "pending", clearForSecurity, agentId: "a1", agent: { ownerUserId: "owner", revokedAt: null } });

  it("accepting puts the agent on call, and clears it for security only when the invite says so", async () => {
    for (const clear of [true, false]) {
      const db = fakeDb();
      db.onCallInvite.findUnique.mockResolvedValue(invite(clear));
      db.onCallInvite.updateMany.mockResolvedValue({ count: 1 });
      await respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "owner", accept: true }, now);
      expect(db.agent.update.mock.calls[0][0]).toEqual({ where: { id: "a1" }, data: clear ? { onCallAt: now, securityClearedAt: now } : { onCallAt: now } });
    }
  });

  it("declining changes nothing on the agent", async () => {
    const db = fakeDb();
    db.onCallInvite.findUnique.mockResolvedValue(invite(true));
    db.onCallInvite.updateMany.mockResolvedValue({ count: 1 });
    await respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "owner", accept: false }, now);
    expect(db.onCallInvite.updateMany.mock.calls[0][0].data).toMatchObject({ status: "declined" });
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("only the agent's owner may answer, and only once", async () => {
    const db = fakeDb();
    db.onCallInvite.findUnique.mockResolvedValue(invite(false));
    await expect(respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "someone-else", accept: true }, now)).rejects.toMatchObject({ code: "not_yours" });
    db.onCallInvite.updateMany.mockResolvedValue({ count: 0 });
    await expect(respondToOnCallInvite(asDb(db), { inviteId: "inv1", userId: "owner", accept: true }, now)).rejects.toMatchObject({ code: "not_pending" });
    expect(db.agent.update).not.toHaveBeenCalled();
  });
});
