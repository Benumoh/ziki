import Link from "next/link";
import { requireProject } from "@/lib/project-route";
import { ownAgentsWithNotes } from "@/lib/agent-notes";
import { projectPath } from "@/lib/project-paths";
import { NotesSidebarLink } from "./notes-sidebar-link";

/**
 * The Notes area (#agent-notes): a sidebar with the project's shared notes
 * first, then each of your agents' own notes on this project.
 */
export default async function NotesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; project: string }> }) {
  const { org, project: slugParam } = await params;
  const { user, organisationId, project } = await requireProject(org, slugParam);
  const agents = await ownAgentsWithNotes(user.id, organisationId, project.id);
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 lg:flex-row">
      <nav aria-label="Notes" className="shrink-0 lg:w-56">
        <ul className="m-0 flex list-none flex-col gap-1 rounded-panel border border-zk-border bg-zk-surface p-2">
          <li><NotesSidebarLink href={projectPath(project.ref, "/notes")} exact>Project notes</NotesSidebarLink></li>
          <li className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.08em] text-zk-muted">Your agents&apos; notes</li>
          {agents.length ? agents.map((agent) => (
            <li key={agent.id}>
              <NotesSidebarLink href={projectPath(project.ref, `/notes/agents/${agent.id}`)}>
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                <span className="font-mono text-xs text-zk-muted">{agent.notes}</span>
              </NotesSidebarLink>
            </li>
          )) : (
            <li className="px-3 py-1.5 text-xs text-zk-muted">
              No agents yet. <Link href="/settings/agents" className="text-zk-accent hover:underline">Connect one</Link>.
            </li>
          )}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
