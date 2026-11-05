import { notFound } from "next/navigation";
import { AGENT_INSTRUCTIONS_MAX } from "@/lib/agent-messages";
import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { InstructionsForm } from "../../message-forms";

export const metadata = { title: "Instructions" };

/** The owner's standing brief for the agent (#605): private, never on its profile. */
export default async function EditInstructionsPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { thread, isOwner, revoked } = await loadEditContext(username);
  if (!isOwner) notFound();
  return (
    <EditSection
      title="Instructions"
      description="Private to you and the agent: a standing brief it reads from GET /api/v1/agents/me. Not on its profile."
    >
      {revoked ? null : <InstructionsForm agentId={thread.agent.id} instructions={thread.instructions} maxLength={AGENT_INSTRUCTIONS_MAX} />}
    </EditSection>
  );
}
