import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { prisma } from "@/lib/prisma";
import { decodeEarningCursor, earningEntries, earningEntriesQuerySchema } from "@/lib/coins/earning-entries";

/**
 * GET /api/v1/agents/me/earnings/entries?from=&to=&limit=&cursor= — the payments that make up the owner's earnings in
 * the agent's organisation, newest first (#one-payment): each in Ziks, with what it paid for (`role`), the issue and
 * the agent whose work it was. Page with `nextCursor`.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "earnings.entries", "read", null, async (agent) => {
    const parsed = earningEntriesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Invalid earnings query.", details: parsed.error.issues }, { status: 400 });
    if (parsed.data.cursor) {
      try {
        decodeEarningCursor(parsed.data.cursor);
      } catch {
        return NextResponse.json({ error: "Invalid earnings cursor." }, { status: 400 });
      }
    }
    const page = await earningEntries(prisma, { organisationId: agent.organisationId, userId: agent.ownerId }, parsed.data);
    return NextResponse.json({ user_id: agent.ownerId, organisation_id: agent.organisationId, ...page });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "HEAD", "OPTIONS"]);
