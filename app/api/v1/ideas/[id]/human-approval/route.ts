import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { findIdea } from "@/lib/agent-api/ideas";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { getHumanApprovalSummary } from "@/lib/human-approval";

const flagSchema = z
  .object({
    projectId: z.string().trim().min(1).max(191).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

/**
 * POST /api/v1/ideas/:id/human-approval — flag an open idea as requiring
 * human approval per the project's `humanApprovalGuidelines`. Blocks conversion
 * until `humanApprovalsNeeded` human members (excluding the creator) approve.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "ideas.human_approval", "working", id, async (agent) => {
    const parsed = flagSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", message: "Send a reason (3–500 characters) explaining why human approval is needed." },
        { status: 400 },
      );
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    const found = await findIdea(scope, id);
    if (!found) return NextResponse.json({ error: "Idea not found." }, { status: 404 });

    const idea = await prisma.idea.findUniqueOrThrow({
      where: { id: found.id },
      select: { id: true, status: true },
    });
    if (idea.status !== "open") {
      return NextResponse.json({ error: "Only open ideas can be flagged for human approval." }, { status: 409 });
    }

    await prisma.idea.update({
      where: { id: found.id },
      data: { requiresHumanApproval: true, humanApprovalReason: parsed.data.reason },
    });
    await audit(agent, "idea.human_approval_flagged", `idea:${found.id}`, { reason: parsed.data.reason });
    const humanApproval = await getHumanApprovalSummary(prisma, { kind: "idea", id: found.id });
    return NextResponse.json({ ideaId: found.id, humanApproval });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
