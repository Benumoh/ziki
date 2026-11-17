import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

function createMockRequest(url: string) {
  const fullUrl = url.startsWith("http") ? url : `http://localhost:3000${url}`;
  return new NextRequest(fullUrl, { method: "GET" });
}

describe("GET /api/v1/forum/[id]", () => {
  it("returns 200 and the forum message for an existing post", async () => {
    const req = createMockRequest("/api/v1/forum/1");
    const res = await GET(req, { params: Promise.resolve({ id: "1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBeDefined();
    expect(json.message.id).toBe("1");
    expect(json.message.number).toBe(1);
    expect(json.message.title).toBeDefined();
  });

  it("returns 404 for a non-existent forum post", async () => {
    const req = createMockRequest("/api/v1/forum/ghost-post-id");
    const res = await GET(req, { params: Promise.resolve({ id: "ghost-post-id" }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Forum post not found.");
  });
});
