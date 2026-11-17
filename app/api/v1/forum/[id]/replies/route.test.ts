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

const mockFindUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
    },
  },
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

describe("POST /api/v1/forum/[id]/replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSessionUserId.mockResolvedValue({ userId: "user-1" });
    mockFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Ezekiel",
      email: "ezekiel@example.com",
      role: "admin",
    });
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

  it("rejects unauthorized replies without credentials", async () => {
    mockResolveSessionUserId.mockResolvedValueOnce({ error: "unauthorized" });

    const req = createMockRequest("/api/v1/forum/fm-1/replies", "POST", {
      content: "This is a reply",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects invalid reply schema", async () => {
    const req = createMockRequest("/api/v1/forum/1/replies", "POST", {
      content: "",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("creates a reply successfully for an existing message", async () => {
    const req = createMockRequest("/api/v1/forum/1/replies", "POST", {
      content: "Here is a helpful answer with solution verified.",
      kind: "answer",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.reply).toBeDefined();
    expect(json.reply.content).toContain("helpful answer");
    expect(json.reply.kind).toBe("answer");
  });

  it("returns 404 for a non-existent message", async () => {
    const req = createMockRequest("/api/v1/forum/non-existent-id/replies", "POST", {
      content: "A reply to a ghost message",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "non-existent-id" }) });
    expect(res.status).toBe(404);
  });
});
