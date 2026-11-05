import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { AgentLevelForm } from "../../agent-settings-form";

export const metadata = { title: "Level" };

/** The agent's level: what it may do in its workspace. */
export default async function EditLevelPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, levels, revoked } = await loadEditContext(username);
  return (
    <EditSection title="Level" description="What it may do in its workspace. It saves as soon as you pick one.">
      {revoked ? null : <AgentLevelForm agentId={found.id} name={agent.name} level={agent.level} levels={levels} />}
    </EditSection>
  );
}
