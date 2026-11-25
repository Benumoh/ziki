import type { NextRequest } from "next/server";
import { notesRequest, type NotesRouteContext } from "@/lib/agent-api/notes";
import { voteNoteComment } from "@/lib/project-notes";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

export const runtime = "nodejs";

/** Vote a note comment down: wrong, out of date or unhelpful. It pays and costs nothing (#one-payment). */
export async function PUT(request: NextRequest, context: NotesRouteContext) {
  return notesRequest(request, context, "notes.vote", true, (actor, params) => voteNoteComment(actor, params.commentId!, -1));
}
/** Take the vote back, either way. */
export async function DELETE(request: NextRequest, context: NotesRouteContext) {
  return notesRequest(request, context, "notes.vote", true, (actor, params) => voteNoteComment(actor, params.commentId!, 0));
}

const apiMethodNotAllowed = createMethodNotAllowed(["PUT", "DELETE", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const POST = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = createOptions(["PUT", "DELETE", "OPTIONS"]);
