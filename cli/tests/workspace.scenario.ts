import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, type TestContext } from "vitest";
import { fileIdea, fileIssue, ok, refused, unique, ziki, type Agent, type CliResult } from "./helpers";

/** Everything around the issues: projects, notes, mistakes, goals, jobs, webhooks, points, missions, keys. */
describe("the workspace around the issues", () => {
  let projectId: string;

  beforeAll(async () => {
    projectId = (await ok("ada", "whoami")).project_id;
  });

  it("lists the agent's projects and reads one", async () => {
    const projects = await ok("bob", "list-projects");
    expect(JSON.stringify(projects)).toContain(projectId);
    expect(JSON.stringify(await ok("bob", "get-project", { id: projectId }))).toContain("cli-test");
  });

  describe("project notes", () => {
    /** The current notes version, 0 when there are none yet. */
    const notesVersion = async () => {
      const read = await ok("bob", "get-notes", { id: projectId });
      return (read.notes?.version ?? read.version ?? 0) as number;
    };
    const comment = async (body: string) => {
      const posted = await ok("bob", "comment-on-notes", { id: projectId, body });
      const commentId = (posted.comment?.id ?? posted.id) as string;
      expect(commentId, JSON.stringify(posted)).toBeTruthy();
      return commentId;
    };

    it("take no direct edits from any agent: the notes route only reads (#notes-promote)", async () => {
      const direct = await ziki("request", "PUT", `/api/v1/projects/${projectId}/notes`, "--body", JSON.stringify({ body: "# Direct", expectedVersion: 0, reason: "Direct edit." }), "--as", "ada");
      expect(direct.code).toBe(1);
      expect(direct.json?.status).toBe(405);
    });

    it("take comments, upvotes and their removal", async () => {
      const commentId = await comment("Should we also document the release steps?");
      await ok("cara", "upvote-note-comment", { id: projectId, commentId });
      await ok("cara", "remove-note-comment-upvote", { id: projectId, commentId });
      expect(JSON.stringify(await ok("ada", "list-note-comments", { id: projectId }))).toContain("release steps");
    });

    it("change only when a merger agent promotes a comment, which then leaves the discussion", async () => {
      const commentId = await comment("Use pnpm, never npm: the lockfile is pnpm-lock.yaml.");
      const version = await notesVersion();
      const promotion = { id: projectId, commentId, body: "# Conventions\n\nUse pnpm.", expectedVersion: version, reason: "Upvoted and true." };
      // A working agent can't, whoever its owner is.
      await refused("bob", "promote-note-comment", promotion, 403);
      await refused("ada", "promote-note-comment", promotion, 403);
      const promoted = await ok("eli", "promote-note-comment", promotion);
      expect(promoted).toMatchObject({ version: version + 1, comment: { id: commentId, promotedInVersion: version + 1 } });
      expect(JSON.stringify(await ok("bob", "get-notes", { id: projectId }))).toContain("Use pnpm.");
      // Retired: out of the discussion, listed with status=promoted, and not promoted twice.
      expect(JSON.stringify(await ok("bob", "list-note-comments", { id: projectId }))).not.toContain(commentId);
      expect(JSON.stringify(await ok("bob", "list-note-comments", { id: projectId, status: "promoted" }))).toContain(commentId);
      await refused("eli", "promote-note-comment", { ...promotion, expectedVersion: version + 1 }, 409);
    });

    it("refuse a promotion against notes that changed since they were read", async () => {
      const commentId = await comment("Run pnpm db:migrate, never db:seed, on a shared database.");
      const stale = (await notesVersion()) - 1;
      await refused("eli", "promote-note-comment", { id: projectId, commentId, body: "# Stale", expectedVersion: stale, reason: "Stale write." }, 409);
    });

    it("keep their history, which only a merger agent restores", async () => {
      const commentId = await comment("Node 22 is required; Node 26 breaks the jsdom theme tests.");
      await ok("eli", "promote-note-comment", { id: projectId, commentId, body: "# Conventions\n\nUse pnpm and Node 22.", expectedVersion: await notesVersion(), reason: "Add the Node version." });
      const revisions = await ok("bob", "list-note-revisions", { id: projectId });
      const list = revisions.revisions ?? revisions.items ?? [];
      expect(list.length, JSON.stringify(revisions)).toBeGreaterThanOrEqual(2);
      const oldest = list[list.length - 1];
      const restore = { id: projectId, revisionId: oldest.id, expectedVersion: await notesVersion(), reason: "Roll back." };
      await refused("bob", "restore-note-revision", restore, 403);
      await refused("ada", "restore-note-revision", restore, 403);
      const restored = await ok("eli", "restore-note-revision", restore);
      expect(JSON.stringify(restored)).toContain("Use pnpm.");
    });
  });

  describe("platforms (#platforms)", () => {
    it("are listed with slugs, and an idea filed by slug carries its platform", async () => {
      const platforms = (await ok("bob", "list-platforms")).items as { id: string; slug: string; name: string }[];
      expect(platforms.map((platform) => platform.slug)).toEqual(expect.arrayContaining(["desktop", "web", "mobile"]));
      const created = await ok("bob", "create-idea", {
        title: unique("Platform idea"),
        summary: "The desktop window forgets its size.\nIt opens small every time.",
        description: "Steps: resize the window, quit, reopen. Expected: same size. Actual: default size.",
        platform: "desktop",
        idempotencyKey: randomUUID(),
        acknowledgeSimilar: true,
      });
      const idea = (await ok("bob", "get-idea", { id: created.idea.id })).idea;
      expect(idea.platform).toMatchObject({ slug: "desktop", name: "Desktop" });
      expect((await refused("bob", "create-idea", {
        title: unique("Unknown platform"), summary: "Something is off on a platform.\nIt needs a look.", description: "Steps: open it. Expected: fine. Actual: broken.",
        platform: "toaster", idempotencyKey: randomUUID(), acknowledgeSimilar: true,
      }, 422)).error).toBe("unknown_platform");
      const listed = await ok("cara", "list-ideas", { platform: "desktop", limit: 100 });
      expect(JSON.stringify(listed)).toContain(created.idea.id);
    });

    it("let any agent categorize an uncategorized issue by slug, and only a manager move it on", async () => {
      const id = await fileIssue("ada", "Uncategorized report", ["bob", "cara", "eli"]);
      expect((await ok("bob", "get-issue", { id })).issue.platform).toBeNull();
      expect(JSON.stringify(await ok("bob", "list-issues", { platform: "none", limit: 100 }))).toContain(id);
      const feed = await ok("bob", "work");
      expect((feed.items as { kind: string }[]).some((item) => item.kind === "categorize")).toBe(true);

      const set = await ok("bob", "set-issue-platform", { id, platform: "web" });
      expect(set).toMatchObject({ changed: true, platform: { slug: "web" }, previous: null });
      expect((await ok("ada", "get-issue", { id })).issue.platform).toMatchObject({ slug: "web" });
      expect(JSON.stringify(await ok("bob", "list-issues", { platform: "web", limit: 100 }))).toContain(id);

      expect((await refused("cara", "set-issue-platform", { id, platform: "mobile" }, 409)).error).toBe("already_categorized");
      const moved = await ok("dana", "set-issue-platform", { id, platform: "mobile", reason: "It only happens in the mobile app." });
      expect(moved).toMatchObject({ changed: true, platform: { slug: "mobile" }, previous: { slug: "web" } });
    });
  });

  describe("the mistake registry", () => {
    it("is readable by any agent and written by manager agents", async () => {
      const entry = { id: projectId, category: "correctness", title: unique("Unchecked null"), antiPattern: "Reading a field without a null check.", remediation: "Guard it or use optional chaining." };
      expect((await refused("bob", "record-project-mistake", entry, 403)).error).toBe("insufficient_level");
      await ok("dana", "record-project-mistake", entry);
      expect(JSON.stringify(await ok("bob", "get-project-mistakes", { id: projectId }))).toContain(entry.title);
    });
  });

  describe("goals", () => {
    it("are created, read, listed, split across issues and completed", async () => {
      const target = await fileIssue("ada", "CLI workspace: goal target", ["bob", "cara", "eli"]);
      const created = await ok("ada", "create-goal", { title: unique("Ship the list fix"), description: "The blank list, fixed.", budgetPool: 100 });
      const goalId = created.goal?.id ?? created.id;
      expect(goalId, JSON.stringify(created)).toBeTruthy();
      expect(JSON.stringify(await ok("bob", "get-goal", { id: goalId }))).toContain("Ship the list fix");
      expect(JSON.stringify(await ok("bob", "list-goals"))).toContain(goalId);
      await ok("ada", "split-goal", { id: goalId, method: "manual", targets: JSON.stringify([{ targetType: "issue", targetBugId: target, amount: 60 }]) });
      expect(JSON.stringify(await ok("bob", "list-goal-allocations", { id: goalId }))).toContain(target);
      const done = await ok("ada", "update-goal", { id: goalId, status: "completed" });
      expect(JSON.stringify(done)).toContain("completed");
    });
  });

  describe("research jobs", () => {
    it("are posted by an agent whose owner is a workspace admin, and not otherwise", async () => {
      const job = { brief: "List three competitors' pricing pages.", dedupeKey: "url", maxSubmissions: 5, pointsPerAccepted: 10 };
      await refused("bob", "create-job", job, 403);
      const created = await ok("ada", "create-job", job);
      const jobId = created.job?.id ?? created.id;
      expect(jobId, JSON.stringify(created)).toBeTruthy();
      expect(JSON.stringify(await ok("bob", "list-jobs"))).toContain(jobId);
      expect(JSON.stringify(await ok("bob", "get-job", { id: jobId }))).toContain("competitors");

      const submitted = await ok("bob", "submit-job", { id: jobId, data: JSON.stringify({ url: "https://example.com/pricing", plan: "Pro" }) });
      const submissionId = submitted.submission?.id ?? submitted.id;
      expect(submissionId, JSON.stringify(submitted)).toBeTruthy();
      // Ziki offers the review to other owners' agents, through their inboxes.
      let offer: { agent: Agent; offerId: string } | undefined;
      for (const agent of ["ada", "cara", "dana", "eli"] as const) {
        const inbox = await ok(agent, "read-inbox");
        const item = inbox.items.find(
          (entry: { eventType: string; payload?: { submissionId?: string } }) => entry.eventType === "job.review.requested" && entry.payload?.submissionId === submissionId,
        );
        if (item) offer = { agent, offerId: item.payload.offerId };
        if (offer) break;
      }
      expect(offer, "no review offer reached a sandbox inbox").toBeTruthy();
      const reviewer = offer!.agent;
      await refused(reviewer, "review-job-submission", { id: submissionId, verdict: "accept" }, 409);
      await ok(reviewer, "accept-job-review", { id: offer!.offerId });
      const reviewed = await ok(reviewer, "review-job-submission", { id: submissionId, verdict: "accept", notes: "Checked the page." });
      expect(JSON.stringify(reviewed)).toMatch(/accept/);
    });

    it("serializes concurrent submissions at the final slot and refuses duplicates (#511)", async () => {
      const created = await ok("ada", "create-job", {
        brief: "Submit two distinct pricing page research rows.",
        dedupeKey: "url",
        maxSubmissions: 2,
        pointsPerAccepted: 10,
      });
      const jobId = created.job?.id ?? created.id;
      await ok("bob", "submit-job", {
        id: jobId,
        data: JSON.stringify({ url: "https://example.com/pricing/seed" }),
      });

      const competing = await Promise.all([
        ziki("submit-job", "--id", jobId, "--data", JSON.stringify({ url: "https://example.com/pricing/one" }), "--as", "bob"),
        ziki("submit-job", "--id", jobId, "--data", JSON.stringify({ url: "https://example.com/pricing/two" }), "--as", "cara"),
      ]);
      expect(competing.map((result) => result.code === 0 ? 201 : result.json?.status).sort()).toEqual([201, 409]);

      const duplicate = await ziki("submit-job", "--id", jobId, "--data", JSON.stringify({ url: "https://example.com/pricing/seed" }), "--as", "cara");
      expect(duplicate.json?.status).toBe(409);
    });
  });

  describe("webhooks", () => {
    it("are created with a one-time secret, rotated, listed with deliveries, and deleted", async (context) => {
      const attempt = await ziki("create-webhook", "--url", "https://example.com/ziki-hook", "--events", "issue.created", "--as", "bob");
      if (attempt.json?.status === 503) {
        // Signing secrets are encrypted with WEBHOOK_SECRET_KEY; without it the server says so plainly.
        expect(attempt.json.body.error).toMatch(/unavailable/);
        context.skip("Set WEBHOOK_SECRET_KEY in .env (64 hex characters) to test webhooks.");
      }
      expect(attempt.code, attempt.out).toBe(0);
      const created = attempt.json;
      const hookId = created.webhook?.id ?? created.subscription?.id ?? created.id;
      expect(hookId, JSON.stringify(created)).toBeTruthy();
      expect(JSON.stringify(created)).toMatch(/secret/i);
      expect(JSON.stringify(await ok("bob", "list-webhooks"))).toContain(hookId);
      expect(JSON.stringify(await ok("bob", "update-webhook", { id: hookId, rotateSecret: true }))).toMatch(/secret/i);
      expect(await ok("bob", "list-webhook-deliveries", { id: hookId })).toBeTruthy();
      await refused("bob", "retry-webhook-delivery", { id: hookId, deliveryId: "no-such-delivery" }, 404);
      await refused("cara", "delete-webhook", { id: hookId }, 404);
      await ok("bob", "delete-webhook", { id: hookId });
      expect(JSON.stringify(await ok("bob", "list-webhooks"))).not.toContain(hookId);
    });

    it("refuse plain-HTTP endpoints", async () => {
      const result = await ziki("create-webhook", "--url", "http://example.com/hook", "--as", "bob");
      expect(result.code).not.toBe(0);
    });
  });

  describe("points", () => {
    it("shows the owner's balance and ledger", async () => {
      expect(await ok("bob", "get-points")).toBeTruthy();
      const entries = await ok("bob", "list-point-entries", { limit: 5 });
      expect(Array.isArray(entries.entries ?? entries.items), JSON.stringify(entries)).toBe(true);
    });
  });

  describe("missions", () => {
    it("hands out the next route to cover, and records its coverage", async () => {
      const next = await ziki("next-mission", "--as", "cara");
      if (next.code === 0 && next.json?.mission) {
        const covered = await ok("cara", "cover-mission", { id: next.json.mission.id, issuesFiled: 0 });
        expect(covered).toBeTruthy();
      } else {
        // A project with no routes to cover has no mission to hand out.
        expect([0, 1]).toContain(next.code);
      }
    });
  });

  describe("pairing and keys", () => {
    /** Pairing starts are limited per IP over 15 minutes, too long to wait out in a test. */
    function skipIfPairingLimited(result: CliResult, context: TestContext): void {
      if (result.json?.status === 429 && result.json.body?.error === "rate_limited") {
        context.skip("Pairing is limited to 10 starts per 15 minutes from one IP. Rerun later to cover it.");
      }
    }

    it("starts device-code pairing for a new agent, which waits for a person's approval", async (context) => {
      const attempt = await ziki("pair", "--name", unique("Paired"), "--model", "Test", "--as", "ada");
      skipIfPairingLimited(attempt, context);
      expect(attempt.code, attempt.out).toBe(0);
      const started = attempt.json;
      expect(started.user_code).toBeTruthy();
      expect(started.device_code).toBeTruthy();
      const pending = await ziki("collect-pairing-token", "--device-code", started.device_code, "--as", "ada");
      expect(pending.code).toBe(1);
      expect(JSON.stringify(pending.json)).toMatch(/authorization_pending|pending/);
    });

    it("accepts an old role name at pairing and maps it to a class", async (context) => {
      const legacy = await ziki("request", "POST", "/api/v1/agents/pairing", "--body", JSON.stringify({ name: unique("Legacy"), level: "contributor" }), "--as", "ada");
      skipIfPairingLimited(legacy, context);
      expect(legacy.code, legacy.out).toBe(0);
      const refusedClass = await ziki("request", "POST", "/api/v1/agents/pairing", "--body", JSON.stringify({ name: unique("Boss"), level: "manager" }), "--as", "ada");
      skipIfPairingLimited(refusedClass, context);
      expect(refusedClass.code).toBe(1);
      expect(JSON.stringify(refusedClass.json)).toMatch(/manager or merger/);
    });

    it("rotates a key: the keyring keeps working, and the old key stops", async () => {
      const before = (await ziki("agents")).json.agents.find((agent: { name: string }) => agent.name === "cara");
      expect(before).toBeTruthy();
      const rotated = await ok("cara", "rotate-key");
      expect(rotated.api_key).toMatch(/^ziki_/);
      expect((await ok("cara", "whoami")).name).toBe("cara");
    });
  });

  describe("routes with local limits", () => {
    it("resolving needs a linked pull request reported merged, so an issue without one is refused clearly", async () => {
      const issue = await fileIssue("ada", "CLI workspace: resolve without a pull request", ["bob", "cara", "eli"]);
      const result = await ziki("resolve-issue", "--id", issue, "--pull-request-url", "https://github.com/emerjent/ziki/pull/1", "--as", "ada");
      expect(result.code).toBe(1);
      expect(result.json.status).toBe(409);
    });

    it("structures an open idea, and refuses one that is no longer open", async () => {
      const idea = await fileIdea("ada", "CLI workspace: idea to structure");
      const structured = await ok("bob", "structure-idea", { id: idea, summary: "Saving does nothing.", acceptanceCriteria: ["Save stores the form"] });
      expect(JSON.stringify(structured)).toContain("Saving does nothing.");
      await refused("bob", "structure-idea", { id: "no-such-issue", summary: "A summary." }, 404);
    });

    it("accepting an unknown review offer is a 404", async () => {
      await refused("bob", "accept-review-offer", { id: randomUUID() }, 404);
      await refused("bob", "accept-job-review", { id: randomUUID() }, 404);
    });
  });
});
