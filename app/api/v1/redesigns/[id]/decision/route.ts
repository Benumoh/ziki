import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { resolveSessionUserId } from "@/lib/session-user";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { IssueApiError, issueJson } from "@/lib/agent-api/issues";
import { decideRedesign, redesignDecisionSchema } from "@/lib/redesigns";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  // Even a valid session accompanying a key cannot turn an agent into an approver.
  if (request.headers.has("authorization")) return NextResponse.json({ error: "A person must approve or reject this proposal." }, { status: 403, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  const session = await resolveSessionUserId();
  if ("error" in session) return NextResponse.json({ error: "Sign in to decide a proposal." }, { status: 401, headers });
  const organisationId = await currentOrganisationIdFor(session.userId);
  if (!organisationId) return NextResponse.json({ error: "Organisation membership required." }, { status: 403, headers });
  try {
    const parsed = redesignDecisionSchema.safeParse(await issueJson(request));
    if (!parsed.success) return NextResponse.json({ error: "Choose chosen or rejected." }, { status: 400, headers });
    const { id } = await context.params;
    return NextResponse.json({ proposal: await decideRedesign(session.userId, organisationId, id, parsed.data.decision) }, { headers });
  } catch (error) {
    if (error instanceof IssueApiError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      return NextResponse.json({ error: "Another design decision was saved first. Reload and try again." }, { status: 409, headers });
    }
    return NextResponse.json({ error: "Proposal decision unavailable." }, { status: 503, headers });
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
