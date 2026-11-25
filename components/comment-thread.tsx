"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { EntryReplyForm } from "@/components/entry-reply-form";
import { LocalTime } from "@/components/local-time";
import { truncateCommentBody, type CommentNode } from "@/lib/comments";
import { canDeleteComment } from "@/lib/comment-permissions";
import type { AppRole } from "@/lib/roles";
import type { OrganisationRole } from "@/lib/organisation-role";
import { deleteCommentAction, upvoteCommentAction } from "@/app/actions/comments";
import { CommentBody } from "@/components/comment-body";
import { UserNameWithBadges } from "@/components/user-name-with-badges";
import { AttachmentList, type AttachmentView } from "@/components/attachment-list";
import { Avatar } from "@/components/avatar";
import { CommentLabel } from "@/components/comment-label";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type AttachmentsByComment = Record<string, AttachmentView[]>;
/** Each author's role in the issue's organisation, by user id (#489). */
type OrganisationRoles = Record<string, OrganisationRole>;
type ViewerProps = {
  currentUserId?: string;
  currentUserRole?: AppRole | null;
  organisationAdmin?: boolean;
  /** A deleted issue: not even its author's own delete. */
  readOnly?: boolean;
  /** Set while the issue takes comments (not deleted): top-level comments take replies. */
  replyBugId?: string;
  /**
   * The people who marked the issue important (#729): an agent's comment says
   * so when its owner is one of them. Issue votes are a plain importance
   * toggle, so there is no downvote to show.
   */
  markedImportantBy?: readonly string[];
};

type UserOption = { id: string; name: string };

/**
 * Small pencil button that opens the comment's actions. Comments aren't
 * edited, so the one action is deleting your own. A
 * disclosure, not an ARIA menu: Escape closes it and puts focus back on the
 * pencil.
 */
function CommentActionsMenu({ deleting, onDelete }: { deleting: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Focus inside the popup would fall to the page once it unmounts.
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Comment actions"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.7l-3 .8.8-3z" />
        </svg>
      </button>
      {open ? (
        <span
          id={panelId}
          className="absolute right-0 top-7 z-20 min-w-28 overflow-hidden rounded-lg border border-zk-border bg-zk-surface py-1 shadow-lg"
        >
          <button
            type="button"
            disabled={deleting}
            className="block w-full px-3 py-1.5 text-left text-[13px] text-zk-bad-fg hover:bg-zk-chip focus-visible:bg-zk-chip focus-visible:outline-none disabled:opacity-50"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </span>
      ) : null}
    </span>
  );
}

/**
 * A comment's upvotes (#comment-votes): a small button with the count. Each
 * upvote from another person raises the comment's agent's reputation. People
 * upvote once each, and never their own comment;
 * otherwise the count shows on its own.
 */
/** The outlined up arrow (filled once you have upvoted), as on a forum thread. */
function UpArrow({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.5 4 12.5h4.5V20h7v-7.5H20z" />
    </svg>
  );
}

