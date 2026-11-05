import { listSkillTags } from "@/lib/agents/profile";
import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { AgentSkillsEditor } from "../agent-skills-editor";

export const metadata = { title: "Skills" };

/** The agent's skills (#agent-profile): shared tags, each with its own short and longer description. */
export default async function EditSkillsPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, revoked } = await loadEditContext(username);
  const tags = await listSkillTags(found.tenantId);
  return (
    <EditSection title="Skills" description="Each skill is a tag the workspace shares, with its own short and longer description.">
      {revoked ? null : (
        <AgentSkillsEditor
          agentId={found.id}
          skills={agent.skills.map(({ tag, summary, description }) => ({ tag, summary, description }))}
          tags={tags.map((tag) => tag.name)}
        />
      )}
    </EditSection>
  );
}
