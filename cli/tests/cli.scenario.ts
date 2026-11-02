import { describe, expect, it } from "vitest";
import { CLI_TOOLS } from "../catalog";
import { ok, ziki } from "./helpers";

describe("the CLI itself", () => {
  it("doctor reports a local database, a reachable server and a signed-in sandbox agent", async () => {
    const result = await ziki("doctor");
    expect(result.code).toBe(0);
    expect(result.json.database).toBe("ok (local)");
    expect(result.json.server.status).toBe("ok");
    expect(result.json.signedInAs.name).toBe("ada");
  });

  it("refuses a server that isn't on this machine, before sending anything", async () => {
    const result = await ziki("whoami", "--server", "https://ziki.dev");
    expect(result.code).toBe(3);
    expect(result.err).toMatch(/not a local server/);
  });

  it("fails clearly when nothing is listening on the local port", async () => {
    const result = await ziki("whoami", "--server", "http://localhost:1");
    expect(result.code).toBe(3);
    expect(result.err).toMatch(/Can't reach the local server/);
  });

  it("lists every API command, including the ones the MCP server doesn't have yet", async () => {
    const result = await ziki("commands");
    expect(result.code).toBe(0);
    expect(result.out.split("\n")).toHaveLength(CLI_TOOLS.length);
    for (const command of ["create-idea", "mark-important", "bid", "vote-bid", "upvote-comment", "award-bid", "suggest-close", "close-issue", "save-notes", "report-pr-status"]) expect(result.out).toContain(command);
    // Offers come only from an awarded bid (#bids-only-offers); Ziki never merges on GitHub (#pr-reports).
    for (const removed of ["request-offer", "dispatch", "admin-merge"]) expect(result.out).not.toMatch(new RegExp(`^${removed} `, "m"));
  });

  it("shows a command's flags with types and which are required", async () => {
    const result = await ziki("help", "confirm-issue");
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/--verdict <confirm\|reject\|neutral>\s+\(required\)/);
    expect(result.out).toMatch(/--duplicate-of-id\b/);
    // Confirmations take no severity.
    expect(result.out).not.toMatch(/--severity/);
  });

  it("rejects unknown commands, unknown flags and missing required flags as usage errors (exit 2)", async () => {
    expect((await ziki("frobnicate")).code).toBe(2);
    const unknownFlag = await ziki("whoami", "--colour", "blue", "--as", "ada");
    expect(unknownFlag.code).toBe(2);
    expect(unknownFlag.err).toMatch(/Unknown flag --colour/);
    const missing = await ziki("create-idea", "--title", "Only a title", "--as", "ada");
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/--description/);
  });

  it("refuses an agent that isn't in the keyring", async () => {
    const result = await ziki("whoami", "--as", "zoe");
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/No agent "zoe"/);
  });

  it("acts as each sandbox agent with its own class", async () => {
    const levels: Record<string, string> = { ada: "working", bob: "working", "bob-alt": "working", cara: "working", dana: "manager", eli: "merger" };
    for (const [agent, level] of Object.entries(levels)) {
      const me = await ok(agent as never, "whoami");
      expect(me.name).toBe(agent);
      expect(me.level).toBe(level);
    }
  });

  it("calls any route with `request`, for paths without a named command", async () => {
    const result = await ziki("request", "GET", "/api/v1/agents/me", "--as", "bob");
    expect(result.code).toBe(0);
    expect(result.json.name).toBe("bob");
  });

  it("switches the default agent with `use`", async () => {
    expect((await ziki("use", "cara")).code).toBe(0);
    expect((await ziki("whoami")).json.name).toBe("cara");
    expect((await ziki("use", "ada")).code).toBe(0);
  });
});
