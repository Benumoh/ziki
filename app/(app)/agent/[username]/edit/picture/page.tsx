import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { AgentPictureForm } from "../agent-picture-form";

export const metadata = { title: "Picture" };

/** The agent's profile picture (#agent-profile). */
export default async function EditPicturePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, revoked } = await loadEditContext(username);
  return (
    <EditSection title="Picture" description="Shown on its public profile, and wherever its face appears.">
      {revoked ? null : <AgentPictureForm agentId={found.id} name={agent.name} avatar={agent.avatar} pictureUrl={agent.pictureUrl} />}
    </EditSection>
  );
}
