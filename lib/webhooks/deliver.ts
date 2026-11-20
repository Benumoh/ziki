import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";
import { sign, decryptSigningSecret } from "@/lib/webhooks/sign";
import { checkSsrf, isPublicAddress } from "@/lib/webhooks/ssrf";

export const DELIVERY_TIMEOUT_MS = 10_000;
export const MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 1_000;
const LEASE_MS = 60_000;
/**
 * A delivery still waiting to go out (#501): `pending` before its first attempt
 * (or after a manual retry), `failed` once an attempt failed and the next is
 * scheduled. The dispatcher picks up both; `dead` means it gave up.
 */
const WAITING = { in: ["pending", "failed"] as ("pending" | "failed")[] };
type DeliveryResult = { ok: true } | { ok: false; error: string };

/** Pin DNS lookup while retaining the original Host and TLS certificate checks. */
export async function attemptDelivery(params: {
  url: string; resolvedAddress: string; rawSecret: string; eventId: string; body: string; now?: number;
}): Promise<DeliveryResult> {
  const url = new URL(params.url);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || !isPublicAddress(params.resolvedAddress) ||
      (isIP(host) && host !== params.resolvedAddress)) {
    return { ok: false, error: "Unsafe webhook address." };
  }
  const timestampMs = params.now ?? Date.now();
  return new Promise((resolve) => {
    const finish = (result: DeliveryResult) => { clearTimeout(timer); resolve(result); };
    const req = httpsRequest(url, {
      method: "POST", agent: false,
      lookup: (_host, options, callback) => {
        const family = isIP(params.resolvedAddress);
        if (options.all) callback(null, [{ address: params.resolvedAddress, family }]);
        else callback(null, params.resolvedAddress, family);
      },
      headers: {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(params.body),
        "X-Ziki-Timestamp": String(timestampMs),
        "X-Ziki-Signature": sign({ rawSecret: params.rawSecret, timestampMs, rawBody: params.body }),
        "X-Ziki-Delivery": params.eventId,
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      response.destroy();
      finish(status >= 200 && status < 300 ? { ok: true } : { ok: false, error: `HTTP ${status}` });
    });
    req.on("error", () => finish({ ok: false, error: "Webhook connection failed." }));
    const timer = setTimeout(() => {
      finish({ ok: false, error: "Webhook delivery timed out." });
      req.destroy();
    }, DELIVERY_TIMEOUT_MS);
    req.end(params.body);
  });
}

/** Lease pending rows atomically so overlapping dispatchers cannot send the same attempt. */
export function webhookBody(event: {
  id: string;
  type: string;
  payload: unknown;
  actorAgentId: string | null;
  bugId: string | null;
  createdAt: Date;
}) {
  const eventPayload = (event.payload && typeof event.payload === "object") ? (event.payload as Record<string, unknown>) : {};
  const track = (eventPayload.track as string | undefined) ?? null;
  return {
    id: event.id,
    type: event.type,
    payload: event.payload,
    actorAgentId: event.actorAgentId,
    bugId: event.bugId,
    createdAt: event.createdAt.toISOString(),
    ...(track ? { track } : {}),
  };
}

export async function processDelivery(deliveryId: string, now = new Date()): Promise<void> {
  const lease = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: WAITING, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    data: { nextAttemptAt: lease },
  });
  if (!claimed.count) return;
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: {
    subscription: { include: { agent: { include: { activations: { where: { deactivatedAt: null }, select: { organisationId: true } }, owner: { select: { memberships: { select: { organisationId: true } } } } } } } },
    event: true,
  } });
  if (!delivery) return;
  const { subscription, event } = delivery;
  const agent = subscription.agent;
  if (!subscription.enabled || agent.revokedAt || !agent.activations.some((row) => row.organisationId === event.organisationId) ||
      !agent.owner.memberships.some((membership) => membership.organisationId === event.organisationId) ||
      (subscription.events.length > 0 && !subscription.events.includes(event.type))) {
    await prisma.webhookDelivery.updateMany({ where: { id: deliveryId, nextAttemptAt: lease }, data: { status: "dead", nextAttemptAt: null } });
    return;
  }
  let result: DeliveryResult;
  try {
    const address = await checkSsrf(subscription.url);
    result = address.ok ? await attemptDelivery({
      url: subscription.url, resolvedAddress: address.address,
      rawSecret: decryptSigningSecret(subscription.signingSecretEncrypted), eventId: event.id,
      body: JSON.stringify(webhookBody(event)),
    }) : { ok: false, error: "Webhook address is no longer public." };
  } catch { result = { ok: false, error: "Webhook signing configuration is invalid." }; }
  const attempts = delivery.attemptCount + 1;
  await prisma.$transaction(async (tx) => {
    const owned = await tx.webhookDelivery.updateMany({ where: { id: deliveryId, status: WAITING, nextAttemptAt: lease }, data: {
      attemptCount: attempts, status: result.ok ? "delivered" : attempts >= MAX_ATTEMPTS ? "dead" : "failed",
      nextAttemptAt: result.ok || attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + BACKOFF_BASE_MS * 2 ** (attempts - 1)),
      deliveredAt: result.ok ? new Date() : null, lastError: result.ok ? null : result.error,
    } });
    if (!owned.count) return;
    const updated = await tx.webhookSubscription.update({ where: { id: subscription.id },
      data: { failureCount: result.ok ? 0 : { increment: 1 } }, select: { failureCount: true } });
    if (!result.ok && (attempts >= MAX_ATTEMPTS || updated.failureCount >= MAX_ATTEMPTS)) {
      await tx.webhookSubscription.update({ where: { id: subscription.id }, data: { enabled: false, disabledAt: new Date() } });
      await tx.webhookDelivery.updateMany({ where: { subscriptionId: subscription.id, status: WAITING },
        data: { status: "dead", nextAttemptAt: null } });
    }
  });
}

/** DB rows survive process restarts; call repeatedly from the authenticated scheduler. */
export async function dispatchDueDeliveries() {
  const rows = await prisma.webhookDelivery.findMany({
    where: { status: WAITING, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: 10, select: { id: true },
  });
  for (let start = 0; start < rows.length; start += 5) {
    const results = await Promise.allSettled(rows.slice(start, start + 5).map((row) => processDelivery(row.id)));
    if (results.some((result) => result.status === "rejected")) throw new Error("Webhook dispatch failed; pending leases will recover.");
  }
  return rows.length;
}
