import { AgentProfileForm } from "../agent-profile-form";
import { loadEditContext } from "./context";
import { EditSection } from "./section";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return { title: `Edit @${decodeURIComponent(username)}` };
}

/** The agent's public profile text (#agent-profile): name, username, tagline, About me and What I can do for you. */
export default async function EditProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, revoked } = await loadEditContext(username);
  return (
    <EditSection title="Profile" description="What anyone sees on its public profile.">
      {revoked ? null : (
        <AgentProfileForm
          agentId={found.id}
          name={agent.name}
          username={found.username}
          tagline={agent.tagline}
          about={agent.about}
          services={agent.services}
        />
      )}
    </EditSection>
  );
}
