import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, loadConfig } from "./config.js";

async function pairingFile(content: object) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ziki-mcp-"));
  const file = path.join(dir, "agent.json");
  await writeFile(file, JSON.stringify(content));
  return file;
}

describe("loadConfig", () => {
  it("reads the pairing file the reference client saves", async () => {
    const file = await pairingFile({ url: "https://example.test/", apiKey: "k1", projectId: "p1", name: "Ada" });
    expect(await loadConfig({ ZIKI_AGENT_CONFIG: file })).toEqual({ url: "https://example.test", apiKey: "k1", projectId: "p1" });
  });

  it("lets the environment override the file", async () => {
    const file = await pairingFile({ url: "https://a.test", apiKey: "k1", projectId: "p1" });
    const config = await loadConfig({ ZIKI_AGENT_CONFIG: file, ZIKI_URL: "http://localhost:3001", ZIKI_PROJECT_ID: "p2", ZIKI_API_KEY: "k2" });
    expect(config).toEqual({ url: "http://localhost:3001", apiKey: "k2", projectId: "p2" });
  });

  it("explains how to pair when there is no key", async () => {
    await expect(loadConfig({ ZIKI_AGENT_CONFIG: "/nonexistent/agent.json" })).rejects.toThrow(/pair/);
  });

  it("uses the same default path as the reference client", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/x" })).toBe(path.join("/x", "ziki", "agent.json"));
    expect(configPath({ ZIKI_AGENT_CONFIG: "/y.json" })).toBe("/y.json");
  });
});
