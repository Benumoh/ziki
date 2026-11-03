import { Prisma, type PrismaClient } from "@prisma/client";
import { AGENT_EVENT_TYPES } from "@/lib/agent-api/event-types";

/**
 * Webhook subscription limits (#512).
 *
 * Each subscription can multiply outbound traffic, so an agent may keep at
 * most `MAX_SUBSCRIPTIONS_PER_AGENT` of them, the same URL only once, and may
 * narrow deliveries to some event types (`events`; empty means every event).
 */

export const MAX_SUBSCRIPTIONS_PER_AGENT = 3;

type Db = PrismaClient | Prisma.TransactionClient;

export type SubscribedWebhook = {
  id: string;
  url: string;
  enabled: boolean;
  createdAt: Date;
  events: string[];
};

export type CreateSubscriptionResult =
  | { ok: true; subscription: SubscribedWebhook }
  | { ok: false; status: 409; error: string };

/** Trim, drop blanks and duplicate event names. `[]` means "all events". */
export function normalizeSubscriptionEvents(events: readonly string[] | undefined): string[] {
  if (!events) return [];
  return [...new Set(events.map((event) => event.trim()).filter(Boolean))];
}

export type SubscriptionEventValidation =
  | { ok: true; events: string[] }
  | { ok: false; invalidEvents: string[]; validTypes: typeof AGENT_EVENT_TYPES };

/** Reject filters that can never match an event published to the feed. */
export function validateSubscriptionEvents(events: readonly string[] | undefined): SubscriptionEventValidation {
  const normalized = normalizeSubscriptionEvents(events);
  const known = new Set<string>(AGENT_EVENT_TYPES);
  const invalidEvents = normalized.filter((event) => !known.has(event));
  if (invalidEvents.length) return { ok: false, invalidEvents, validTypes: AGENT_EVENT_TYPES };
  return { ok: true, events: normalized };
}

export async function createSubscriptionRecord(
  db: Db,
  params: {
    agentId: string;
    url: string;
    events: string[];
    signingSecretEncrypted: string;
  },
): Promise<CreateSubscriptionResult> {
  const executeInTransaction = async (tx: Db): Promise<CreateSubscriptionResult> => {
    // #498: lock agent row to serialize parallel subscription creations for the agent
    if ("$queryRaw" in tx && typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "id" = ${params.agentId} FOR UPDATE`;
    }

    const [existingCount, duplicate] = await Promise.all([
      tx.webhookSubscription.count({ where: { agentId: params.agentId } }),
      tx.webhookSubscription.findFirst({
        where: { agentId: params.agentId, url: params.url },
        select: { id: true },
      }),
    ]);
    if (duplicate) {
      return { ok: false, status: 409, error: "That URL is already subscribed for this agent." };
    }
    if (existingCount >= MAX_SUBSCRIPTIONS_PER_AGENT) {
      return {
        ok: false,
        status: 409,
        error: `An agent can have at most ${MAX_SUBSCRIPTIONS_PER_AGENT} webhook subscriptions. Delete one first.`,
      };
    }

    try {
      const subscription = await tx.webhookSubscription.create({
        data: {
          agentId: params.agentId,
          url: params.url,
          events: params.events,
          signingSecretEncrypted: params.signingSecretEncrypted,
        },
        select: { id: true, url: true, enabled: true, createdAt: true, events: true },
      });
      return { ok: true, subscription };
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError ||
          (typeof error === "object" && error !== null && "code" in error)) &&
        (error as { code: unknown }).code === "P2002"
      ) {
        return { ok: false, status: 409, error: "That URL is already subscribed for this agent." };
      }
      throw error;
    }
  };

  if ("$transaction" in db && typeof db.$transaction === "function") {
    return (db.$transaction as (fn: (tx: Db) => Promise<CreateSubscriptionResult>) => Promise<CreateSubscriptionResult>)(
      executeInTransaction,
    );
  }
  return executeInTransaction(db);
}
