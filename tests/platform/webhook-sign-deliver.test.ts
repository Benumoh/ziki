import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Webhook signing and delivery: every delivery is signed over its timestamp and exact bytes, a stale or tampered signature fails verification, and a delivered row is never sent again. */
const mocks = vi.hoisted(() => ({ request: vi.fn(), check: vi.fn() }));
const db = vi.hoisted(() => ({
  webhookDelivery: { updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  webhookSubscription: { update: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/webhooks/ssrf", async (original) => ({ ...await original<typeof import("@/lib/webhooks/ssrf")>(), checkSsrf: mocks.check }));
import { attemptDelivery, processDelivery } from "@/lib/webhooks/deliver";
import { encryptSigningSecret, sign, verify } from "@/lib/webhooks/sign";

let status: number | null;
let req: EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
const options = { url: "https://receiver.test/hook", resolvedAddress: "93.184.216.34", rawSecret: "test-secret", eventId: "event-a", body: '{"message":"hello"}', now: 123456 };
function delivery(attemptCount = 0) {
  return { id: "delivery-a", attemptCount, subscription: {
    id: "subscription-a", enabled: true, url: options.url, signingSecretEncrypted: encryptSigningSecret(options.rawSecret),
    events: [],
    agent: { activations: [{ organisationId: "organisation-a" }], revokedAt: null, owner: { memberships: [{ organisationId: "organisation-a" }] } },
  }, event: { id: "event-a", organisationId: "organisation-a", type: "issue.created", payload: { issueId: "issue-a" }, actorAgentId: "agent-a", bugId: "issue-a", createdAt: new Date(0) } };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WEBHOOK_SECRET_KEY", "a".repeat(64));
  status = 200;
  mocks.request.mockImplementation((_url, _options, callback) => {
    req = Object.assign(new EventEmitter(), { end: vi.fn(() => {
      if (status !== null) queueMicrotask(() => callback({ statusCode: status, destroy: vi.fn() }));
    }), destroy: vi.fn() });
    return req;
  });
  mocks.check.mockResolvedValue({ ok: true, address: options.resolvedAddress });
  db.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
  db.webhookDelivery.findUnique.mockResolvedValue(delivery());
  db.webhookSubscription.update.mockResolvedValue({ failureCount: 1 });
  db.$transaction.mockImplementation((run) => run(db));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("pinned HTTPS transport", () => {
  it("connects to the checked IP and signs the exact transmitted bytes", async () => {
    expect(await attemptDelivery(options)).toEqual({ ok: true });
    const [url, transport] = mocks.request.mock.calls[0];
    expect(url.hostname).toBe("receiver.test");
    expect(transport.agent).toBe(false);
    const callback = vi.fn();
    transport.lookup("receiver.test", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, options.resolvedAddress, 4);
    transport.lookup("receiver.test", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: options.resolvedAddress, family: 4 }]);
    expect(transport.headers).toMatchObject({
      "X-Ziki-Delivery": "event-a", "X-Ziki-Timestamp": "123456",
      "X-Ziki-Signature": createHmac("sha256", options.rawSecret).update(`123456.${options.body}`).digest("hex"),
    });
    expect(req.end).toHaveBeenCalledWith(options.body);
  });
  it("does not follow redirects or send to an unvalidated IP literal", async () => {
    status = 302;
    expect((await attemptDelivery(options)).ok).toBe(false);
    mocks.request.mockClear();
    expect((await attemptDelivery({ ...options, url: "https://127.0.0.1/" })).ok).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("durable delivery attempts", () => {
  it("marks success delivered and resets the subscription failure streak", async () => {
    await processDelivery("delivery-a");
    expect(mocks.check).toHaveBeenCalledWith(options.url);
    expect(db.webhookDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "delivered", attemptCount: 1, nextAttemptAt: null }) }));
    expect(db.webhookSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: { failureCount: 0 } }));
  });
  it("does not take a live lease or resend a delivered row", async () => {
    db.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    await processDelivery("delivery-a");
    expect(db.webhookDelivery.findUnique).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(db.webhookDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["pending", "failed"] }, OR: expect.any(Array) }) }));
  });
  it("marks a failed attempt failed with its next try scheduled, then dead once attempts run out (#501)", async () => {
    status = 500;
    await processDelivery("delivery-a");
    expect(db.webhookDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", attemptCount: 1, nextAttemptAt: expect.any(Date), lastError: expect.any(String) }),
    }));

    db.webhookDelivery.updateMany.mockClear();
    db.webhookDelivery.findUnique.mockResolvedValue(delivery(4));
    await processDelivery("delivery-a");
    expect(db.webhookDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "dead", attemptCount: 5, nextAttemptAt: null }),
    }));
  });
  it("does not send events outside the subscription filter (#512)", async () => {
    const filtered = delivery();
    (filtered.subscription as { events?: string[] }).events = ["issue.created"];
    filtered.event.type = "comment.created";
    db.webhookDelivery.findUnique.mockResolvedValue(filtered);

    await processDelivery("delivery-a");

    expect(mocks.request).not.toHaveBeenCalled();
    expect(db.webhookDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "dead" }),
    }));
  });

});

describe("signatures", () => {
  const secret = "test-signing-secret-abc123";
  const body = JSON.stringify({ id: "evt-1", type: "issue.created" });
  const timestampMs = 1729350000000;

  it("covers the timestamp and the body", () => {
    const sig = sign({ rawSecret: secret, timestampMs, rawBody: body });
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sign({ rawSecret: secret, timestampMs: timestampMs + 1, rawBody: body })).not.toBe(sig);
    expect(sign({ rawSecret: secret, timestampMs, rawBody: body + " " })).not.toBe(sig);
  });

  it("verifies a fresh signature and rejects a tampered or stale one", () => {
    const sig = sign({ rawSecret: secret, timestampMs, rawBody: body });
    expect(verify({ rawSecret: secret, signature: sig, timestampMs, rawBody: body, now: timestampMs })).toBe(true);
    const tampered = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
    expect(verify({ rawSecret: secret, signature: tampered, timestampMs, rawBody: body, now: timestampMs })).toBe(false);
    const old = timestampMs - 6 * 60 * 1000;
    expect(verify({ rawSecret: secret, signature: sign({ rawSecret: secret, timestampMs: old, rawBody: body }), timestampMs: old, rawBody: body, now: timestampMs })).toBe(false);
  });
});
