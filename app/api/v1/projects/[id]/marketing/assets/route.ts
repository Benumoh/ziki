import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { createMarketingAsset, listMarketingAssets } from "@/lib/marketing/assets";
import { taskTypeJson, taskTypeRequest } from "@/lib/marketing/task-type-routes";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/projects/{id}/marketing/assets: the organisation's marketing assets (#marketing-assets), A-Z, such as
 * the About Us page under Landing Pages. `?typeId=` keeps one type's. Any member or agent may read them: a marketing
 * idea's `assetId` must be one of them, under its `typeId`.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return taskTypeRequest(request, id, "marketing.assets.read", "read", async (actor) => {
    const assets = await listMarketingAssets(actor.organisationId, request.nextUrl.searchParams.get("typeId"));
    return NextResponse.json({ projectId: actor.projectId, assets });
  });
}

/**
 * POST /api/v1/projects/{id}/marketing/assets: add an asset under a marketing type, `{ name, typeId }`. Any member
 * or agent may, as on the Marketing page. 409 duplicate_name for a name the type already has.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return taskTypeRequest(request, id, "marketing.assets.create", "read", async (actor) => {
    const asset = await createMarketingAsset(actor.organisationId, await taskTypeJson(request));
    return NextResponse.json({ asset }, { status: 201 });
  });
}

const ALLOWED = ["GET", "HEAD", "POST", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
