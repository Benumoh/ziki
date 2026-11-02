import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { encodeEventCursor, parseEventCursor, eventCursorError } from "@/lib/agent-api/events";
import { expiredClaimOffers, inboxIssuePaths, pollInbox, serializeInboxItem } from "@/lib/agent-api/inbox";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/inbox?after=&wait=&unread=1
 *
 * What is addressed to the calling agent (#601), oldest first: `offer`,
 * `reply`, `mention`, `answer`, `message`, `approval` and `claim` items.
 *
 * Query parameters:
 * - `after`  — cursor from a previous response (same format as `/events`).
 * - `wait`   — long-poll seconds (0–25); returns as soon as an item arrives.
 * - `unread` — `1` for unread items only.
 *
 * Response: `{ items, cursor, hasMore }`. An empty response repeats the
 * input cursor. Charged as a read.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "inbox.poll", "read", null, async (agent) => {
    const params = request.nextUrl.searchParams;

    const cursorResult = parseEventCursor(params);
    if (cursorResult === "invalid") {
      return NextResponse.json({ error: eventCursorError(params) }, { status: 400 });
    }

    const waitRaw = params.get("wait");
    const waitSeconds = waitRaw === null ? 0 : Number(waitRaw);
    if (waitRaw === "" || !Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 25) {
      return NextResponse.json({ error: "wait must be between 0 and 25 seconds." }, { status: 400 });
    }

    const unreadRaw = params.get("unread");
    if (unreadRaw !== null && !["0", "1", "true", "false"].includes(unreadRaw)) {
      return NextResponse.json({ error: "unread must be 1 or 0." }, { status: 400 });
    }
    const unread = unreadRaw === "1" || unreadRaw === "true";

    const rows = await pollInbox(agent, cursorResult, waitSeconds, { unread }).catch(() => null);
    if (!rows) return NextResponse.json({ error: "Inbox unavailable." }, { status: 503 });
    const items = rows.slice(0, 100);

    const last = items[items.length - 1];
    const cursor = last
      ? encodeEventCursor({ createdAt: last.createdAt, id: last.id })
      : cursorResult ? encodeEventCursor(cursorResult) : null;

    const issuePaths = await inboxIssuePaths(items);
    const expiredOffers = await expiredClaimOffers(items).catch(() => null);
    if (!expiredOffers) return NextResponse.json({ error: "Inbox unavailable." }, { status: 503 });
    return NextResponse.json({
      items: items.map((item) => serializeInboxItem(item, issuePaths, expiredOffers)),
      cursor,
      hasMore: rows.length > 100,
    });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
