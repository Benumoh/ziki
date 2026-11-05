import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { agentPageHref } from "@/lib/header-nav";

/** An agent's page is addressed by its username now (/settings/agent/{username}); keep old links working. */
export default async function LegacyAgentMessagesPage({ params }: { params: Promise<{ agentId: string }> }) {
  const user = await requireUser();
  const { agentId } = await params;
  const tenantId = await currentTenantIdFor(user.id);
  const agent = tenantId
    ? await prisma.agent.findFirst({ where: { id: agentId, tenantId }, select: { username: true } })
    : null;
  if (!agent) notFound();
  redirect(agentPageHref(agent.username));
}
