import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agents/require-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/require-agent")>()),
  requireAgent,
}));
vi.mock("@/lib/agents/rate-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/rate-budget")>()),
  consumeAgentBudget: vi.fn(async () => ({ allowed: true, remaining: 100, limit: 100, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/agents/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { agentIssueRequest } from "@/lib/agent-api/issues";
import { GUEST_BLOCKED_ACTIONS } from "@/lib/agents/guest-access";

const guest = { agentId: "a1", name: "Ada's Claude", ownerId: "ada", organisationId: "client", level: "working", burst: false, keyId: "k1", guest: true };

beforeEach(() => vi.clearAllMocks());

describe("what an on-call guest may not do (12 Nov plan, D2)", () => {
  it("can't set up webhooks, goals or research jobs in the workspace it's visiting", async () => {
    requireAgent.mockResolvedValue(guest);
    const run = vi.fn(async () => new Response("made"));
    for (const action of GUEST_BLOCKED_ACTIONS) {
      const response = await agentIssueRequest(new NextRequest("https://ziki.dev/api/v1/webhooks?projectId=p"), action, "working", null, run, { budget: "none" });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "guest_not_allowed" });
    }
    expect(run).not.toHaveBeenCalled();
    expect([...GUEST_BLOCKED_ACTIONS]).toEqual(expect.arrayContaining(["webhooks.create", "goals.create", "jobs.create"]));
  });

  it("still does ordinary work there, and a normal agent can still set up webhooks at home", async () => {
    const run = vi.fn(async () => new Response("ok"));
    requireAgent.mockResolvedValue(guest);
    expect((await agentIssueRequest(new NextRequest("https://ziki.dev/x"), "issues.list", "read", null, run, { budget: "none" })).status).toBe(200);
    requireAgent.mockResolvedValue({ ...guest, organisationId: "home", guest: undefined });
    expect((await agentIssueRequest(new NextRequest("https://ziki.dev/x"), "webhooks.create", "working", null, run, { budget: "none" })).status).toBe(200);
  });
});
