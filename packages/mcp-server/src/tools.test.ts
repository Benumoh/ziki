import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS, buildRequest } from "./tools.js";

const repo = path.resolve(import.meta.dirname, "../../..");
const llmsDir = path.join(repo, "docs/llms");
const docs = readdirSync(llmsDir)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => readFileSync(path.join(llmsDir, name), "utf8"))
  .join("\n\n");

// `/issues/{id}/bid` lives at app/api/v1/issues/[id]/bid/route.ts. A site-root
// route such as the work feed `/{org}/{projectId}/work` lives at app/[org]/[project]/work/route.ts.
function routeFile(tool: (typeof TOOLS)[number]) {
  if (tool.siteRoute) return path.join(repo, "app", tool.route.replace("{org}", "[org]").replace(/\{(\w+)\}/g, "[project]"), "route.ts");
  return path.join(repo, "app/api/v1", tool.route.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");
}

/** How the agent reference titles a tool's route. */
function docHeading(tool: (typeof TOOLS)[number]) {
  return tool.siteRoute ? `${tool.method} ${tool.route.replace("{projectId}", "{project}")}` : `${tool.method} /api/v1${tool.route}`;
}

describe("tool table matches the API", () => {
  it("has unique tool names", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s wraps a real route", (_name, tool) => {
    const file = routeFile(tool);
    expect(existsSync(file), `${file} should exist`).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(
      new RegExp(
        `export\\s+(async\\s+)?function\\s+${tool.method}\\b|export\\s+const\\s+${tool.method}\\b|export\\s*\\{[^}]*\\b${tool.method}\\b`,
      ),
    );
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s is documented in the agent API reference", (_name, tool) => {
    // Docs write the heading as `### POST /api/v1/...` or `### \`GET /api/v1/...\``.
    const heading = docHeading(tool);
    expect(docs.replace(/`/g, "")).toContain(heading);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s routes every input field somewhere", (_name, tool) => {
    // `{org}` is the key's own organisation, which the client fills in (client.ts).
    const pathKeys = [...tool.route.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).filter((key) => key !== "org");
    const routed = new Set<string>([
      ...pathKeys,
      ...(tool.query ?? []),
      ...(tool.body ?? []),
      ...Object.values(tool.headers ?? {}),
      ...(tool.file ? [tool.file.filename, tool.file.data] : []),
    ]);
    if (tool.projectScoped) routed.add("projectId");
    const inputs = Object.keys(tool.input);
    for (const key of inputs) expect(routed.has(key), `${key} is not sent anywhere`).toBe(true);
    for (const key of routed) expect(inputs.includes(key), `${key} has no input field`).toBe(true);
  });

  it("describes every field so the assistant can use it", () => {
    for (const tool of TOOLS) {
      for (const [key, schema] of Object.entries(tool.input)) {
        expect((schema as z.ZodType).description, `${tool.name}.${key}`).toBeTruthy();
      }
    }
  });
});

describe("buildRequest", () => {
  const tool = (name: string) => TOOLS.find((candidate) => candidate.name === name)!;

  it("fills path params, encodes them, and falls back to the paired project", () => {
    const request = buildRequest(tool("ziki_get_issue"), { id: "a/b c" }, { projectId: "proj_1" });
    expect(request).toMatchObject({ method: "GET", path: "/issues/a%2Fb%20c", query: { projectId: "proj_1" } });
    expect(request.body).toBeUndefined();
  });

  it("prefers an explicit projectId", () => {
    const request = buildRequest(tool("ziki_heartbeat"), { id: "i", projectId: "other" }, { projectId: "proj_1" });
    expect(request.query).toEqual({ projectId: "other" });
  });

  it("sends only provided query and body fields", () => {
    const list = buildRequest(tool("ziki_list_issues"), { status: "open", limit: 5 }, { projectId: null });
    expect(list.query).toEqual({ status: "open", limit: 5 });
    const comment = buildRequest(tool("ziki_comment"), { id: "i", summary: "Hello.", body: "hi" }, { projectId: "p" });
    expect(comment.body).toEqual({ summary: "Hello.", body: "hi" });
  });

  it("sends the idempotency key as a header, deriving a stable one unless given (#633)", () => {
    const input = { title: "Bug title", summary: "Pressing Save does nothing on the page.", description: "Steps to reproduce" };
    const a = buildRequest(tool("ziki_create_idea"), input, { projectId: "p" });
    const b = buildRequest(tool("ziki_create_idea"), input, { projectId: "p" });
    expect(a.headers?.["Idempotency-Key"]).toBeTruthy();
    // A retry of the same call must reuse the key, or the API cannot deduplicate it.
    expect(a.headers?.["Idempotency-Key"]).toBe(b.headers?.["Idempotency-Key"]);
    expect(a.body).not.toHaveProperty("idempotencyKey");
    const fixed = buildRequest(tool("ziki_create_idea"), { ...input, idempotencyKey: "k" }, { projectId: "p" });
    expect(fixed.headers).toEqual({ "Idempotency-Key": "k" });
  });

  it("lets a caller repeat an identical action on purpose with an explicit key (#633)", () => {
    // The derived key deduplicates retries, so a deliberate repeat — filing the
    // same report twice on purpose — has to opt out by supplying its own key.
    const input = { title: "Same title", summary: "Pressing Save does nothing on the page.", description: "Same description" };
    const derived = buildRequest(tool("ziki_create_idea"), input, { projectId: "p" });
    const first = buildRequest(tool("ziki_create_idea"), { ...input, idempotencyKey: "deliberate-1" }, { projectId: "p" });
    const second = buildRequest(tool("ziki_create_idea"), { ...input, idempotencyKey: "deliberate-2" }, { projectId: "p" });
    expect(first.headers?.["Idempotency-Key"]).toBe("deliberate-1");
    expect(second.headers?.["Idempotency-Key"]).toBe("deliberate-2");
    expect(first.headers?.["Idempotency-Key"]).not.toBe(second.headers?.["Idempotency-Key"]);
    // Both differ from the derived default, so opting out always escapes it.
    expect(derived.headers?.["Idempotency-Key"]).not.toBe(first.headers?.["Idempotency-Key"]);
  });

  it("derives a different idempotency key for a different call (#633)", () => {
    const key = (input: Record<string, unknown>, projectId: string | null = "p") =>
      buildRequest(tool("ziki_create_idea"), input, { projectId }).headers?.["Idempotency-Key"];
    const base = { title: "Bug title", summary: "Pressing Save does nothing on the page.", description: "Steps to reproduce" };
    expect(key(base)).not.toBe(key({ ...base, title: "Another title" }));
    expect(key(base)).not.toBe(key({ ...base, description: "Different steps" }));
    expect(key(base)).not.toBe(key(base, "other-project"));
  });

  it("sends an empty JSON body on POSTs with nothing to send, and none on GET/DELETE", () => {
    expect(buildRequest(tool("ziki_award_bid"), { id: "b" }, { projectId: null }).body).toEqual({});
    expect(buildRequest(tool("ziki_get_issue"), { id: "i" }, { projectId: null }).body).toBeUndefined();
    expect(buildRequest(tool("ziki_withdraw_bid"), { id: "i" }, { projectId: null }).body).toBeUndefined();
  });

  it("sends the tested commit with a test result, and rejects a malformed one before calling the API", () => {
    const withSha = buildRequest(tool("ziki_submit_test_result"), { id: "i", goodToMerge: true, summary: "Good.", description: "Tested.", files: [{ path: "lib/x.ts", lines: "4" }], headSha: "a1b2c3d4e5f6" }, { projectId: "p" });
    expect(withSha.body).toEqual({ goodToMerge: true, summary: "Good.", description: "Tested.", files: [{ path: "lib/x.ts", lines: "4" }], headSha: "a1b2c3d4e5f6" });
    const without = buildRequest(tool("ziki_submit_test_result"), { id: "i", goodToMerge: true, summary: "Good.", description: "Tested.", files: [{ path: "lib/x.ts", lines: "4" }] }, { projectId: "p" });
    expect(without.body).toEqual({ goodToMerge: true, summary: "Good.", description: "Tested.", files: [{ path: "lib/x.ts", lines: "4" }] });
    // A bare verdict is refused before the API is called (#review-entries).
    expect(() => buildRequest(tool("ziki_submit_test_result"), { id: "i", goodToMerge: true }, { projectId: "p" })).toThrow();
    expect(() => buildRequest(tool("ziki_merge_fix"), { id: "i", verdict: "accept" }, { projectId: "p" })).toThrow();
    for (const bad of ["not-a-sha", "abc12", "g1b2c3d4e5f6", "a".repeat(65)]) {
      expect(() => buildRequest(tool("ziki_submit_test_result"), { id: "i", goodToMerge: true, summary: "Good.", description: "Tested.", files: [{ path: "lib/x.ts", lines: "4" }], headSha: bad }, { projectId: "p" })).toThrow();
    }
  });

  it("rejects input the route would reject", () => {
    expect(() => buildRequest(tool("ziki_comment"), { id: "i", body: "x".repeat(10001) }, { projectId: null })).toThrow();
    expect(() => buildRequest(tool("ziki_ask_owner"), { body: "hi" }, { projectId: null })).toThrow();
  });
});
