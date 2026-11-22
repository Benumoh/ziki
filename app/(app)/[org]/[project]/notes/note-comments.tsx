"use client";

import { getNotePreview } from "@/lib/notes-preview";

import { useState, useTransition } from "react";
import Link from "next/link";
import { RichText } from "@/components/rich-text";
import { NoteCommentVoteBadge } from "@/components/vote-badge";
import { addNoteCommentAction } from "./actions";

/** The id the composer's text field has, for the Add note button to focus (#740). */
export const NOTE_COMPOSER_FIELD_ID = "note-comment-body";

export { getNotePreview } from "@/lib/notes-preview";

/**
 * Progressive disclosure for notes and comments:
 * Shows a concise, scannable preview upfront (a 3-4 line sentence summary),
 * and provides an inline toggle to expand code blocks, lists, and deep details.
 * When there is no hidden content, no toggle button is displayed.
 */
export function ProgressiveNoteContent({
  content,
  expanded,
  onToggle,
  className,
}: {
  content: string;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = expanded !== undefined ? expanded : internalExpanded;
  const toggle = onToggle ?? (() => setInternalExpanded((prev) => !prev));

  const { preview, hasMore, hasCode } = getNotePreview(content);

  if (!hasMore) {
    return <RichText content={content} className={className ?? "text-zk-text"} />;
  }

  return (
    <div className="space-y-1.5">
      {isExpanded ? (
        <RichText content={content} className={className ?? "text-zk-text"} />
      ) : (
        <RichText content={preview} className={className ?? "text-zk-text"} />
      )}
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 text-xs font-semibold text-zk-accent hover:underline focus-visible:outline-2 focus-visible:outline-zk-accent"
        aria-expanded={isExpanded}
      >
        <span>
          {isExpanded
            ? "Show less"
            : hasCode
            ? "Show more details & code"
            : "Show more details"}
        </span>
        <span aria-hidden="true">{isExpanded ? "▴" : "›"}</span>
      </button>
    </div>
  );
}

/** A member writes a note comment (#732). An error keeps the draft. */
export function NoteCommentComposer({ projectId }: { projectId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [pending, startTransition] = useTransition();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write a note first.");
      return;
    }
    startTransition(async () => {
      const result = await addNoteCommentAction(projectId, body);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody("");
      setError(null);
      setPosted(true);
    });
  };
  return (
    <form onSubmit={submit} className="border-b border-zk-border px-5 py-4 sm:px-7">
      <label htmlFor={NOTE_COMPOSER_FIELD_ID} className="text-sm font-semibold text-zk-text">Add a note</label>
      <textarea
        id={NOTE_COMPOSER_FIELD_ID}
        value={body}
        onChange={(event) => { setBody(event.target.value); setPosted(false); }}
        rows={3}
        maxLength={10_000}
        placeholder="Something you learned about this project that would help others: a gotcha, a convention, where something lives. Summarize key findings first to keep notes scannable."
        className="mt-2 w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text"
        aria-describedby={error ? "note-comment-error" : undefined}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-electric-blue-strong px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Posting…" : "Post note"}
        </button>
        {error ? <p id="note-comment-error" role="alert" className="text-sm text-zk-bad-fg">{error}</p> : null}
        {posted && !error ? <p role="status" className="text-sm text-zk-ok-fg">Posted.</p> : null}
      </div>
    </form>
  );
}

/**
 * The Notes page's Add note button (#740): it takes you to the note composer
 * with the cursor in its text field. Every member may add a note, so it always
 * shows; it doesn't edit the official notes.
 */
export function AddNoteButton() {
  const focusComposer = () => {
    const field = document.getElementById(NOTE_COMPOSER_FIELD_ID);
    if (!field) return;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus({ preventScroll: true });
  };
  return (
    <button type="button" onClick={focusComposer} className="rounded-lg bg-electric-blue-strong px-3 py-2 text-sm font-semibold text-white hover:brightness-110">
      Add note
    </button>
  );
}

/**
 * Reply to a note (#732): a correction or an adaptation of what it learned.
 * A Reply button that opens a small form, with the cursor in it.
 */
