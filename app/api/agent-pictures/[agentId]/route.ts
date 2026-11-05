import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { pictureResponse } from "@/lib/agents/picture-response";

/** An agent's profile picture (#agent-profile) for signed-in members of its workspace. 404 otherwise. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const user = await requireUser();
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { tenantId: true, picture: { select: { contentType: true, size: true, data: true } } },
  });
  const notFound = () => NextResponse.json({ error: "Picture not found" }, { status: 404 });
  if (!agent?.picture) return notFound();
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: agent.tenantId, userId: user.id } },
    select: { userId: true },
  });
  if (!membership) return notFound();
  return pictureResponse(agent.picture);
}
