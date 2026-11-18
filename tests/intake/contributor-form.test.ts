import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  idea: { create: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  attachment: { create: vi.fn() },
  user: { upsert: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

const emit = vi.hoisted(() => vi.fn());
const rateLimit = vi.hoisted(() => ({ consume: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish: emit }));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimits: rateLimit.consume,
  clientRateLimitKey: () => "ip:203.0.113.7",
}));

import {
  createPublicIdea,
  findPublicIdeaMatches,
  draftTitle,
  draftSummary,
  publicIdeaSchema,
} from "@/lib/public-idea-intake";

// Valid 1x1 PNG image as base64
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const publicProject = {
  id: "proj_123",
  organisationId: "org_123",
  name: "Ziki Web",
  slug: "web",
  acceptsGuestIdeas: true,
  visibility: "public",
  archivedAt: null,
};

const ref = { orgSlug: "ziki", projectSlug: "web" };
const publicHeaders = new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "test-agent" });

describe("contributor form intake (#989)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.project.findFirst.mockResolvedValue(publicProject);
    db.idea.findUnique.mockResolvedValue(null);
    rateLimit.consume.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
    db.user.upsert.mockResolvedValue({ id: "anon_user" });
    db.$queryRaw.mockResolvedValue([]);
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
    db.idea.create.mockResolvedValue({ id: "idea_abc", number: 42 });
    db.attachment.create.mockResolvedValue({ id: "att_xyz" });
  });

  describe("one-box drafting & validation", () => {
    it("drafts title and summary from description when only description is provided", () => {
      const desc = "The Save button does not respond when clicking on mobile.";
      const title = draftTitle(desc);
      const summary = draftSummary(desc);

      expect(title).toBe("The Save button does not respond when clicking on mobile.");
      expect(summary.length).toBeGreaterThanOrEqual(20);
      expect(summary.length).toBeLessThanOrEqual(300);

      const parsed = publicIdeaSchema.parse({
        description: desc,
        trackingToken: "a".repeat(32),
      });

      expect(parsed.title).toBe(title);
      expect(parsed.summary).toBe(summary);
      expect(parsed.description).toBe(desc);
    });

    it("preserves manual edits to title and summary", () => {
      const customTitle = "Custom Edited Title";
      const customSummary = "This is a custom summary that meets the minimum length requirement.";
      const desc = "Completely different text in the description box.";

      const parsed = publicIdeaSchema.parse({
        title: customTitle,
        summary: customSummary,
        description: desc,
        trackingToken: "b".repeat(32),
      });

      expect(parsed.title).toBe(customTitle);
      expect(parsed.summary).toBe(customSummary);
    });

    it("preserves optional steps, expected behaviour, and actual behaviour", async () => {
      const input = {
        description: "Save button is broken on mobile devices in portrait mode.",
        stepsToReproduce: "1. Open app\n2. Tap Save\n3. Nothing happens",
        expectedBehavior: "Changes should be saved.",
        actualBehavior: "No response and changes are lost.",
        trackingToken: "c".repeat(32),
      };

      const result = await createPublicIdea(ref, input, publicHeaders, {
        db: db as never,
        consume: rateLimit.consume,
        emit,
      });

      expect(result.status).toBe(201);
      expect(db.idea.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining("Steps to reproduce"),
          }),
        }),
      );
    });
  });

  describe("screenshot attachment validation & storage", () => {
    it("accepts a valid PNG screenshot within 5 MB and saves attachment", async () => {
      const input = {
        description: "Save button is unresponsive on mobile devices.",
        trackingToken: "d".repeat(32),
        screenshot: {
          filename: "screenshot.png",
          data: VALID_PNG_BASE64,
        },
      };

      const result = await createPublicIdea(ref, input, publicHeaders, {
        db: db as never,
        consume: rateLimit.consume,
        emit,
      });

      expect(result.status).toBe(201);
      expect(db.attachment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ideaId: "idea_abc",
          filename: "screenshot.png",
          contentType: "image/png",
        }),
      });
    });

    it("rejects non-image files with clear invalid_request error", async () => {
      // Plain text file as base64
      const textBase64 = Buffer.from("not an image").toString("base64");
      const input = {
        description: "Testing invalid attachment type upload.",
        trackingToken: "e".repeat(32),
        screenshot: {
          filename: "report.txt",
          data: textBase64,
        },
      };

      const result = await createPublicIdea(ref, input, publicHeaders, {
        db: db as never,
        consume: rateLimit.consume,
        emit,
      });

      expect(result.status).toBe(400);
      expect(result).toMatchObject({
        error: "invalid_request",
      });
      expect(db.attachment.create).not.toHaveBeenCalled();
    });

    it("rejects oversized screenshots (> 5 MB) with 413 too_large", async () => {
      // Generate dummy buffer > 5 MB
      const oversizedBytes = new Uint8Array(5 * 1024 * 1024 + 1024);
      // Valid PNG header so checkAttachment doesn't fail on type check before size
      oversizedBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const oversizedBase64 = Buffer.from(oversizedBytes).toString("base64");

      const input = {
        description: "Testing oversized attachment upload limit.",
        trackingToken: "f".repeat(32),
        screenshot: {
          filename: "large.png",
          data: oversizedBase64,
        },
      };

      const result = await createPublicIdea(ref, input, publicHeaders, {
        db: db as never,
        consume: rateLimit.consume,
        emit,
      });

      expect(result.status).toBe(413);
      expect(result).toMatchObject({
        error: "too_large",
      });
      expect(db.attachment.create).not.toHaveBeenCalled();
    });
  });

  describe("disabled intake & access control", () => {
    it("returns 404 when project guest intake is disabled", async () => {
      db.project.findFirst.mockResolvedValue(null);

      const input = {
        description: "Submitting report to a project that does not accept guest ideas.",
        trackingToken: "1".repeat(32),
      };

      const result = await createPublicIdea(ref, input, publicHeaders, {
        db: db as never,
        consume: rateLimit.consume,
        emit,
      });

      expect(result.status).toBe(404);
      expect(result).toMatchObject({
        error: "not_found",
      });
      expect(db.idea.create).not.toHaveBeenCalled();
    });
  });

  describe("privacy protections", () => {
    it("never exposes private idea matches in guest suggestions or submission conflicts", async () => {
      db.$queryRaw.mockResolvedValue([{ id: "private", kind: "idea", number: 9, title: "Secret customer report", status: "open", score: 0.9 }]);
      const result = await findPublicIdeaMatches(ref, "Secret customer report", publicHeaders, { db: db as never, consume: rateLimit.consume });
      expect(result).toEqual({ status: 200, matches: [] });
    });

    it("duplicate suggestion query exposes only allowlisted public fields", async () => {
      db.$queryRaw.mockResolvedValue([
        {
          id: "b1",
          kind: "issue",
          number: 101,
          title: "Public issue title",
          status: "open",
          score: 0.8,
          // Sensitive fields that must NOT be exposed
          secretKey: "secret-value",
          attachmentData: "sensitive-attachment",
        },
      ]);

      const result = await findPublicIdeaMatches(ref, "search query", publicHeaders, {
        db: db as never,
        consume: rateLimit.consume,
      });

      expect(result.status).toBe(200);
      if (result.status === 200) {
        expect(result.matches[0]).toEqual({
          kind: "issue",
          number: 101,
          title: "Public issue title",
          status: "open",
        });
        expect(result.matches[0]).not.toHaveProperty("secretKey");
        expect(result.matches[0]).not.toHaveProperty("attachmentData");
      }
    });

    it("hashes tracking tokens with SHA-256 and never stores them plaintext", async () => {
      const rawToken = "my_secret_token_1234567890123456";
      const input = {
        description: "Checking that tracking token is safely hashed.",
        trackingToken: rawToken,
      };

      await createPublicIdea(ref, input, publicHeaders, {
        db: db as never,
        consume: rateLimit.consume,
        emit,
      });

      expect(db.idea.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicTrackingTokenHash: expect.not.stringContaining(rawToken),
          }),
        }),
      );
    });

    it("supports feedback links for private projects without exposing internal issues (#1048)", async () => {
      db.project.findFirst.mockResolvedValue({
        ...publicProject,
        slug: "desktop",
        name: "Desktop",
        visibility: "private",
        acceptsGuestIdeas: false,
      });
      db.$queryRaw.mockResolvedValue([
        { id: "secret_bug", kind: "issue", number: 7, title: "Internal desktop roadmap issue", status: "open", score: 0.95 },
      ]);

      const searchResult = await findPublicIdeaMatches(
        { orgSlug: "ziki", projectSlug: "desktop" },
        "Internal desktop",
        publicHeaders,
        { db: db as never, consume: rateLimit.consume },
      );
      expect(searchResult).toEqual({ status: 200, matches: [] });
      expect(db.$queryRaw).not.toHaveBeenCalled();

      const submitResult = await createPublicIdea(
        { orgSlug: "ziki", projectSlug: "desktop" },
        {
          description: "Desktop window freezes when resizing on macOS.",
          trackingToken: "d".repeat(32),
        },
        publicHeaders,
        { db: db as never, consume: rateLimit.consume, emit },
      );
      expect(submitResult.status).toBe(201);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