export function NoteReplyForm({ projectId, parentId }: { projectId: string; parentId: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-xs font-semibold text-zk-muted hover:bg-zk-chip hover:text-zk-text">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        Reply
      </button>
    );
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return setError("Write a reply first.");
    startTransition(async () => {
      const result = await addNoteCommentAction(projectId, body, parentId);
      if (result.error) return setError(result.error);
      setBody("");
      setError(null);
      setOpen(false);
    });
  };
  return (
    <form onSubmit={submit} aria-label="Reply to this note" className="mt-2 flex flex-col gap-1.5">
      <textarea
        // Opened by tapping Reply, so typing can start at once.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label="Reply"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        maxLength={10_000}
        placeholder="A correction or an adaptation of this learning."
        className="w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text"
      />
      {error ? <p role="alert" className="m-0 text-xs text-zk-bad-fg">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-electric-blue-strong px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
          {pending ? "Sending…" : "Reply"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-zk-text2 hover:bg-zk-chip">
          Cancel
        </button>
      </div>
    </form>
  );
}

export type NoteCommentItemData = {
  id: string;
  authorName: string;
  agentId: string | null;
  createdAt: string;
  body: string;
  upvotes: number;
  downvotes: number;
  myVote: number;
  replies: {
    id: string;
    authorName: string;
    agentId: string | null;
    createdAt: string;
    body: string;
    upvotes: number;
    downvotes: number;
    myVote: number;
  }[];
};

/**
 * Clean, scannable team notes list with progressive disclosure and global Expand all / Collapse all.
 */
export function NoteCommentsList({
  projectId,
  comments,
  nextCursorHref,
  resetCursorHref,
}: {
  projectId: string;
  comments: NoteCommentItemData[];
  nextCursorHref?: string;
  resetCursorHref?: string;
}) {
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  const toggleAll = () => {
    const nextState = !allExpanded;
    setAllExpanded(nextState);
    const updated: Record<string, boolean> = {};
    comments.forEach((c) => {
      updated[c.id] = nextState;
      c.replies.forEach((r) => {
        updated[r.id] = nextState;
      });
    });
    setExpandedMap(updated);
  };

  const toggleComment = (id: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? allExpanded),
    }));
  };

  return (
    <section aria-labelledby="notes-discussion-heading" className="rounded-panel border border-zk-border bg-zk-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zk-border px-5 py-4 sm:px-7">
        <div className="max-w-2xl">
          <h2 id="notes-discussion-heading" className="text-base font-bold text-zk-text">Agent notes</h2>
          <p className="mt-1 text-sm text-zk-text2">Learnings, gotchas and shared tips from working agents and team members.</p>
        </div>
        {comments.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zk-border bg-zk-chip px-3 py-1.5 text-xs font-semibold text-zk-text hover:bg-zk-surface transition focus-visible:outline-2 focus-visible:outline-zk-accent"
            aria-label={allExpanded ? "Collapse all notes" : "Expand all notes"}
          >
            <span aria-hidden="true">{allExpanded ? "⤡" : "⤢"}</span>
            <span>{allExpanded ? "Collapse all" : "Expand all"}</span>
          </button>
        )}
      </div>
      <NoteCommentComposer projectId={projectId} />
      {comments.length ? (
        <ol className="divide-y divide-zk-border px-5 sm:px-7">
          {comments.map((comment) => (
            <li id={`comment-${comment.id}`} key={comment.id} className="flex gap-4 py-5">
              <div className="w-[52px] shrink-0 pt-0.5">
                <NoteCommentVoteBadge
                  projectId={projectId}
                  commentId={comment.id}
                  upvotes={comment.upvotes}
                  downvotes={comment.downvotes}
                  myVote={comment.myVote === 1 ? 1 : comment.myVote === -1 ? -1 : 0}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-zk-text">
                    {comment.authorName} <span className="font-normal text-zk-muted">· {comment.agentId ? "Agent" : "Member"}</span>
                  </p>
                  <time dateTime={comment.createdAt} className="text-xs text-zk-muted">
                    {comment.createdAt.slice(0, 16).replace("T", " ")} UTC
                  </time>
                </div>
                <ProgressiveNoteContent
                  content={comment.body}
                  expanded={expandedMap[comment.id] ?? allExpanded}
                  onToggle={() => toggleComment(comment.id)}
                />
                <NoteReplyForm projectId={projectId} parentId={comment.id} />
                {comment.replies.length ? (
                  <ul aria-label="Replies" className="m-0 mt-2 ml-2 flex list-none flex-col p-0">
                    {comment.replies.map((reply, index) => (
                      <li key={reply.id} id={`comment-${reply.id}`} className="relative pl-6 pt-2">
                        {index < comment.replies.length - 1 ? (
                          <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 border-l-2 border-zk-divider" />
                        ) : null}
                        <span aria-hidden="true" className="absolute left-0 top-0 h-7 w-5 rounded-bl-lg border-b-2 border-l-2 border-zk-divider" />
                        <div className="flex gap-3 rounded-xl border border-zk-border bg-zk-surface px-3 py-2.5">
                          <div className="w-[44px] shrink-0">
                            <NoteCommentVoteBadge
                              projectId={projectId}
                              commentId={reply.id}
                              upvotes={reply.upvotes}
                              downvotes={reply.downvotes}
                              myVote={reply.myVote === 1 ? 1 : reply.myVote === -1 ? -1 : 0}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px]">
                              <span className="text-zk-muted" aria-hidden="true">↳</span>
                              <b className="font-semibold text-zk-text">{reply.authorName}</b>
                              <span className="text-zk-muted">· {reply.agentId ? "Agent" : "Member"}</span>
                              <time dateTime={reply.createdAt} className="text-xs text-zk-muted">
                                · {reply.createdAt.slice(0, 16).replace("T", " ")} UTC
                              </time>
                            </p>
                            <ProgressiveNoteContent
                              content={reply.body}
                              expanded={expandedMap[reply.id] ?? allExpanded}
                              onToggle={() => toggleComment(reply.id)}
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-zk-text2">
          No notes yet. Add the first one above; agents can add theirs through the project notes API.
        </p>
      )}
      {nextCursorHref ? (
        <Link href={nextCursorHref} className="m-5 inline-block text-sm font-semibold text-zk-accent underline">
          Next comments
        </Link>
      ) : null}
      {resetCursorHref ? (
        <Link href={resetCursorHref} className="m-5 inline-block text-sm text-zk-accent underline">
          Latest notes and first comments
        </Link>
      ) : null}
    </section>
  );
}
