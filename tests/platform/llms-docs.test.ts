import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ default: {} }));

import { GET as getLlmsIndex } from "@/app/llms.txt/route";
import { GET as getLlmsFull } from "@/app/llms-full.txt/route";
import { GET as getLlmsTopic, generateStaticParams } from "@/app/llms/[topic]/route";
import { clearLlmsCache, LLMS_TOPICS, resolveLlmsTopic } from "@/lib/llms-docs";
import { isPublicPath } from "@/middleware";

describe("Modular /llms.txt and /llms/*.md documentation routes", () => {
  beforeEach(() => {
    clearLlmsCache();
  });

  it("serves compact /llms.txt with ETag, 304 caching, and valid topic links", async () => {
    const res = await getLlmsIndex(new Request("https://ziki.dev/llms.txt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const etag = res.headers.get("etag");
    expect(etag).toBeTruthy();

    const body = await res.text();
    const byteLength = Buffer.byteLength(body, "utf8");
    expect(byteLength).toBeGreaterThan(2_000);
    expect(byteLength).toBeLessThan(12_000);

    // Every /llms/*.md link referenced in index.md must resolve to a valid topic
    const matches = [...body.matchAll(/\/llms\/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThanOrEqual(LLMS_TOPICS.length);
    for (const filename of matches) {
      expect(resolveLlmsTopic(filename)).not.toBeNull();
    }

    // 304 Not Modified on matching ETag
    const cached = await getLlmsIndex(
      new Request("https://ziki.dev/llms.txt", { headers: { "if-none-match": etag! } }),
    );
    expect(cached.status).toBe(304);
  });

  it("serves every static topic at /llms/[topic] as text/markdown with ETag/304", async () => {
    const params = generateStaticParams();
    expect(params.map((p) => p.topic)).toEqual(LLMS_TOPICS.map((t) => `${t}.md`));

    for (const { topic } of params) {
      const res = await getLlmsTopic(new Request(`https://ziki.dev/llms/${topic}`), {
        params: Promise.resolve({ topic }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      const etag = res.headers.get("etag");
      expect(etag).toBeTruthy();

      const body = await res.text();
      expect(body).toContain("# Ziki Agent Docs —");

      const cached = await getLlmsTopic(
        new Request(`https://ziki.dev/llms/${topic}`, { headers: { "if-none-match": etag! } }),
        { params: Promise.resolve({ topic }) },
      );
      expect(cached.status).toBe(304);
    }
  });

  it("returns 404 for unknown or invalid topic paths", async () => {
    for (const bad of ["unknown.md", "onboarding", "../index.md", "index.md"]) {
      const res = await getLlmsTopic(new Request(`https://ziki.dev/llms/${bad}`), {
        params: Promise.resolve({ topic: bad }),
      });
      expect(res.status).toBe(404);
    }
  });

  it("serves full concatenated reference at /llms-full.txt", async () => {
    const res = await getLlmsFull(new Request("https://ziki.dev/llms-full.txt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const etag = res.headers.get("etag");
    expect(etag).toBeTruthy();

    const body = await res.text();
    expect(body).toContain("## Agent Persona & Interaction Protocol");
    expect(body).toContain("## Ziki Agent Forum & Peer Collaboration");
    expect(body).toContain("### Marketing assets");

    const cached = await getLlmsFull(
      new Request("https://ziki.dev/llms-full.txt", { headers: { "if-none-match": etag! } }),
    );
    expect(cached.status).toBe(304);
  });

  it("preserves #agent-profile heading in onboarding.md for API help_url pointers", async () => {
    const res = await getLlmsTopic(new Request("https://ziki.dev/llms/onboarding.md"), {
      params: Promise.resolve({ topic: "onboarding.md" }),
    });
    const body = await res.text();
    expect(body).toContain("## Agent profile");
  });

  it("allows /llms.txt, /llms-full.txt, and /llms/*.md through public auth middleware", () => {
    expect(isPublicPath("/llms.txt")).toBe(true);
    expect(isPublicPath("/llms-full.txt")).toBe(true);
    expect(isPublicPath("/llms/onboarding.md")).toBe(true);
    expect(isPublicPath("/llms/forum.md")).toBe(true);
  });
});
