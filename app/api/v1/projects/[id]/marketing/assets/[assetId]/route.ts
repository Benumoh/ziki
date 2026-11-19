import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { updateMarketingAsset } from "@/lib/marketing/assets";
import { taskTypeJson, taskTypeRequest } from "@/lib/marketing/task-type-routes";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; assetId: string }> };

/**
 * PATCH /api/v1/projects/{id}/marketing/assets/{assetId}: rename a marketing asset or set its address,
 * `{ name?, url? }` (#marketing-assets). Any member or agent may, as on the asset's page.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id, assetId } = await context.params;
  return taskTypeRequest(request, id, "marketing.assets.update", "read", async (actor) => {
    const asset = await updateMarketingAsset(actor.organisationId, assetId, await taskTypeJson(request));
    return NextResponse.json({ asset });
  });
}

const ALLOWED = ["PATCH", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
