import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FEEDBACK_VISITOR_COOKIE, publicFeedbackVoteState, setPublicFeedbackVote } from "@/lib/public-feedback-votes";
import { isFeedbackOrigin, readFeedbackJson } from "@/lib/public-feedback-http";
import { clientRateLimitKey, consumeRateLimits } from "@/lib/rate-limit";

type Context = { params: Promise<{ org: string; project: string; number: string }> };
const voteSchema = z.object({ voted: z.boolean() }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function visitor(request: NextRequest) {
  const value = request.cookies.get(FEEDBACK_VISITOR_COOKIE)?.value;
  return value && /^[a-f0-9-]{36}$/.test(value) ? value : null;
}
async function state(request: NextRequest, context: Context) {
  const { org, project, number } = await context.params;
  if (!/^[1-9]\d{0,9}$/.test(number)) return null;
  return publicFeedbackVoteState({ orgSlug: org, projectSlug: project }, Number(number), visitor(request));
}

export async function GET(request: NextRequest, context: Context) {
  const current = await state(request, context);
  return current ? json({ count: current.count, voted: current.voted }) : json({ message: "Feedback not found." }, 404);
}

/** Explicit set/unset makes retries idempotent; one cookie represents one browser. */
export async function PUT(request: NextRequest, context: Context) {
  if (!isFeedbackOrigin(request)) return json({ message: "Vote from the feedback portal." }, 403);
  let body: unknown;
  try { body = await readFeedbackJson(request, 128); } catch { return json({ message: "Invalid vote." }, 400); }
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) return json({ message: "Invalid vote." }, 400);
  const limited = await consumeRateLimits([{ key: `feedback-vote:${clientRateLimitKey(request.headers)}`, config: { max: 30, windowMs: 60_000 } }]);
  if (!limited.allowed) {
    const response = json({ message: "Too many votes. Please wait a moment." }, 429);
    response.headers.set("Retry-After", String(Math.ceil(limited.retryAfterMs / 1000)));
    return response;
  }
  const current = await state(request, context);
  if (!current) return json({ message: "Feedback not found." }, 404);
  const identity = visitor(request) ?? randomUUID();
  const result = await setPublicFeedbackVote(current.bugId, identity, parsed.data.voted);
  const response = json(result);
  response.cookies.set(FEEDBACK_VISITOR_COOKIE, identity, {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60,
  });
  return response;
}
