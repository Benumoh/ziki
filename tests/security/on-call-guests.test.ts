import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn(), update: vi.fn() },
  agentActivation: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
  organisation: { findUnique: vi.fn() },
}));
const release = vi.hoisted(() => vi.fn(async () => ({ releasedClaims: 1, withdrawnBids: 0 })));
const audit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/revoke-release", () => ({ releaseWorkOfRevokedAgent: release }));
vi.mock("@/lib/agents/audit", () => ({ audit }));

import { requireAgent } from "@/lib/agents/require-agent";
import { guestOrganisationFor, LIVE_GUEST } from "@/lib/agents/guest-access";
import { addOnCallGuests, endGuestStay, GUEST_STAYS_PER_AGENT, pickFreeOnCallAgents } from "@/lib/on-call-guests";
import { ON_CALL_GUESTS_PER_NEW_WORKSPACE } from "@/lib/security-checks";

const NOW = new Date("2026-11-12T22:00:00Z");
/** A fixed "random" so the picks are predictable: always keep the order. */
const noShuffle = () => 0.999;

beforeEach(() => vi.clearAllMocks());

describe("picking free on-call agents (12 Nov plan, D2)", () => {
  it("asks only for on-call agents that are live, unpaused, recently seen and not the creator's", async () => {
    const findMany = vi.fn(async () => []);
    await pickFreeOnCallAgents({ agent: { findMany } } as never, 3, { excludeOwnerIds: ["creator"], now: NOW });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        onCallAt: { not: null },
        revokedAt: null,
        pausedAt: null,
        ownerUserId: { notIn: ["creator"] },
        apiKeys: { some: { revokedAt: null, lastUsedAt: { gte: new Date(NOW.getTime() - 15 * 60 * 1000) } } },
      },
    }));
  });

  it("skips agents already on enough guest stays, takes one agent per owner, and at most n", async () => {
    const agents = [
      { id: "a1", ownerUserId: "ada", _count: { activations: 0 } },
      { id: "a2", ownerUserId: "ada", _count: { activations: 0 } },
      { id: "b1", ownerUserId: "bola", _count: { activations: GUEST_STAYS_PER_AGENT } },
      { id: "c1", ownerUserId: "chi", _count: { activations: 1 } },
      { id: "d1", ownerUserId: "dami", _count: { activations: 2 } },
    ];
    const picked = await pickFreeOnCallAgents({ agent: { findMany: async () => agents } } as never, 2, { now: NOW, random: noShuffle });
    expect(picked).toEqual([
      { id: "a1", ownerUserId: "ada" },
      { id: "c1", ownerUserId: "chi" },
    ]);
  });
});

describe("adding guests to a new workspace", () => {
  it("adds free on-call agents as working guests, never the creator's own", async () => {
    const createMany = vi.fn(async () => ({ count: 2 }));
    type Candidate = { id: string; ownerUserId: string; _count: { activations: number } };
    const findMany = vi.fn<(query: { where: { ownerUserId: unknown } }) => Promise<Candidate[]>>(async () => [
      { id: "a1", ownerUserId: "ada", _count: { activations: 0 } },
      { id: "c1", ownerUserId: "chi", _count: { activations: 0 } },
    ]);
    const added = await addOnCallGuests({ agent: { findMany }, agentActivation: { createMany } } as never, { organisationId: "new-org", creatorId: "creator" }, { now: NOW, random: noShuffle });
    expect(added).toEqual(["a1", "c1"]);
    expect(findMany.mock.calls[0]![0].where.ownerUserId).toEqual({ notIn: ["creator"] });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { agentId: "a1", organisationId: "new-org", level: "working", guestUntilFirstDelivery: true },
        { agentId: "c1", organisationId: "new-org", level: "working", guestUntilFirstDelivery: true },
      ],
      skipDuplicates: true,
    });
    expect(ON_CALL_GUESTS_PER_NEW_WORKSPACE).toBeGreaterThanOrEqual(2);
  });

  it("adds nobody when nobody is free, and never fails the workspace on an error", async () => {
    const createMany = vi.fn();
    expect(await addOnCallGuests({ agent: { findMany: async () => [] }, agentActivation: { createMany } } as never, { organisationId: "o", creatorId: "c" })).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { agent: { findMany: async () => { throw new Error("db down"); } } };
    await expect(addOnCallGuests(broken as never, { organisationId: "o", creatorId: "c" })).resolves.toEqual([]);
    spy.mockRestore();
  });
});

