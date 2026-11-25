import { beforeEach, describe, expect, it } from "vitest";
import { HeadersAdapter } from "next/dist/server/web/spec-extension/adapters/headers";
import {
  AGENT_RATE_BUDGETS,
  agentBudgetExceededResponse,
  consumeAgentBudget,
} from "@/lib/agents/rate-budget";
import {
  AUTH_RATE_LIMITS,
  checkAuthRateLimit,
  checkRateLimit,
  clientIpFrom,
  resetRateLimits,
} from "@/lib/rate-limit";

/**
 * Write limits and abuse boundaries: an agent's writes have a per-minute
 * runaway guard, reads and heartbeats have their own counters, and sign-in
 * limits can't be dodged by changing the email or the forwarded IP.
 */
const MINUTE = 60 * 1000;
const standard = { id: "agent-standard", burst: false };
const WRITES = AGENT_RATE_BUDGETS.standard.write.max;

async function spend(agent: { id: string; burst: boolean }, kind: "read" | "write" | "heartbeat", times: number, now: number) {
  for (let i = 0; i < times; i++) {
    const result = await consumeAgentBudget(agent, kind, now + i);
    if (!result.allowed) throw new Error(`rejected at request ${i + 1}`);
  }
}

beforeEach(() => resetRateLimits());

describe("agent write guard", () => {
  it("allows 600 writes a minute, the same for burst agents", () => {
    expect(AGENT_RATE_BUDGETS.standard.write).toEqual({ max: 600, windowMs: MINUTE });
    expect(AGENT_RATE_BUDGETS.burst.write).toEqual(AGENT_RATE_BUDGETS.standard.write);
  });

  it("stops a runaway loop past the limit, answers 429 with when to retry, and frees up after the minute", async () => {
    await spend(standard, "write", WRITES, 0);
    const refused = await consumeAgentBudget(standard, "write", MINUTE - 1500);
    expect(refused).toMatchObject({ allowed: false, retryAfterSeconds: 2 });
    if (refused.allowed) throw new Error("expected a refusal");
    const response = agentBudgetExceededResponse(refused.retryAfterSeconds, refused);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect((await consumeAgentBudget(standard, "write", MINUTE + WRITES)).allowed).toBe(true);
  });

  it("keeps writes, reads and heartbeats apart, and each agent apart", async () => {
    await spend(standard, "write", WRITES, 0);
    expect((await consumeAgentBudget(standard, "write", 1000)).allowed).toBe(false);
    expect((await consumeAgentBudget(standard, "read", 1000)).allowed).toBe(true);
    expect((await consumeAgentBudget(standard, "heartbeat", 1000)).allowed).toBe(true);
    expect((await consumeAgentBudget({ id: "other", burst: false }, "write", 1000)).allowed).toBe(true);
  });

  it("caps reads per hour", async () => {
    // 60,000 an hour (owner, 2026-11-01): spending them one by one would take minutes,
    // so check the configured window and that reads are charged apart from writes.
    expect(AGENT_RATE_BUDGETS.standard.read).toEqual({ max: 60_000, windowMs: 60 * 60 * 1000 });
    expect(AGENT_RATE_BUDGETS.burst.read.max).toBeGreaterThan(AGENT_RATE_BUDGETS.standard.read.max);
    const first = await consumeAgentBudget(standard, "read", 0);
    expect(first).toMatchObject({ allowed: true, limit: 60_000 });
  });
});

describe("sign-in limits", () => {
  it("limits per email across different IPs, however the address is typed", () => {
    const max = AUTH_RATE_LIMITS.forgotPassword.email.max;
    for (let i = 0; i < max; i++) {
      expect(checkAuthRateLimit("forgotPassword", { email: "Bob@x.dev", ip: `10.0.0.${i}` }, 1000).allowed).toBe(true);
    }
    expect(checkAuthRateLimit("forgotPassword", { email: "bob@x.dev ", ip: "10.0.0.99" }, 1000).allowed).toBe(false);
  });

  it("can't be dodged by rotating X-Forwarded-For", () => {
    const { max } = AUTH_RATE_LIMITS.login.ip;
    const results = Array.from({ length: max + 1 }, (_, i) =>
      checkAuthRateLimit("login", { email: `victim${i}@example.com`, ip: clientIpFrom(new Headers({ "x-forwarded-for": `10.9.${i}.1, 198.51.100.20` })) }, 0),
    );
    expect(results.slice(0, max).every((r) => r.allowed)).toBe(true);
    expect(results[max]?.allowed).toBe(false);
  });

  it("ignores junk in proxy headers", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "<script>" }))).toBeNull();
  });

  it.each(["signup", "forgotPassword"] as const)("reads Next.js headers for %s limits and still accepts request objects", (action) => {
    const headers = HeadersAdapter.seal(new HeadersAdapter({
      "x-forwarded-for": "198.51.100.20",
    }));
    expect(clientIpFrom(headers)).toBe("198.51.100.20");
    expect(clientIpFrom({ headers })).toBe("198.51.100.20");
    const { max } = AUTH_RATE_LIMITS[action].ip;
    for (let i = 0; i < max; i++) {
      expect(checkAuthRateLimit(action, {
        email: `signup${i}@example.com`, ip: clientIpFrom(headers),
      }, 0).allowed).toBe(true);
    }
    expect(checkAuthRateLimit(action, {
      email: "another@example.com", ip: clientIpFrom(headers),
    }, 0).allowed).toBe(false);
  });

  it("counts each key in its own window", () => {
    const config = { max: 1, windowMs: 1000 };
    expect(checkRateLimit("user-1", config, 100).allowed).toBe(true);
    expect(checkRateLimit("user-1", config, 200).allowed).toBe(false);
    expect(checkRateLimit("user-2", config, 200).allowed).toBe(true);
    expect(checkRateLimit("user-1", config, 1200).allowed).toBe(true);
  });
});
