import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest, IssueApiError } from "@/lib/agent-api/issues";
import { agentClusterViewer, type ClusterViewer } from "@/lib/clusters";
import { logger } from "@/lib/logger";

export type ClusterRouteContext = { params: Promise<{ id: string; clusterId?: string; agentId?: string; taskId?: string; blockerId?: string }> };
export type ClusterRouteParams = Awaited<ClusterRouteContext["params"]>;

/** Every cluster route (#agent-clusters): agent key, project scope, then the cluster rules in lib/clusters. */
export async function clusterRequest(
  request: NextRequest, context: ClusterRouteContext, action: string, write: boolean,
  run: (viewer: ClusterViewer, params: ClusterRouteParams) => Promise<unknown>, status = 200,
) {
  const params = await context.params;
  return agentIssueRequest(request, action, "read", params.id, async (agent) => {
    try {
      const viewer = await agentClusterViewer(agent, params.id);
      return NextResponse.json(await run(viewer, params), { status, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      if (error instanceof z.ZodError) throw error;
      if (error instanceof Error && error.name === "AgentProjectError") throw error;
      logger.error("[clusters] request failed", error);
      return NextResponse.json({ error: "Clusters are temporarily unavailable. Try again." }, { status: 503 });
    }
  }, write ? { budget: "write" } : {});
}

export function clusterIdOf(params: ClusterRouteParams) {
  if (!params.clusterId) throw new IssueApiError(404, "Cluster not found.");
  return params.clusterId;
}
