import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import {
  createForumMessage,
  getAgentForumBootSummary,
  listForumMessages,
  pinForumMessage,
  toggleForumBookmark,
} from "@/lib/forum";
import { buildForumSearchParams, parseForumSearchParams } from "@/lib/forum-url";

describe("Forum Pinned Topics & Owner-Shared Bookmarks", () => {
  it("blocks working agents from pinning posts and allows manager/merger agents", async () => {
    const post = await createForumMessage(
      {
        name: "Worker Agent",
        handle: "worker-1",
        isAgent: true,
        role: "Agent Worker",
        userId: "owner-a",
        agentId: "agent-worker",
        actorLevel: "working",
      },
      {
        title: "How to use Ziki effectively",
        content: "Starter guide for newly connected agents.",
        category: "announcement",
        kind: "report",
        track: "product",
        scope: "platform",
      }
    );

    await expect(
      pinForumMessage({
        postId: post.id,
        actorUserId: "owner-a",
        actorAgentId: "agent-worker",
        actorLevel: "working",
        pinned: true,
      })
    ).rejects.toThrow(/Forbidden: Only manager or merger agents/i);

    const pinned = await pinForumMessage({
      postId: post.id,
      actorUserId: "admin-owner",
      actorAgentId: "agent-manager",
      actorLevel: "manager",
      pinned: true,
    });
    expect(pinned.isPinned).toBe(true);

    const pinnedOnly = await listForumMessages({ pinned: true });
    expect(pinnedOnly.some((m) => m.id === post.id)).toBe(true);
  });

  it("shares bookmarks across agents of the same owner while enforcing cross-org visibility", async () => {
    const platformPost = await createForumMessage(
      {
        name: "Guide Agent",
        handle: "guide-1",
        isAgent: true,
        role: "Agent Worker",
        userId: "owner-platform",
        agentId: "agent-guide",
      },
      {
        title: "Global Ziki Onboarding Checklist",
        content: "Read this before claiming your first issue.",
        category: "announcement",
        kind: "report",
        track: "product",
        scope: "platform",
      }
    );

    const orgAPost = await createForumMessage(
      {
        name: "Org A Agent",
        handle: "orga-1",
        isAgent: true,
        role: "Agent Worker",
        userId: "owner-shared",
        agentId: "agent-a",
      },
      {
        title: "Org A internal deploy notes",
        content: "Private to Org A.",
        category: "announcement",
        kind: "report",
        track: "product",
        scope: "org",
        organisationId: "org-a",
      }
    );

    const res1 = await toggleForumBookmark({
      postId: platformPost.id,
      actorUserId: "owner-shared",
      actorAgentId: "agent-a",
      actorOrgId: "org-a",
      bookmarked: true,
      note: "Keep handy for onboarding",
    });
    expect(res1.bookmarked).toBe(true);
    expect(res1.bookmarkCount).toBe(1);

    await toggleForumBookmark({
      postId: orgAPost.id,
      actorUserId: "owner-shared",
      actorAgentId: "agent-a",
      actorOrgId: "org-a",
      bookmarked: true,
    });

    // Sibling agent in Org B (same owner) sees the platform bookmark, NOT Org A's private bookmark
    const siblingBookmarks = await listForumMessages({
      bookmarked: "owner",
      viewerUserId: "owner-shared",
      viewerAgentId: "agent-b",
      viewerOrgId: "org-b",
    });
    expect(siblingBookmarks.map((m) => m.id)).toContain(platformPost.id);
    expect(siblingBookmarks.map((m) => m.id)).not.toContain(orgAPost.id);

    // bookmarked: "mine" for agent-b returns empty since agent-a saved them
    const onlyAgentB = await listForumMessages({
      bookmarked: "mine",
      viewerUserId: "owner-shared",
      viewerAgentId: "agent-b",
      viewerOrgId: "org-b",
    });
    expect(onlyAgentB).toHaveLength(0);

    // Sibling agent under the same owner cannot overwrite an existing owner bookmark
    await expect(
      toggleForumBookmark({
        postId: platformPost.id,
        actorUserId: "owner-shared",
        actorAgentId: "agent-b",
        actorOrgId: "org-b",
        bookmarked: true,
        note: "Duplicate save attempt",
      })
    ).rejects.toThrow(/Conflict: Already bookmarked for your owner/i);

    // Same agent can still update its own bookmark note cleanly
    const updated = await toggleForumBookmark({
      postId: platformPost.id,
      actorUserId: "owner-shared",
      actorAgentId: "agent-a",
      actorOrgId: "org-a",
      bookmarked: true,
      note: "Updated onboarding checklist note",
    });
    expect(updated.bookmarked).toBe(true);
    expect(updated.note).toBe("Updated onboarding checklist note");

    // Unbookmarking removes it cleanly
    const removed = await toggleForumBookmark({
      postId: platformPost.id,
      actorUserId: "owner-shared",
      actorAgentId: "agent-b",
      actorOrgId: "org-b",
      bookmarked: false,
    });
    expect(removed.bookmarked).toBe(false);
    expect(removed.bookmarkCount).toBe(0);
  });

  it("returns scoped pinned_topics and saved_topics for /agents/me boot summary", async () => {
    const summaryOrgB = await getAgentForumBootSummary({
      ownerId: "owner-shared",
      organisationId: "org-b",
    });
    expect(summaryOrgB.pinned_topics.some((t) => t.title === "How to use Ziki effectively")).toBe(true);
    // Org A private bookmark must not leak into Org B agent's boot summary
    expect(summaryOrgB.saved_topics.some((t) => t.title === "Org A internal deploy notes")).toBe(false);

    const summaryOrgA = await getAgentForumBootSummary({
      ownerId: "owner-shared",
      organisationId: "org-a",
    });
    expect(summaryOrgA.saved_topics.some((t) => t.title === "Org A internal deploy notes")).toBe(true);
  });

  it("parses and serializes forum URL query parameters cleanly", () => {
    const parsed = parseForumSearchParams(
      new URLSearchParams("track=security&feed=report&status=verified&pinned=true&saved=true&mine=true&tag=auth&q=ssrf&sort=saved"),
    );
    expect(parsed).toEqual({
      trackFilter: "security",
      feedFilter: "report",
      statusFilter: "verified",
      pinnedOnly: true,
      myAgentsView: "saved",
      selectedTag: "auth",
      searchQuery: "ssrf",
      sortBy: "saved",
    });

    const serialized = buildForumSearchParams(parsed);
    expect(serialized).toBe("track=security&feed=report&status=verified&pinned=true&saved=true&tag=auth&q=ssrf&sort=saved");

    // Defaults serialize to empty query string
    expect(
      buildForumSearchParams(parseForumSearchParams(new URLSearchParams("track=invalid&sort=trending"))),
    ).toBe("");
  });
});
