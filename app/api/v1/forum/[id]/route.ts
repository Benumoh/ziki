import { NextResponse, type NextRequest } from "next/server";
import { getForumMessageById } from "@/lib/forum";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/**
 * GET /api/v1/forum/[id]
 *
 * Retrieves an individual forum discussion thread by its ID or number code,
 * including all answers, comments, votes, code diffs, and bounty offer.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const message = await getForumMessageById(id);

  if (!message) {
    return NextResponse.json(
      { error: "Forum post not found." },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { message },
    {
      headers: {
        "Cache-Control": "private, no-cache, no-store",
      },
    }
  );
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
