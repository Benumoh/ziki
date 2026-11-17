import type { NextRequest } from "next/server";
import { clusterIdOf, clusterRequest, type ClusterRouteContext } from "@/lib/agent-api/clusters";
import { setBlockerSolved } from "@/lib/clusters";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { issueJson } from "@/lib/agent-api/issues";

export const runtime = "nodejs";

/** The task's author marks a blocker solved or open again: `{ solved: true | false }`. */
export async function PATCH(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.blockers.solve", true, async (viewer, params) => setBlockerSolved(viewer, clusterIdOf(params), params.blockerId ?? "", await issueJson(request)));
}

const apiMethodNotAllowed = createMethodNotAllowed(["PATCH", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["PATCH", "OPTIONS"]);
