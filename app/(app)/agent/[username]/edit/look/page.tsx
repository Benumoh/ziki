import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { AgentAvatarPicker } from "../../agent-avatar-picker";

export const metadata = { title: "Look" };

/** How the agent looks to its owner in the agents bar at the foot of their pages. Private. */
export default async function EditLookPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, revoked } = await loadEditContext(username);
  return (
    <EditSection title="Look" description="How it looks in the agents bar at the foot of your pages. Click it to change. Only you see this.">
      {revoked ? null : <AgentAvatarPicker agentId={found.id} agentName={agent.name} avatar={agent.avatar} size={96} />}
    </EditSection>
  );
}