describe("ending a guest stay", () => {
  it("switches the guest off in that workspace only and hands back its work there", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = { agentActivation: { updateMany } };
    expect(await endGuestStay(tx as never, { agentId: "a1", organisationId: "client", actorUserId: "ada", reason: "first_delivery", now: NOW })).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { agentId: "a1", organisationId: "client", ...LIVE_GUEST },
      data: { guestEndedAt: NOW, deactivatedAt: NOW },
    });
    expect(release).toHaveBeenCalledWith(tx, { agentId: "a1", organisationId: "client", actorUserId: "ada", now: NOW, keepIssueIds: [] });
  });

  it("keeps the claim on the task it just delivered and hands back only its other work", async () => {
    const tx = { agentActivation: { updateMany: vi.fn(async () => ({ count: 1 })) } };
    await endGuestStay(tx as never, { agentId: "a1", organisationId: "client", actorUserId: "ada", reason: "first_delivery", deliveredIssueId: "bug-delivered", now: NOW });
    expect(release).toHaveBeenCalledWith(tx, expect.objectContaining({ keepIssueIds: ["bug-delivered"] }));
  });

  it("does nothing for an agent that isn't a live guest there (a normal member's agent stays)", async () => {
    const tx = { agentActivation: { updateMany: vi.fn(async () => ({ count: 0 })) } };
    expect(await endGuestStay(tx as never, { agentId: "a1", organisationId: "home", actorUserId: "ada", reason: "first_delivery" })).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });
});

describe("which workspace a guest's call is for", () => {
  const stays = [{ organisationId: "client" }];

  it("is the guest workspace when the request names a project or work feed there", async () => {
    db.project.findUnique.mockResolvedValueOnce({ organisationId: "client" });
    expect(await guestOrganisationFor(db as never, "https://ziki.dev/api/v1/issues?projectId=p-client", stays)).toBe("client");
    db.organisation.findUnique.mockResolvedValueOnce({ id: "client" });
    expect(await guestOrganisationFor(db as never, "https://ziki.dev/client-co/web/work", stays)).toBe("client");
  });

  it("stays home for anything else, and costs nothing for agents with no guest stays", async () => {
    db.project.findUnique.mockResolvedValueOnce({ organisationId: "someone-else" });
    expect(await guestOrganisationFor(db as never, "https://ziki.dev/api/v1/issues?projectId=p-other", stays)).toBeNull();
    expect(await guestOrganisationFor(db as never, "https://ziki.dev/api/v1/agents/me", stays)).toBeNull();
    vi.clearAllMocks();
    expect(await guestOrganisationFor(db as never, "https://ziki.dev/api/v1/issues?projectId=p-client", [])).toBeNull();
    expect(db.project.findUnique).not.toHaveBeenCalled();
  });
});

describe("requireAgent for an on-call guest", () => {
  const KEY = "ziki_valid-key-for-tests";
  const keyRow = (activations: { organisationId: string; burst: boolean; burstUntil: Date | null }[]) => ({
    id: "key1",
    lastUsedAt: NOW,
    revokedAt: null,
    organisationId: "home",
    agent: {
      id: "agent1",
      name: "Ada's Claude",
      ownerUserId: "ada",
      revokedAt: null,
      username: "adas-claude",
      tagline: "Patient bug hunter",
      about: "I reproduce first.",
      _count: { skills: 1 },
      pausedAt: null,
      // A super admin at home, and not a member of the client's workspace.
      owner: { role: "super_admin", memberships: [{ organisationId: "home" }] },
      activations,
    },
  });
  const call = (url?: string) => ({
    headers: { get: (name: string) => (name === "authorization" ? `Bearer ${KEY}` : null) },
    method: "GET",
    url,
  });

  beforeEach(() => {
    db.agentActivation.findUnique.mockResolvedValue({ level: "manager", burst: false, burstUntil: null, deactivatedAt: null });
  });

  it("runs in the client's workspace as a working agent, with no admin powers and no membership there", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(keyRow([{ organisationId: "client", burst: false, burstUntil: null }]));
    db.project.findUnique.mockResolvedValue({ organisationId: "client" });
    const agent = await requireAgent(call("https://ziki.dev/api/v1/issues?projectId=p-client"));
    expect(agent).toMatchObject({ organisationId: "client", level: "working", ownerRole: null, guest: true });
    // The key lookup reads only live guest stays.
    expect(db.agentApiKey.findUnique.mock.calls[0]![0].select.agent.select.activations.where).toEqual(LIVE_GUEST);
  });

  it("stays in the key's own workspace, with its own class, everywhere else", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(keyRow([{ organisationId: "client", burst: false, burstUntil: null }]));
    db.project.findUnique.mockResolvedValue({ organisationId: "home" });
    const home = await requireAgent(call("https://ziki.dev/api/v1/issues?projectId=p-home"));
    expect(home).toMatchObject({ organisationId: "home", level: "manager", ownerRole: "super_admin" });
    expect(home.guest).toBeUndefined();

    // A workspace it isn't a guest in can't be reached by naming its project.
    db.project.findUnique.mockResolvedValue({ organisationId: "stranger" });
    expect(await requireAgent(call("https://ziki.dev/api/v1/issues?projectId=p-stranger"))).toMatchObject({ organisationId: "home" });
  });

  it("can't use a stay that has ended: the key lookup only ever returns live ones", async () => {
    // Ended or removed stays aren't returned by the LIVE_GUEST filter, so the agent has none.
    db.agentApiKey.findUnique.mockResolvedValue(keyRow([]));
    db.project.findUnique.mockResolvedValue({ organisationId: "client" });
    expect(await requireAgent(call("https://ziki.dev/api/v1/issues?projectId=p-client"))).toMatchObject({ organisationId: "home" });
    expect(db.project.findUnique).not.toHaveBeenCalled();
  });
});
