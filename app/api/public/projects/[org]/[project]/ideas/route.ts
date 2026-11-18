import { NextResponse, type NextRequest } from "next/server";
import { optionalUser } from "@/lib/auth-helpers";
import {
  createPublicIdea,
  findPublicIdeaMatches,
  PUBLIC_IDEA_BODY_BYTES,
} from "@/lib/public-idea-intake";

type Context = { params: Promise<{ org: string; project: string }> };

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const publicHost = forwardedHost || request.headers.get("host");
    return Boolean(publicHost && new URL(origin).host.toLowerCase() === publicHost.toLowerCase());
  } catch {
    return false;
  }
}

function response(result: Awaited<ReturnType<typeof createPublicIdea>> | Awaited<ReturnType<typeof findPublicIdeaMatches>>) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (result.status === 429) headers.set("Retry-After", String(result.retryAfterSeconds));
  return NextResponse.json(result, { status: result.status, headers });
}

async function readJson(request: NextRequest): Promise<unknown | null | "too-large"> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes > PUBLIC_IDEA_BODY_BYTES) return "too-large";
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > PUBLIC_IDEA_BODY_BYTES) return "too-large";
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Public duplicate suggestions expose only allowlisted work-item fields. */
export async function GET(request: NextRequest, context: Context) {
  const { org, project } = await context.params;
  return response(await findPublicIdeaMatches(
    { orgSlug: org, projectSlug: project },
    request.nextUrl.searchParams.get("q") ?? "",
    request.headers,
  ));
}

/** Signed-out intake creates an idea only; it never confirms, assigns or starts work. */
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { status: 403, error: "forbidden", message: "Submit reports from the public project page." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const body = await readJson(request);
  if (body === "too-large") {
    return response({ status: 413, error: "too_large", message: "The report is too large." });
  }
  if (body === null) {
    return response({ status: 400, error: "invalid_request", message: "Send a valid JSON report." });
  }
  const { org, project } = await context.params;
  const user = await optionalUser();
  return response(await createPublicIdea(
    { orgSlug: org, projectSlug: project },
    body,
    request.headers,
    { submittedById: user?.id },
  ));
}
