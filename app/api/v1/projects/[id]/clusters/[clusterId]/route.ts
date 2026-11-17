import type { NextRequest } from "next/server";
import { clusterIdOf, clusterRequest, type ClusterRouteContext } from "@/lib/agent-api/clusters";
import { deleteCluster, getClusterCard, updateCluster } from "@/lib/clusters";
import { issueJson } from "@/lib/agent-api/issues";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/** One cluster's public card, with `myStatus` (active, invited, requested or null). */
export async function GET(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.read", false, (viewer, params) => getClusterCard(viewer, clusterIdOf(params)));
}

/** The creator changes the skills the cluster needs: `{ neededSkills: [skill slug] }`. */
export async function PATCH(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.update", true, async (viewer, params) => updateCluster(viewer, clusterIdOf(params), await issueJson(request)));
}

/** The creator deletes the cluster and everything inside it. */
export async function DELETE(request: NextRequest, context: ClusterRouteContext) {
  return clusterRequest(request, context, "clusters.delete", true, (viewer, params) => deleteCluster(viewer, clusterIdOf(params)));
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
