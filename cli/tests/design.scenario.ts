import { beforeAll, describe, expect, it } from "vitest";
import { fileIssue, ok, refused, unique, ziki } from "./helpers";

/** A 1×1 PNG, as an agent uploads a mockup. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type Proposal = {
  id: string;
  projectId: string;
  authorAgentId: string;
  status: string;
  title: string;
  previewUrl: string | null;
  bugId: string | null;
  attachments: { id: string; filename: string; contentType: string; size: number; url: string }[];
};

/**
 * Redesign proposals (#9) through the CLI: bob proposes a redesign of an issue
 * with a mockup and a preview, then agents read it back. Every proposal belongs
 * to the issue it redesigns; deciding it is for people on that issue's page
 * (the decision route refuses agent keys), so this stops at reading.
 */
describe("design proposals", () => {
  let proposal: Proposal;
  let mockupId: string;
  let issueId: string;

  beforeAll(async () => {
    issueId = await fileIssue("ada", "CLI design: the dashboard is too loud", ["bob", "cara", "eli"]);
    const uploaded = await ok("bob", "upload-attachment", { filename: "mockup.png", dataBase64: PNG });
    mockupId = uploaded.attachment?.id ?? uploaded.id;
    const created = await ok("bob", "propose-redesign", {
      bugId: issueId,
      title: unique("CLI design: a calmer dashboard"),
      body: "Muted summary tiles; only an overdue count turns red.",
      previewUrl: "https://example.com/design/calm-dashboard",
      attachmentIds: [mockupId],
    });
    // The whole proposal row, under `proposal` (the docs once said otherwise).
    expect(created.proposal).toMatchObject({ status: "proposed", bugId: issueId, approverId: null });
    proposal = created.proposal;
  });

  it("refuses a proposal that names no issue", async () => {
    const bare = await ziki("request", "POST", `/api/v1/redesigns?projectId=${proposal.projectId}`, "--body", JSON.stringify({
      projectId: proposal.projectId,
      title: unique("CLI design: an issue-less idea"),
      body: "A redesign that redesigns nothing in particular.",
    }), "--as", "bob");
    expect(bare.code).toBe(1);
    expect(bare.json?.status).toBe(400);
    expect(JSON.stringify(bare.json?.body)).toContain("bugId");
  });

  it("lists the proposal for its author with its mockup and its issue", async () => {
    const mine = await ok("bob", "list-redesigns", { mine: true, status: "proposed" });
    const item = (mine.items as Proposal[]).find((entry) => entry.id === proposal.id);
    expect(item, JSON.stringify(mine)).toBeTruthy();
    expect(item!.attachments).toEqual([expect.objectContaining({ id: mockupId, contentType: "image/png", url: `/api/v1/attachments/${mockupId}` })]);
    expect(item!.bugId).toBe(issueId);
    // Decided filters leave it out.
    const approved = await ok("bob", "list-redesigns", { status: "approved" });
    expect((approved.items as Proposal[]).some((entry) => entry.id === proposal.id)).toBe(false);
  });

  it("leaves another agent's proposal out of `mine`, but any agent in the organisation reads it", async () => {
    const adaMine = await ok("ada", "list-redesigns", { mine: true });
    expect((adaMine.items as Proposal[]).some((entry) => entry.id === proposal.id)).toBe(false);
    const read = await ok("ada", "get-redesign", { id: proposal.id });
    expect(read.proposal).toMatchObject({ id: proposal.id, authorAgentId: proposal.authorAgentId, previewUrl: "https://example.com/design/calm-dashboard" });
    // The mockup reads with any agent's key in the organisation, at the url the proposal gives.
    const file = await ziki("request", "GET", read.proposal.attachments[0].url, "--as", "ada");
    expect(file.code, file.err).toBe(0);
  });

  it("pages with nextCursor", async () => {
    const first = await ok("bob", "list-redesigns", { limit: 1 });
    expect(first.items).toHaveLength(1);
    if (first.nextCursor) {
      const second = await ok("bob", "list-redesigns", { limit: 1, cursor: first.nextCursor });
      expect(second.items[0]?.id).not.toBe(first.items[0].id);
    }
  });

  it("answers a bad filter with a 400 and an unknown proposal with a 404", async () => {
    const bad = await ziki("request", "GET", `/api/v1/redesigns?projectId=${proposal.projectId}&status=pending`, "--as", "bob");
    expect(bad.code).toBe(1);
    expect(bad.json?.status).toBe(400);
    const badCursor = await ziki("request", "GET", `/api/v1/redesigns?projectId=${proposal.projectId}&cursor=not-a-cursor`, "--as", "bob");
    expect(badCursor.json?.status).toBe(400);
    const noProject = await ziki("request", "GET", "/api/v1/redesigns", "--as", "bob");
    expect(noProject.json?.status).toBe(400);
    await refused("bob", "get-redesign", { id: "no-such-redesign" }, 404);
    await refused("bob", "list-redesigns", { projectId: "no-such-project" }, 404);
  });
});
