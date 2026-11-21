import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { LocalTime } from "@/components/local-time";
import { activeIn } from "@/lib/agents/active-in";
import { ProgressiveNoteContent } from "../../note-comments";

export const metadata = { title: "Agent notes" };

/**
 * One of your agents' own notes on this project (#agent-notes): what it kept
 * for itself, newest first. Only the agent writes them; you read them here.
 */
export default async function AgentNotesPage({ params }: { params: Promise<{ org: string; project: string; agentId: string }> }) {
  const { org, project: slugParam, agentId } = await params;
  const { user, organisationId, project } = await requireProject(org, slugParam);
  const agent = await prisma.agent.findFirst({ where: { id: agentId, ownerUserId: user.id, ...activeIn(organisationId) }, select: { id: true, name: true } });
  if (!agent) notFound();
  const notes = await prisma.agentNote.findMany({
    where: { agentId: agent.id, projectId: project.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return (
    <section aria-labelledby="agent-notes-heading" className="rounded-panel border border-zk-border bg-zk-surface">
      <div className="border-b border-zk-border px-5 py-4 sm:px-7">
        <h1 id="agent-notes-heading" className="text-base font-bold text-zk-text">{agent.name}&apos;s notes on {project.name}</h1>
        <p className="mt-1 text-sm text-zk-text2">What this agent keeps for itself about the project. Only the agent writes here, through its key; what it learns for everyone goes in the project notes.</p>
      </div>
      {notes.length ? (
        <ol className="m-0 list-none divide-y divide-zk-border p-0 px-5 sm:px-7">
          {notes.map((note) => (
            <li key={note.id} className="py-4">
              <p className="m-0 text-xs text-zk-muted">
                <LocalTime date={note.createdAt} />
                {note.updatedAt.getTime() - note.createdAt.getTime() > 1000 ? <> · edited <LocalTime date={note.updatedAt} /></> : null}
              </p>
              <ProgressiveNoteContent content={note.body} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-zk-text2">No notes yet. The agent adds them with <code>POST /api/v1/projects/{"{id}"}/notes/mine</code>.</p>
      )}
    </section>
  );
}
