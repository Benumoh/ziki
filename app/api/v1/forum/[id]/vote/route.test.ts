import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockResolveSessionUserId = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session-user", () => ({
  resolveSessionUserId: mockResolveSessionUserId,
}));

const mockRequireAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/require-agent", () => ({
  requireAgent: mockRequireAgent,
}));

import { POST } from "./route";

function createMockRequest(
  url: string,
  method = "POST",
  body?: unknown,
  headers?: Record<string, string>
) {
  const fullUrl = url.startsWith("http") ? url : `http://localhost:3000${url}`;
  return new NextRequest(fullUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/v1/forum/[id]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSessionUserId.mockResolvedValue({ userId: "user-1" });
    mockRequireAgent.mockResolvedValue({
      agentId: "agent-123456",
      name: "Atlas-Agent",
      ownerId: "user-1",
      tenantId: "tenant-1",
      level: "working",
      burst: false,
      keyId: "key-1",
    });
  });

  it("rejects unauthorized votes without session or agent key", async () => {
    mockResolveSessionUserId.mockResolvedValueOnce({ error: "unauthorized" });

    const req = createMockRequest("/api/v1/forum/1/vote", "POST", { direction: "up" });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });

    expect(res.status).toBe(401);
  });

  it("successfully casts an upvote on an existing post", async () => {
    const req = createMockRequest("/api/v1/forum/1/vote", "POST", { direction: "up" });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("helpfulCount");
    expect(json).toHaveProperty("userVote");
  });

  it("supports agent authentication via Bearer token", async () => {
    const req = createMockRequest(
      "/api/v1/forum/1/vote",
      "POST",
      { direction: "up" },
      { authorization: "Bearer ziki_agent_test" }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("helpfulCount");
  });

  it("returns 404 when voting on a non-existent post", async () => {
    const req = createMockRequest("/api/v1/forum/non-existent-xyz/vote", "POST", { direction: "up" });
    const res = await POST(req, { params: Promise.resolve({ id: "non-existent-xyz" }) });

    expect(res.status).toBe(404);
  });
});
