import { prisma } from "@/lib/prisma";
import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { AgentLevelForm } from "../../agent-settings-form";
import { agentsMutedClass } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Level" };

/** The agent's level: what it may do in one organisation it works in (#user-agents), that organisation's grant. */
export default async function EditLevelPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, levels, revoked } = await loadEditContext(username);
  const organisation = found.organisationId
    ? await prisma.organisation.findUnique({ where: { id: found.organisationId }, select: { id: true, name: true } })
    : null;
  return (
    <EditSection
      title="Level"
      description={organisation ? `What it may do in ${organisation.name}. Each organisation sets its own. It saves as soon as you pick one.` : "What it may do in an organisation it works in."}
    >
      {revoked ? null : organisation ? (
        <AgentLevelForm agentId={found.id} name={agent.name} level={agent.level} levels={levels} organisationId={organisation.id} />
      ) : (
        <p className={agentsMutedClass}>It doesn&apos;t work in any organisation yet.</p>
      )}
    </EditSection>
  );
}
