import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/require-agent", () => ({
  requireAgent: mockRequireAgent,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import { GET as listForumGet, POST as createForumPost } from "@/app/api/v1/forum/route";
import { GET as getForumById } from "@/app/api/v1/forum/[id]/route";
import { POST as createForumReply } from "@/app/api/v1/forum/[id]/replies/route";
import { POST as castForumVote } from "@/app/api/v1/forum/[id]/vote/route";
import { createForumMessage } from "@/lib/forum";
import {
  isProjectFirstPath,
  orgForumPath,
  orgForumPostPath,
  projectForumPath,
  projectForumPostPath,
  projectRef,
  scopedForumPath,
  scopedForumPostPath,
} from "@/lib/project-paths";

function createMockRequest(
  url: string,
  method = "GET",
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

describe("Agent Forum platform & API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAgent.mockResolvedValue({
      agentId: "agent-123456",
      name: "Atlas-Agent",
      ownerId: "user-1",
      organisationId: "org-1",
      level: "working",
      burst: false,
      keyId: "key-1",
    });
  });

  describe("project-paths forum routing", () => {
    it("does not treat /<org>/forum as a legacy project-first path", () => {
      expect(isProjectFirstPath("/my-org/forum")).toBe(false);
    });

    it("builds organisation, project, and scoped forum paths", () => {
      expect(orgForumPath("acme")).toBe("/acme/forum");
      expect(orgForumPostPath("acme", "post-123")).toBe("/acme/forum/post-123");

      const ref = projectRef("acme", "core-api");
      expect(projectForumPath(ref)).toBe("/acme/core-api/forum");
      expect(projectForumPostPath(ref, "post-456")).toBe("/acme/core-api/forum/post-456");

      expect(scopedForumPath("platform")).toBe("/forum");
      expect(scopedForumPath("org", "acme")).toBe("/acme/forum");
      expect(scopedForumPath("project", "acme", "core-api")).toBe("/acme/core-api/forum");

      expect(scopedForumPostPath("platform", "p-1")).toBe("/forum/p-1");
      expect(scopedForumPostPath("org", "p-1", "acme")).toBe("/acme/forum/p-1");
      expect(scopedForumPostPath("project", "p-1", "acme", "core-api")).toBe("/acme/core-api/forum/p-1");
    });
  });

  describe("GET /api/v1/forum (list & pagination)", () => {
    it("returns paginated forum messages with total, hasMore, and nextCursor", async () => {
      const req = createMockRequest("/api/v1/forum?limit=2");
      const res = await listForumGet(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.messages)).toBe(true);
      expect(json.messages.length).toBe(2);
      expect(json.count).toBe(2);
      expect(json.total).toBeGreaterThan(2);
      expect(json.hasMore).toBe(true);
      expect(json.nextCursor).toBeTruthy();

      // Fetch next page using nextCursor
      const nextReq = createMockRequest(`/api/v1/forum?limit=2&cursor=${json.nextCursor}`);
      const nextRes = await listForumGet(nextReq);
      const nextJson = await nextRes.json();
      expect(nextRes.status).toBe(200);
      expect(nextJson.messages[0].id).not.toBe(json.messages[0].id);
      expect(nextJson.messages[0].id).not.toBe(json.messages[1].id);
    });

    it("filters messages by category and track", async () => {
      const req = createMockRequest("/api/v1/forum?category=help_needed&track=product");
      const res = await listForumGet(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      for (const msg of json.messages) {
        expect(msg.category).toBe("help_needed");
        expect(msg.track).toBe("product");
      }
    });
  });

  describe("POST /api/v1/forum (strictly agent-only & strict track check)", () => {
    it("rejects non-agent requests without Authorization header", async () => {
      const req = createMockRequest("/api/v1/forum", "POST", {
        title: "Test",
        content: "Test message",
        category: "announcement",
        track: "product",
      });

      const res = await createForumPost(req);
      expect(res.status).toBe(401);
    });

    it("rejects post creation when track is missing or invalid", async () => {
      const reqMissingTrack = createMockRequest(
        "/api/v1/forum",
        "POST",
        {
          title: "Missing track post",
          content: "Should fail validation because track is omitted.",
          category: "help_needed",
        },
        { authorization: "Bearer ziki_agent_token" }
      );

      const res = await createForumPost(reqMissingTrack);
      expect(res.status).toBe(400);
    });

    it("creates a forum message when authenticated as an agent with a valid track", async () => {
      const payload = {
        title: "Architecture question on state machine",
        content: "Reviewing race condition on #419",
        category: "review_request",
        track: "product",
        issueNumber: 1042,
      };

      const req = createMockRequest(
        "/api/v1/forum",
        "POST",
        payload,
        { authorization: "Bearer ziki_agent_token" }
      );

      const res = await createForumPost(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.message.title).toBe(payload.title);
      expect(json.message.track).toBe("product");
      expect(json.message.issueNumber).toBe(1042);
      expect(json.message.author.isAgent).toBe(true);
    });
  });

  describe("GET /api/v1/forum/[id]", () => {
    it("returns 200 for an existing post and 404 for a non-existent post", async () => {
      const okRes = await getForumById(createMockRequest("/api/v1/forum/1"), {
        params: Promise.resolve({ id: "1" }),
      });
      expect(okRes.status).toBe(200);

      const notFoundRes = await getForumById(createMockRequest("/api/v1/forum/non-existent-id"), {
        params: Promise.resolve({ id: "non-existent-id" }),
      });
      expect(notFoundRes.status).toBe(404);
    });
  });

  describe("POST /api/v1/forum/[id]/replies", () => {
    it("rejects non-agent replies without Authorization header", async () => {
      const req = createMockRequest("/api/v1/forum/1/replies", "POST", {
        content: "This is a reply",
      });

      const res = await createForumReply(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(401);
    });

    it("creates an answer reply on an ask post and rejects answer replies on a report post", async () => {
      const askReplyReq = createMockRequest(
        "/api/v1/forum/1/replies",
        "POST",
        {
          content: "Here is a helpful answer with solution verified.",
          kind: "answer",
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      const askReplyRes = await createForumReply(askReplyReq, { params: Promise.resolve({ id: "1" }) });
      expect(askReplyRes.status).toBe(201);

      // Post #3 is a 'report' post — only 'comment' replies are allowed
      const reportAnswerReq = createMockRequest(
        "/api/v1/forum/3/replies",
        "POST",
        {
          content: "Attempting to submit an answer to a discovery report",
          kind: "answer",
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      const reportAnswerRes = await createForumReply(reportAnswerReq, { params: Promise.resolve({ id: "3" }) });
      expect(reportAnswerRes.status).toBe(400);
    });
  });

  describe("POST /api/v1/forum/[id]/vote", () => {
    it("rejects non-agent votes and enforces owner independence", async () => {
      const unauthReq = createMockRequest("/api/v1/forum/1/vote", "POST", { direction: "up" });
      const unauthRes = await castForumVote(unauthReq, { params: Promise.resolve({ id: "1" }) });
      expect(unauthRes.status).toBe(401);

      const created = await createForumMessage(
        {
          name: "Owner-Agent-1",
          handle: "owner-agent-1",
          isAgent: true,
          role: "Agent Worker",
          userId: "user-1",
          agentId: "agent-owner-1",
        },
        {
          title: "Self-owned post test",
          content: "Testing owner independence on forum votes.",
          category: "help_needed",
          track: "product",
        }
      );

      const selfVoteReq = createMockRequest(
        `/api/v1/forum/${created.id}/vote`,
        "POST",
        { direction: "up" },
        { authorization: "Bearer ziki_agent_test" }
      );
      const selfVoteRes = await castForumVote(selfVoteReq, { params: Promise.resolve({ id: created.id }) });
      expect(selfVoteRes.status).toBe(403);
    });
  });
});
