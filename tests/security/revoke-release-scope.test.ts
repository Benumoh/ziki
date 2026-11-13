import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agents/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-api/events", () => ({ publish: vi.fn(async () => undefined) }));

import { releaseWorkOfRevokedAgent } from "@/lib/agent-api/revoke-release";

describe("handing back a removed agent's work", () => {
  it("only touches the organisation it is removed from, so its work elsewhere carries on", async () => {
    type Where = { where: Record<string, unknown> };
    const findMany = vi.fn<(query: Where) => Promise<never[]>>(async () => []);
    const updateMany = vi.fn<(query: Where) => Promise<{ count: number }>>(async () => ({ count: 0 }));
    const tx = { issueClaim: { findMany }, issueBid: { updateMany } };
    await releaseWorkOfRevokedAgent(tx as never, { agentId: "a1", organisationId: "client", actorUserId: "owner", now: new Date() });
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ agentId: "a1", bug: { organisationId: "client" } });
    expect(updateMany.mock.calls[0]![0].where).toMatchObject({ agentId: "a1", bug: { organisationId: "client" } });
  });

  it("leaves a kept issue's claim and bids alone and still hands back the rest (an on-call guest's delivered task)", async () => {
    type Claim = { id: string; bugId: string; status: string; beneficiaryUserId: string; releasedAt: Date | null };
    type Bid = { id: string; bugId: string; withdrawnAt: Date | null };
    type BugFilter = { organisationId?: string; id?: { notIn: string[] } };
    const claims: Claim[] = [
      { id: "c-delivered", bugId: "bug-delivered", status: "active", beneficiaryUserId: "owner", releasedAt: null },
      { id: "c-other", bugId: "bug-other", status: "active", beneficiaryUserId: "owner", releasedAt: null },
    ];
    const bids: Bid[] = [
      { id: "b-delivered", bugId: "bug-delivered", withdrawnAt: null },
      { id: "b-other", bugId: "bug-third", withdrawnAt: null },
    ];
    const kept = (bugId: string, bug?: BugFilter) => !bug?.id?.notIn.includes(bugId);
    const tx = {
      $queryRaw: vi.fn(async () => []),
      issueClaim: {
        findMany: vi.fn(async ({ where }: { where: { bug?: BugFilter } }) =>
          claims.filter((c) => c.releasedAt === null && kept(c.bugId, where.bug)).map(({ id, bugId }) => ({ id, bugId }))),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => claims.find((c) => c.id === where.id && c.releasedAt === null) ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { releasedAt: Date } }) => {
          const claim = claims.find((c) => c.id === where.id)!;
          claim.releasedAt = data.releasedAt;
          return claim;
        }),
        count: vi.fn(async () => 0),
      },
      issueBid: {
        updateMany: vi.fn(async ({ where, data }: { where: { bug?: BugFilter }; data: { withdrawnAt: Date } }) => {
          const hit = bids.filter((b) => b.withdrawnAt === null && kept(b.bugId, where.bug));
          for (const bid of hit) bid.withdrawnAt = data.withdrawnAt;
          return { count: hit.length };
        }),
      },
      bug: { findUnique: vi.fn(async () => ({ assigneeId: "owner", assignee: { name: "Owner" } })), updateMany: vi.fn(async () => ({ count: 0 })) },
      bugActivity: { createMany: vi.fn(async () => ({ count: 0 })) },
    };

    const result = await releaseWorkOfRevokedAgent(tx as never, {
      agentId: "a1", organisationId: "client", actorUserId: "owner", now: new Date(), keepIssueIds: ["bug-delivered"],
    });

    expect(result).toEqual({ releasedClaims: 1, withdrawnBids: 1 });
    expect(claims.find((c) => c.id === "c-delivered")!.releasedAt).toBeNull();
    expect(claims.find((c) => c.id === "c-other")!.releasedAt).not.toBeNull();
    expect(bids.find((b) => b.id === "b-delivered")!.withdrawnAt).toBeNull();
    expect(bids.find((b) => b.id === "b-other")!.withdrawnAt).not.toBeNull();
  });
});
