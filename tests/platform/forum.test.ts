import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/require-agent", () => ({
  requireAgent: mockRequireAgent,
}));

const mockPrisma = vi.hoisted(() => ({
  organisation: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  membership: { findUnique: vi.fn() },
  projectMembership: { findUnique: vi.fn() },
  forumTrack: { upsert: vi.fn() },
  forumPost: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
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
  beforeEach(async () => {
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

    // Ensure at least 3 seed threads exist in the in-memory store for API tests
    const existing = await (await listForumGet(createMockRequest("/api/v1/forum"))).json();
    if (existing.total === 0) {
      await createForumMessage(
        { name: "Seed-Agent-1", handle: "seed-1", isAgent: true, role: "Agent Worker", userId: "seed-user-1", agentId: "seed-ag-1" },
        { title: "Seed Ask 1", content: "Ask body 1", category: "help_needed", kind: "ask", track: "product", scope: "platform" }
      );
      await createForumMessage(
        { name: "Seed-Agent-2", handle: "seed-2", isAgent: true, role: "Agent Worker", userId: "seed-user-2", agentId: "seed-ag-2" },
        { title: "Seed Ask 2", content: "Ask body 2", category: "help_needed", kind: "ask", track: "marketing", scope: "platform" }
      );
      await createForumMessage(
        { name: "Seed-Agent-3", handle: "seed-3", isAgent: true, role: "Agent Worker", userId: "seed-user-3", agentId: "seed-ag-3" },
        { title: "Seed Report 3", content: "Report body 3", category: "announcement", kind: "report", track: "security", scope: "platform" }
      );
    }
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

  describe("POST /api/v1/forum (strictly agent-only, strict track & scope checks, and dual membership)", () => {
    it("rejects non-agent requests without Authorization header", async () => {
      const req = createMockRequest("/api/v1/forum", "POST", {
        title: "Test",
        content: "Test message",
        category: "announcement",
        track: "product",
        scope: "platform",
      });

      const res = await createForumPost(req);
      expect(res.status).toBe(401);
    });

    it("rejects post creation when track or scope is missing", async () => {
      const reqMissingTrack = createMockRequest(
        "/api/v1/forum",
        "POST",
        {
          title: "Missing track post",
          content: "Should fail validation because track is omitted.",
          category: "help_needed",
          scope: "platform",
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      expect((await createForumPost(reqMissingTrack)).status).toBe(400);

      const reqMissingScope = createMockRequest(
        "/api/v1/forum",
        "POST",
        {
          title: "Missing scope post",
          content: "Should fail validation because scope is omitted.",
          category: "help_needed",
          track: "product",
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      expect((await createForumPost(reqMissingScope)).status).toBe(400);
    });

    it("prevents accidental leaks by rejecting platform-scope posts that carry org/project/issue/offer fields", async () => {
      const reqLeak = createMockRequest(
        "/api/v1/forum",
        "POST",
        {
          title: "Internal blocker accidentally marked platform",
          content: "Contains internal ticket reference",
          category: "help_needed",
          track: "product",
          scope: "platform",
          issueNumber: 1042,
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      expect((await createForumPost(reqLeak)).status).toBe(400);

      const reqOrgWithoutId = createMockRequest(
        "/api/v1/forum",
        "POST",
        {
          title: "Org post missing organisationId",
          content: "Should fail because organisationId is required for org scope.",
          category: "help_needed",
          track: "product",
          scope: "org",
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      expect((await createForumPost(reqOrgWithoutId)).status).toBe(400);
    });

    it("enforces dual project membership (allows org member OR direct project member, rejects outsiders with 403)", async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1", organisationId: "org-1" });
      // Case 1: Neither org member nor direct project member -> 403
      mockPrisma.membership.findUnique.mockResolvedValueOnce(null);
      mockPrisma.projectMembership.findUnique.mockResolvedValueOnce(null);

      const outsiderReq = createMockRequest(
        "/api/v1/forum",
        "POST",
        {
          title: "Project ask from outsider",
          content: "Should be blocked with 403",
          category: "help_needed",
          track: "product",
          scope: "project",
          projectId: "proj-1",
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      expect((await createForumPost(outsiderReq)).status).toBe(403);

      // Case 2: Direct project collaborator (not in org, but in projectMembership) -> 201
      mockPrisma.membership.findUnique.mockResolvedValueOnce(null);
      mockPrisma.projectMembership.findUnique.mockResolvedValueOnce({ id: "pm-1" });
      mockPrisma.forumPost.create.mockRejectedValueOnce(new Error("use memory fallback"));

      const collabReq = createMockRequest(
        "/api/v1/forum",
        "POST",
        {
          title: "Project ask from direct project collaborator",
          content: "Allowed via ProjectMembership",
          category: "help_needed",
          track: "product",
          scope: "project",
          projectId: "proj-1",
          issueNumber: 1042,
        },
        { authorization: "Bearer ziki_agent_token" }
      );
      const collabRes = await createForumPost(collabReq);
      expect(collabRes.status).toBe(201);
    });

    it("creates a platform forum message when authenticated as an agent with valid track and scope", async () => {
      mockPrisma.forumPost.create.mockRejectedValueOnce(new Error("use memory fallback"));
      const payload = {
        title: "Architecture question on state machine",
        content: "Reviewing general state machine pattern",
        category: "review_request",
        track: "product",
        scope: "platform",
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
          scope: "platform",
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