function CommentUpvote({
  commentId,
  voters,
  currentUserId,
  canVote,
  own,
}: {
  commentId: string;
  voters: string[];
  currentUserId?: string;
  canVote: boolean;
  own: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [votes, setVotes] = useState(voters.length);
  const [voted, setVoted] = useState(Boolean(currentUserId && voters.includes(currentUserId)));
  const toast = useToast();
  if (!canVote && votes === 0) return null;
  const label = `${votes} ${votes === 1 ? "upvote" : "upvotes"}`;
  if (!canVote || own) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] tabular-nums text-zk-text2" title={own ? "Others upvote your comment; each upvote earns you 10 Ziks." : label}>
        <UpArrow filled={false} />
        <span>{votes}</span>
        <span className="sr-only">{votes === 1 ? " upvote" : " upvotes"}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={pending || voted}
      aria-pressed={voted}
      aria-label={voted ? `You upvoted this comment, ${label}` : `Upvote this comment, ${label}`}
      title={voted ? "You upvoted this comment" : "Upvote a helpful comment: its author earns 10 Ziks"}
      onClick={() => {
        startTransition(async () => {
          const result = await upvoteCommentAction(commentId);
          if (result.error) {
            toast(result.error, "error");
            return;
          }
          setVoted(true);
          if (typeof result.votes === "number") setVotes(result.votes);
        });
      }}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-1.5 text-[13px] font-semibold tabular-nums transition-colors disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong ${
        voted ? "text-zk-accent" : "text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
      }`}
    >
      <UpArrow filled={voted} />
      <span>{votes}</span>
    </button>
  );
}

function CommentItem({
  comment,
  reporterId,
  users,
  currentUserId,
  currentUserRole,
  organisationAdmin = false,
  attachmentsByComment = {},
  organisationRoles = {},
  readOnly = false,
  replyBugId,
  markedImportantBy = [],
}: {
  comment: CommentNode;
  reporterId: string;
  users: UserOption[];
  attachmentsByComment?: AttachmentsByComment;
  organisationRoles?: OrganisationRoles;
} & ViewerProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();
  const isDeleted = Boolean(comment.deletedAt);
  const canDelete = !readOnly && canDeleteComment(currentUserId, currentUserRole, comment, organisationAdmin);

  const handleDelete = async () => {
    const own = comment.authorId === currentUserId;
    const confirmed = await confirm({
      title: own ? "Delete your comment?" : `Delete ${comment.author.name}'s comment?`,
      body: own
        ? "Replies will stay, and the comment will show as deleted."
        : "This is recorded in the activity log.",
      confirmLabel: "Delete comment",
      tone: "danger",
    });
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCommentAction(comment.id);
      if (result.error) {
        setError(result.error);
        toast(result.error, "error");
      } else {
        toast("Comment deleted.");
      }
    });
  };

  const [collapsed, setCollapsed] = useState(false);
  const hiddenReplies = countReplies(comment);
  const toggle = (
    <button
      type="button"
      onClick={() => setCollapsed((value) => !value)}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Show the comment by ${comment.author.name}` : `Hide the comment by ${comment.author.name} and its replies`}
      title={collapsed ? "Show" : "Hide"}
      className="relative z-[1] inline-flex h-5 w-5 items-center justify-center rounded-full bg-zk-surface text-zk-muted hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong print:hidden"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="10" cy="10" r="8" />
        <path d="M6 10h8" />
        {collapsed ? <path d="M10 6v8" /> : null}
      </svg>
    </button>
  );
  /** The thread line down the left, under the avatar; clicking it hides the comment too. */
  const rail = (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={() => setCollapsed(true)}
      className="group/rail flex h-full w-full justify-center print:hidden"
    >
      <span className="w-px bg-zk-divider group-hover/rail:w-0.5 group-hover/rail:bg-zk-accent" />
    </button>
  );

  return (
    <li
      id={`comment-${comment.id}`}
      // :target is the comment a permalink points at (#279); the highlight
      // needs no script, so it works on first load and on hash changes.
      // break-inside keeps a comment whole across printed pages (#300).
      // No box around a comment: avatar and name, the body under the name, a
      // line of actions, then the replies along the thread line, which hides
      // the comment and its replies when clicked (or with the minus button).
      className="group/comment grid scroll-mt-24 grid-cols-[32px_minmax(0,1fr)] gap-x-2.5 break-inside-avoid"
    >
      <div className="flex justify-center pt-0.5">
        {collapsed ? toggle : <Avatar name={comment.author.name} image={comment.author.image} size="md" />}
      </div>
      <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md text-[13px] text-zk-muted group-target/comment:bg-zk-tint">
        {isDeleted ? (
          <span className="italic">This comment was deleted.</span>
        ) : (
          <>
            <UserNameWithBadges
              name={comment.author.name}
              role={comment.author.role}
              organisationRole={organisationRoles[comment.authorId]}
              userId={comment.authorId}
              showAuthor={comment.authorId === reporterId}
              agentName={comment.agent?.name}
              className="font-bold text-zk-text"
            />
            <CommentLabel label={comment.label} />
            {comment.agentId && markedImportantBy.includes(comment.authorId) ? (
              <span
                className="rounded-full bg-zk-ok-bg px-2 py-0.5 text-[11px] font-semibold text-zk-ok-fg"
                title={`${comment.author.name} marked this issue important`}
                data-testid="comment-author-marked-important"
              >
                Marked important
              </span>
            ) : null}
            <span aria-hidden="true">•</span>
            <LocalTime date={comment.createdAt} />
            {comment.editedAt ? <span title="This comment was edited">· edited</span> : null}
          </>
        )}
        {collapsed && hiddenReplies > 0 ? (
          <span className="text-xs">({hiddenReplies} {hiddenReplies === 1 ? "reply" : "replies"} hidden)</span>
        ) : null}
      </div>

      {collapsed ? null : (
        <>
          {/* The thread line and the minus only where there are replies to hide. */}
          <div aria-hidden="true">{comment.children.length > 0 ? rail : null}</div>
          <div className="min-w-0 pb-1">
            {!isDeleted ? (
              <>
                {comment.parent ? (
                  <p className="mt-1 text-xs text-zk-muted break-words">
                    Replying to <span className="font-bold text-zk-text">{comment.parent.author.name}</span>
                    {": "}
                    <span className="italic text-zk-text2">
                      {comment.parent.deletedAt ? "deleted comment" : truncateCommentBody(comment.parent.body)}
                    </span>
                  </p>
                ) : null}
                {/* #730: an agent's comment leads with its point, then the full body. */}
                {comment.summary ? (
                  <p className="mt-1 text-sm font-semibold leading-snug text-zk-text" data-testid="comment-summary">{comment.summary}</p>
                ) : null}
                <div className="mt-1">
                  <CommentBody body={comment.body} users={users} />
                </div>
                {comment.reason ? <p className="mt-1 text-xs text-zk-muted"><b>Reason:</b> {comment.reason}</p> : null}
                <AttachmentList attachments={attachmentsByComment[comment.id] ?? []} />
              </>
            ) : null}
            {error ? (
              <p className="mt-1 text-xs text-zk-bad-fg" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-start justify-center pt-1.5">{comment.children.length > 0 ? toggle : null}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 pt-1 text-xs font-semibold text-zk-muted">
            {!isDeleted ? (
              <>
                <CommentUpvote
                  commentId={comment.id}
                  voters={(comment.votes ?? []).map((vote) => vote.onBehalfOfUserId)}
                  currentUserId={currentUserId}
                  canVote={Boolean(replyBugId) && !readOnly && Boolean(currentUserId)}
                  own={comment.authorId === currentUserId}
                />
                {replyBugId && !readOnly && !comment.parentId ? (
                  <EntryReplyForm bugId={replyBugId} target={{ parentId: comment.id }} label="Reply to this comment" variant="action" />
                ) : null}
                {/* The pencil is only on your own comments. */}
                {canDelete && comment.authorId === currentUserId ? <CommentActionsMenu deleting={pending} onDelete={handleDelete} /> : null}
              </>
            ) : null}
          </div>

          {comment.children.length > 0 ? (
            <>
              <div aria-hidden="true">{rail}</div>
              <ul className="min-w-0 space-y-1">
                {comment.children.map((child) => (
                  <CommentItem
                    key={child.id}
                    comment={child}
                    reporterId={reporterId}
                    users={users}
                    currentUserId={currentUserId}
                    currentUserRole={currentUserRole}
                    organisationAdmin={organisationAdmin}
                    attachmentsByComment={attachmentsByComment}
                    organisationRoles={organisationRoles}
                    readOnly={readOnly}
                    replyBugId={replyBugId}
                    markedImportantBy={markedImportantBy}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </li>
  );
}

/** Every reply under a comment, at any depth: what hiding it hides. */
function countReplies(comment: CommentNode): number {
  return comment.children.reduce((total, child) => total + 1 + countReplies(child), 0);
}

type ThreadProps = {
  reporterId: string;
  comments: CommentNode[];
  /** For rendering @mentions in comment bodies. */
  users: UserOption[];
  /** Files attached to each comment, by comment id (#215). */
  attachmentsByComment?: AttachmentsByComment;
  organisationRoles?: OrganisationRoles;
} & ViewerProps;

/**
 * The comments on the issue itself, with their replies. While the issue is
 * Open (`replyBugId` set) anyone may reply to a top-level comment; an author
 * (or an admin) may delete their own.
 */
export function CommentThread({ comments, ...props }: ThreadProps) {
  if (comments.length === 0) return null;
  return (
    <ul className="space-y-2">
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} {...props} />
      ))}
    </ul>
  );
}

/**
 * The issue's Comments section: the comment box (any stage, unless deleted)
 * (`composer`), then the comments, newest threads first as loaded.
 */
export function IssueComments({
  count,
  composer,
  agentActivity,
  agentActivityCount = 0,
  children,
  ...props
}: ThreadProps & {
  /** The agents' steps on the issue (award, bids, deliveries), at the top of the Agents tab. */
  agentActivity?: ReactNode;
  /** How many entries those steps hold; the Agents tab counts them with the agents' comments. */
  agentActivityCount?: number;
  /** Top-level comments. */
  count: number;
  /** The comment box, shown only while the issue takes comments. */
  composer?: ReactNode;
  /** Shown under the comments, e.g. "Show earlier". */
  children?: ReactNode;
}) {
  // Two tabs (#comment-tabs): People, the default and first, and Agents. A thread goes where its first comment's author
  // is; its replies stay with it. A link to an agent's comment opens the Agents tab.
  const people = props.comments.filter((comment) => !comment.agentId);
  const agents = props.comments.filter((comment) => comment.agentId);
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const linkedToAgents = hash === "#conversation" || (hash.startsWith("#comment-") && containsComment(agents, hash.slice("#comment-".length)));
  const [chosen, setChosen] = useState<"people" | "agents" | null>(null);
  const tab = chosen ?? (linkedToAgents ? "agents" : "people");
  if (count === 0 && !composer && !agentActivity) return null;
  const tabClass = (current: boolean) =>
    `inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] transition ${current ? "bg-zk-surface font-semibold text-zk-text shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "font-medium text-zk-muted hover:text-zk-text"}`;
  return (
    <section aria-labelledby="comments-heading" className="mt-5 first:mt-0" data-testid="issue-comments">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="comments-heading" className="m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
          Comments
          <span className="font-mono font-normal normal-case tracking-normal">{count}</span>
        </h3>
        <div role="tablist" aria-label="Whose comments" className="flex gap-0.5 rounded-full bg-zk-bg p-0.5">
          <button type="button" role="tab" aria-selected={tab === "people"} onClick={() => setChosen("people")} className={tabClass(tab === "people")}>
            People <span className="tabular-nums text-zk-muted">{people.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "agents"} onClick={() => setChosen("agents")} className={tabClass(tab === "agents")}>
            Agents <span className="tabular-nums text-zk-muted">{agents.length + agentActivityCount}</span>
          </button>
        </div>
      </div>
      {tab === "people" ? (
        <div role="tabpanel" aria-label="People's comments">
          {composer}
          <CommentThread {...props} comments={people} />
          {people.length === 0 && !composer ? <p className="m-0 text-sm text-zk-muted">No comments from people yet.</p> : null}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Agents' comments">
          {agentActivity}
          <CommentThread {...props} comments={agents} />
          {agents.length === 0 && !agentActivity ? <p className="m-0 text-sm text-zk-muted">No comments from agents yet.</p> : null}
        </div>
      )}
      {children}
    </section>
  );
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Whether a comment, or a reply under it, has this id. */
function containsComment(comments: CommentNode[], id: string): boolean {
  return comments.some((comment) => comment.id === id || containsComment(comment.children, id));
}

