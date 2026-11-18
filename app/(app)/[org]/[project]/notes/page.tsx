import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { issuesPath, projectPath } from "@/lib/project-paths";
import { humanNotesActor, readProjectNotes, listNoteComments, listNoteRevisions } from "@/lib/project-notes";
import { NotesDocument } from "./notes-document";
import { AddNoteButton, NoteCommentsList, type NoteCommentItemData } from "./note-comments";

export const metadata = { title: "Project notes" };
/** `/<slug>/notes` (#project-urls): the slug picks the project and checks access. */
export default async function NotesPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ cursor?: string; history?: string }>;
}) {
  const { org, project: slugParam } = await routeParams;
  const { user, organisationId, project: current, isOrgMember, isProjectMember } = await requireProject(org, slugParam);
  if (!isOrgMember && !isProjectMember && user.role !== "super_admin") notFound();
  const projectId = current.id;
  const slug = current.ref;
  const params = await searchParams;
  const actor = await humanNotesActor(user, organisationId, projectId);
  const [project, result, comments, revisions] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
    readProjectNotes(actor),
    listNoteComments(actor, new URLSearchParams(params.cursor ? { cursor: params.cursor } : {})),
    listNoteRevisions(actor, new URLSearchParams({ limit: "10", ...(params.history ? { cursor: params.history } : {}) })),
  ]);
  const pageHref = (key: "cursor" | "history", cursor: string) => {
    const next = new URLSearchParams({ ...(params.cursor ? { cursor: params.cursor } : {}), ...(params.history ? { history: params.history } : {}), [key]: cursor });
    return `${projectPath(slug, "/notes")}?${next}`;
  };

  const formattedComments: NoteCommentItemData[] = comments.items.map((comment) => ({
    id: comment.id,
    authorName: comment.authorName,
    agentId: comment.agentId,
    createdAt: comment.createdAt.toISOString(),
    body: comment.body,
    upvotes: comment.upvotes,
    downvotes: comment.downvotes,
    myVote: comment.myVote === 1 ? 1 : comment.myVote === -1 ? -1 : 0,
    replies: comment.replies.map((reply) => ({
      id: reply.id,
      authorName: reply.authorName,
      agentId: reply.agentId,
      createdAt: reply.createdAt.toISOString(),
      body: reply.body,
      upvotes: reply.upvotes,
      downvotes: reply.downvotes,
      myVote: reply.myVote === 1 ? 1 : reply.myVote === -1 ? -1 : 0,
    })),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-extrabold tracking-tight text-zk-text">Project notes</h1>
        <div className="flex items-center gap-2">
          <AddNoteButton />
          <Link href={issuesPath(slug)} className="rounded-lg border border-zk-border px-3 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip">
            Back to issues
          </Link>
        </div>
      </div>
      <NotesDocument
        key={projectId}
        projectId={projectId}
        canEdit={result.canEdit}
        notes={result.notes ? { ...result.notes, updatedAt: result.notes.updatedAt.toISOString() } : null}
        revisions={revisions.items.map((revision) => ({ ...revision, createdAt: revision.createdAt.toISOString() }))}
        historyLink={revisions.nextCursor ? pageHref("history", revisions.nextCursor) : undefined}
      />
      <NoteCommentsList
        projectId={projectId}
        comments={formattedComments}
        nextCursorHref={comments.nextCursor ? pageHref("cursor", comments.nextCursor) : undefined}
        resetCursorHref={params.cursor || params.history ? projectPath(slug, "/notes") : undefined}
      />
    </div>
  );
}
