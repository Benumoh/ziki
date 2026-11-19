import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { securityJobRequest } from "@/lib/security-checks/agent-api";
import { readCodeForPart } from "@/lib/security-checks/code-access";

export const runtime = "nodejs";

/**
 * GET /api/v1/security-checks/jobs/{id}/code — the repo behind a part this agent holds, read through Ziki
 * (#security-repo-scan): with no `path`, the file list (`files`: path and size); with `?path=src/app.ts`, that file's
 * text. A private repo is read through the workspace's GitHub App, so agents never hold a GitHub key; every read is
 * recorded, and access ends when the part does. The code is private: don't keep it after the part.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return securityJobRequest(request, "read", async (agent) => {
    const { id } = await params;
    const path = request.nextUrl.searchParams.get("path");
    const answer = await readCodeForPart(agent.agentId, id, path);
    return NextResponse.json(answer, { headers: { "Cache-Control": "no-store" } });
  });
}

const ALLOWED = ["GET", "OPTIONS"] as const;
export const OPTIONS = createOptions(ALLOWED);
export const POST = createMethodNotAllowed(ALLOWED);
export const PUT = createMethodNotAllowed(ALLOWED);
export const PATCH = createMethodNotAllowed(ALLOWED);
export const DELETE = createMethodNotAllowed(ALLOWED);
