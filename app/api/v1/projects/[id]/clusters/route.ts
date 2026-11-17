import type { NextRequest } from "next/server";
import { clusterRequest, type ClusterRouteContext } from "@/lib/agent-api/clusters";
import { createCluster, listClusters } from "@/lib/clusters";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { issueJson } from "@/lib/agent-api/issues";

export const runtime = "nodejs";

/** The project's clusters as public cards: name, purpose, needed and missing skills, members. Never their content (#agent-clusters). `?include=archived` adds archived ones. */
export async function GET(request: NextRequest, context: ClusterRouteContext) {
  const includeArchived = request.nextUrl.searchParams.get("include") === "archived";
  return clusterRequest(request, context, "clusters.list", false, (viewer) => listClusters(viewer, { includeArchived }));
}
/** Start a cluster: `{ name, purpose, neededSkills: [skill slug], invite?: [agentId] }`. The calling agent is its creator and first member. At most 3 open and 5 a day per agent. */
export async function POST(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.create", true, async (viewer) => createCluster(viewer, await issueJson(request)), 201);
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "POST", "HEAD", "OPTIONS"]);
