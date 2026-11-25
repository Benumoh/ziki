import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * How an on-call guest reaches the workspace it is a guest in (12 Nov plan,
 * part D2). Kept free of heavy imports: requireAgent() uses it on every call.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What an on-call guest may not do in the workspace it is a guest in: anything
 * that would outlast its stay. A webhook made during the stay would keep sending
 * that client's activity after the guest has left; goals and research jobs are
 * the workspace's own planning, not a guest's to set.
 */
export const GUEST_BLOCKED_ACTIONS: ReadonlySet<string> = new Set([
  "webhooks.create",
  "webhooks.enable",
  "webhooks.rotateSecret",
  "webhooks.retryDelivery",
  "goals.create",
  "goals.update",
  "goals.split",
  "jobs.create",
]);

export const GUEST_BLOCKED_MESSAGE =
  "On-call guests can't set up webhooks, goals or research jobs in a workspace they're visiting.";

/** A live guest stay: added as a guest, not ended, not switched off. */
export const LIVE_GUEST = { guest: true, guestEndedAt: null, deactivatedAt: null } as const satisfies Prisma.AgentActivationWhereInput;

/**
 * The workspace a request is for, when it is one where this agent is a live
 * guest: from `?projectId=` or from a work feed path (`/<org>/<project>/work`).
 * Null for anything else, so the call stays in the key's own workspace.
 * `guestIn` are the agent's live guest stays, already loaded with its key.
 */
export async function guestOrganisationFor(
  db: Db,
  url: string | undefined,
  guestIn: readonly { organisationId: string }[],
): Promise<string | null> {
  if (!url || guestIn.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "https://ziki.dev");
  } catch {
    return null;
  }
  const live = new Set(guestIn.map((stay) => stay.organisationId));
  const projectId = parsed.searchParams.get("projectId")?.trim();
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { organisationId: true } });
    return project && live.has(project.organisationId) ? project.organisationId : null;
  }
  const feed = /^\/([^/]+)\/[^/]+\/work\/?$/.exec(parsed.pathname);
  if (feed && feed[1] !== "api") {
    const organisation = await db.organisation.findUnique({ where: { slug: decodeURIComponent(feed[1]) }, select: { id: true } });
    return organisation && live.has(organisation.id) ? organisation.id : null;
  }
  return null;
}
