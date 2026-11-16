import { describe, expect, it } from "vitest";
import { appFrames, captureError, fingerprintError, groupErrors, normaliseRoute, redactText } from "@/lib/error-capture";
import { appVersionLabel, deployedCommit } from "@/lib/deployed-version";

/** Server errors are made safe and grouped before anything keeps them (#871). */
const stack = [
  "TypeError: x is undefined",
  "    at handler (/srv/app/lib/agent-api/work.ts:120:15)",
  "    at node_modules/next/dist/server/foo.js:10:3",
  "    at route (/srv/app/app/api/v1/issues/[id]/route.ts:44:9)",
].join("\n");

describe("error capture", () => {
  it("drops the query string and replaces ids in the route", () => {
    expect(normaliseRoute("/api/v1/issues/cmw6jmdt00pnznt01uiq6pz4z/bid?projectId=abc#x")).toBe("/api/v1/issues/:id/bid");
    expect(normaliseRoute("/ziki/web/860")).toBe("/ziki/web/:id");
  });
  it("redacts keys, tokens, emails, query strings and long ids from a message", () => {
    const text = redactText("failed for ada@example.com with Bearer abc.def-123 and ziki_AbCdEfGh1234 at https://x.test/a?token=1 id cmw6jmdt00pnznt01uiq6pz4z");
    expect(text).not.toMatch(/ada@example|abc\.def|AbCdEfGh|token=1|cmw6jmdt/);
    expect(text).toContain("[redacted-email]");
    expect(text).toContain("Bearer [redacted]");
  });
  it("keeps only the app's own top frames, without columns or machine paths", () => {
    expect(appFrames(stack)).toEqual(["lib/agent-api/work.ts:120", "app/api/v1/issues/[id]/route.ts:44"]);
  });
  it("gives the same fingerprint to repeats of one failure and a different one to another route", () => {
    const a = captureError({ name: "TypeError", message: "boom", stack }, { path: "/api/v1/issues/1/bid", method: "post" });
    const b = captureError({ name: "TypeError", message: "boom again", stack }, { path: "/api/v1/issues/2/bid?x=1", method: "POST" });
    const c = captureError({ name: "TypeError", message: "boom", stack }, { path: "/api/v1/ideas", method: "POST" });
    expect(fingerprintError(a)).toBe(fingerprintError(b));
    expect(fingerprintError(a)).not.toBe(fingerprintError(c));
  });
  it("counts repeats, biggest group first", () => {
    const one = captureError({ name: "E", message: "m", stack }, { path: "/a", method: "GET" });
    const two = captureError({ name: "E", message: "m", stack }, { path: "/b", method: "GET" });
    const groups = groupErrors([one, two, one, one]);
    expect(groups.map((g) => g.count)).toEqual([3, 1]);
    expect(groups[0].sample.route).toBe("/a");
  });
});

describe("deployed version label (no PR package.json conflicts)", () => {
  it("uses build-time NEXT_PUBLIC_APP_VERSION or deployed commit SHA without requiring package.json edits", () => {
    expect(appVersionLabel({ NODE_ENV: "production", NEXT_PUBLIC_APP_VERSION: "0.1.950" }, "0.1.190")).toBe("v0.1.950");
    expect(appVersionLabel({ NODE_ENV: "production", SOURCE_COMMIT: "79e5b06c123456" }, "0.1.190")).toBe("v0.1.190+79e5b06");
    expect(appVersionLabel({ NODE_ENV: "production" }, "0.1.190")).toBe("v0.1.190");
    expect(deployedCommit({ NODE_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abcdef123456" })).toBe("abcdef123456");
  });
});
