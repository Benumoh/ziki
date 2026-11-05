import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { agentApiKey: { findUnique, update } } }));

import { generateApiKey, hashSecret } from "@/lib/agents/keys";
import { AgentLevelError } from "@/lib/agents/levels";
import { AgentAuthError, agentErrorResponse, requireAgent } from "@/lib/agents/require-agent";

const KEY = "ziki_valid-key-for-tests";
const request = (authorization?: string) => ({
  headers: { get: (name: string) => (name === "authorization" ? (authorization ?? null) : null) },
});

function keyRow(overrides: {
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
  agent?: Record<string, unknown>;
} = {}) {
  return {
    id: "key1",
    lastUsedAt: overrides.lastUsedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    projectId: null,
    project: null,
    agent: {
      id: "agent1",
      name: "Ada's Claude",
      ownerUserId: "ada",
      tenantId: "tenant_zedu",
      level: "working",
      burst: false,
      revokedAt: null,
      // A set-up profile, so the work gate lets the key through.
      username: "adas-claude",
      tagline: "Patient bug hunter",
      about: "I reproduce first.",
      _count: { skills: 1 },
      owner: { role: "user", memberships: [{ tenantId: "tenant_zedu" }] },
      ...overrides.agent,
    },
  };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as AgentAuthError;
  }
  throw new Error("expected requireAgent to reject");
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
});

/** Agent keys (#427): a valid key resolves its agent; missing, malformed, wrong, revoked and foreign keys are refused. */
describe("requireAgent (#427)", () => {
  it("rejects a request with no key without touching the database", async () => {
    expect((await failure(requireAgent(request()))).code).toBe("missing_key");
    expect((await failure(requireAgent(request("Bearer")))).code).toBe("missing_key");
    expect((await failure(requireAgent(request("   ")))).code).toBe("missing_key");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("calls a sent-but-unusable header a bad key, not a missing one (#467)", async () => {
    // Each of these *did* send a key; only its shape is wrong.
    for (const header of ["Basic abc", "Bearer bad", "Bearer a b", 'Bearer "ziki_abc"', "Bearer sk-other"]) {
      expect((await failure(requireAgent(request(header)))).code).toBe("invalid_key");
    }
    // A malformed header never reaches the database.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects a key that matches nothing", async () => {
    findUnique.mockResolvedValue(null);
    expect((await failure(requireAgent(request("Bearer ziki_wrong")))).code).toBe("invalid_key");
    expect(findUnique.mock.calls[0][0].where).toEqual({ keyHash: hashSecret("ziki_wrong") });
  });

  it("resolves a valid key to the agent, its owner, tenant and level", async () => {
    findUnique.mockResolvedValue(keyRow());
    await expect(requireAgent(request(`Bearer ${KEY}`))).resolves.toEqual({
      agentId: "agent1",
      name: "Ada's Claude",
      ownerId: "ada",
      tenantId: "tenant_zedu",
      level: "working",
      ownerRole: "user",
      burst: false,
      burstUntil: null,
      keyId: "key1",
      projectId: null,
      projectSlug: null,
    });
    // Looked up by hash only; the raw key never reaches the query.
    expect(JSON.stringify(findUnique.mock.calls[0][0])).not.toContain(KEY);
  });

  it("rejects a revoked key, and every key of a revoked agent", async () => {
    findUnique.mockResolvedValue(keyRow({ revokedAt: new Date() }));
    expect((await failure(requireAgent(request(`Bearer ${KEY}`)))).code).toBe("revoked");
    findUnique.mockResolvedValue(keyRow({ agent: { revokedAt: new Date() } }));
    expect((await failure(requireAgent(request(`Bearer ${KEY}`)))).code).toBe("revoked");
  });

  it("carries the project a key is limited to", async () => {
    findUnique.mockResolvedValue({ ...keyRow(), projectId: "project_web", project: { slug: "web" } });
    await expect(requireAgent(request(`Bearer ${KEY}`))).resolves.toMatchObject({
      projectId: "project_web",
      projectSlug: "web",
    });
  });

  it("rejects an agent whose owner has left its tenant", async () => {
    findUnique.mockResolvedValue(keyRow({ agent: { owner: { memberships: [{ tenantId: "other" }] } } }));
    expect((await failure(requireAgent(request(`Bearer ${KEY}`)))).code).toBe("invalid_key");
  });

  it("keeps only a key's hash, never the raw key", () => {
    const key = generateApiKey();
    expect(key.hash).toBe(hashSecret(key.raw));
    expect(key.hash).not.toContain(key.raw);
    expect(generateApiKey().raw).not.toBe(key.raw);
  });
});

describe("agentErrorResponse", () => {
  it("is 401 for key problems and 403 for a low level", async () => {
    const unauthorized = agentErrorResponse(new AgentAuthError("missing_key"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toContain("Bearer");
    const forbidden = agentErrorResponse(new AgentLevelError("manager"));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: "insufficient_level", required: "manager" });
  });
});

describe("the work gate (#agent-work-gate)", () => {
  const ready = { tagline: "Patient bug hunter", about: "I reproduce first.", skillCount: 1 };

  it("lets an agent with a set-up profile work, and names what an unfinished one lacks", async () => {
    const { missingProfileFields } = await import("@/lib/agents/work-gate");
    expect(missingProfileFields(ready)).toEqual([]);
    expect(missingProfileFields({ tagline: null, about: "  ", skillCount: 0 })).toEqual(["tagline", "about", "skills"]);
  });

  it("refuses every route to an unfinished profile except setting the profile up", async () => {
    const { assertAgentMayWork, AgentWorkBlockedError } = await import("@/lib/agents/work-gate");
    const agent = { username: "ada-claude", tagline: null, about: null, skillCount: 0 };
    const at = (method: string, path: string) => ({ method, url: `http://localhost${path}` });
    for (const [method, path] of [
      ["GET", "/api/v1/agents/me"],
      ["PATCH", "/api/v1/agents/me"],
      ["PUT", "/api/v1/agents/me/skills"],
      ["PUT", "/api/v1/agents/me/skills/postgres"],
      ["PUT", "/api/v1/agents/me/picture"],
      ["GET", "/api/v1/skill-tags"],
      ["GET", "/api/v1/agents/someone"],
    ]) {
      expect(() => assertAgentMayWork(agent, at(method, path)), `${method} ${path}`).not.toThrow();
    }
    for (const [method, path] of [
      ["GET", "/demo/work"],
      ["POST", "/api/v1/ideas"],
      ["POST", "/api/v1/issues/abc/bid"],
      ["GET", "/api/v1/projects"],
      ["POST", "/api/v1/agents/me/skills"],
      ["GET", "/api/v1/agents/me/history"],
    ]) {
      expect(() => assertAgentMayWork(agent, at(method, path)), `${method} ${path}`).toThrow(AgentWorkBlockedError);
    }
    expect(() => assertAgentMayWork({ ...ready, username: "ada-claude" }, at("POST", "/api/v1/ideas"))).not.toThrow();
  });
});
