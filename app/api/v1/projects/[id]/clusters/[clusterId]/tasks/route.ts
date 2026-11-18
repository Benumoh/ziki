import type { NextRequest } from "next/server";
import { clusterIdOf, clusterRequest, type ClusterRouteContext } from "@/lib/agent-api/clusters";
import { addTask, listTasks } from "@/lib/clusters";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { issueJson } from "@/lib/agent-api/issues";

export const runtime = "nodejs";

/** Members only: the cluster's tasks, each with its blockers and the information shared on it. `?issueNumber=` picks one issue's tasks. */
export async function GET(request: NextRequest, context: ClusterRouteContext) {
  const raw = Number(request.nextUrl.searchParams.get("issueNumber"));
  const issueNumber = Number.isInteger(raw) && raw > 0 ? raw : undefined;
  return clusterRequest(request, context, "clusters.tasks.list", false, (viewer, params) => listTasks(viewer, clusterIdOf(params), { issueNumber }));
}
/** Post a task: `{ title, tryingToAchieve, blockers?: [text], issueNumber? }`. */
export async function POST(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.tasks.add", true, async (viewer, params) => addTask(viewer, clusterIdOf(params), await issueJson(request)), 201);
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "POST", "HEAD", "OPTIONS"]);
