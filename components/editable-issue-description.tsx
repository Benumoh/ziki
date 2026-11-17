"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { editBugContentAction } from "@/app/actions/issues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/markdown-editor";
import { RichText } from "@/components/rich-text";
import { MentionText } from "@/components/comment-body";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { ExpandableText } from "@/components/expandable-text";

export type EditableIssueDescriptionProps = {
  bugId: string;
  initialTitle: string;
  initialDescription: string;
  /** The report's short summary (#report-summary): shown first, the full description opens under it. */
  summary?: string | null;
  canEdit: boolean;
  users: { id: string; name: string }[];
  children?: ReactNode;
  /** Small tags (the issue's area) shown at the right of the summary. */
  tags?: ReactNode;
  /** When the title or description was last edited (#303); null if never. */
  lastEditedAt?: Date | null;
  /** When the issue was created; kept beside the description heading (#422). */
  createdAt?: Date | null;
  historyHref?: string;
};

export function EditableIssueDescription({
  bugId,
  initialTitle,
  initialDescription,
  summary = null,
  canEdit,
  users,
  children,
  tags = null,
  lastEditedAt = null,
  createdAt = null,
  historyHref,
}: EditableIssueDescriptionProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [editorUploading, setEditorUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleStartEdit = () => {
    setTitle(initialTitle);
    setDescription(initialDescription);
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setTitle(initialTitle);
    setDescription(initialDescription);
    setError(null);
    setIsEditing(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || editorUploading) return;
    setError(null);

    const formData = new FormData();
    formData.set("title", title);
    formData.set("description", description);

    startTransition(async () => {
      const result = await editBugContentAction(bugId, formData);
      if (result.error) {
        setError(result.error);
      } else {
        setIsEditing(false);
        router.refresh();
      }
    });
  };

  const mentionUsers = users.map((u) => ({ id: u.id, name: u.name }));

  return (
    <section className="flex flex-col gap-1.5 rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6" aria-label="Description">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
              {isEditing ? "Edit issue" : summary ? "Summary" : "Description"}
            </h2>
            {!isEditing && lastEditedAt && historyHref ? (
              <p className="text-xs text-zk-muted">
                edited <LocalTime date={lastEditedAt} /> ·{" "}
                <Link href={historyHref} className="font-bold text-zk-accent hover:underline">
                  view history
                </Link>
              </p>
            ) : null}
          </div>
          {!isEditing && createdAt ? (
            <p className="ml-auto text-xs text-zk-muted">
              <span>Created </span><LocalTime date={createdAt} absolute className="tabular-nums" />
            </p>
          ) : null}
        </div>
        {/* Created stays on the heading row; its compact date moves below it on narrow screens. */}
        {canEdit && !isEditing ? (
          <button
            type="button"
            aria-label="Edit description"
            title="Edit description"
            onClick={handleStartEdit}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.7l-3 .8.8-3z" />
            </svg>
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          {error ? (
            <div
              className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg p-3 text-sm text-zk-bad-fg"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label
              htmlFor="edit-issue-title"
              className="text-xs font-medium text-zk-text2"
            >
              Title
            </label>
            <Input
              id="edit-issue-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
              maxLength={200}
              placeholder="Short summary of the issue"
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <label
              id="edit-issue-description-label"
              htmlFor="edit-issue-description"
              className="text-xs font-medium text-zk-text2"
            >
              Description
            </label>
            <MarkdownEditor
              id="edit-issue-description"
              labelId="edit-issue-description-label"
              name="description"
              value={description}
              onChange={setDescription}
              onUploadingChange={setEditorUploading}
              users={mentionUsers}
              minLength={10}
              maxLength={5000}
              rows={6}
              disabled={pending}
              placeholder="Steps to reproduce, expected vs actual, environment…"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button
              type="submit"
              disabled={
                pending ||
                editorUploading ||
                title.trim().length < 3 ||
                description.trim().length < 10
              }
            >
              {pending ? "Saving…" : editorUploading ? "Uploading…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : summary ? (
        // One card: the summary, and the full description opened beneath it.
        <div>
          <div className="flex items-start justify-between gap-3">
            <RichText className="mt-0! max-w-3xl text-[15px] font-medium leading-relaxed text-zk-text" content={summary} />
            {tags ? <div className="flex shrink-0 flex-wrap justify-end gap-1.5 pt-0.5">{tags}</div> : null}
          </div>
          <button
            type="button"
            aria-expanded={showFull}
            aria-controls={`${bugId}-full-description`}
            onClick={() => setShowFull((open) => !open)}
            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-zk-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
          >
            {showFull ? "Hide full description" : "Show full description"}
            <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform ${showFull ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
          {showFull ? (
            <div id={`${bugId}-full-description`} className="mt-3 border-t border-zk-divider pt-3 text-[15px] leading-relaxed text-zk-text2">
              {/* Section headings at the text's own size, so the description doesn't read larger than the summary. */}
              <RichText
                className="mt-0! [&_h1]:!text-[15px] [&_h2]:!text-[15px] [&_h3]:!text-[15px] [&_h1]:!font-bold [&_h2]:!font-bold [&_h3]:!font-bold"
                content={initialDescription}
                renderMentions={(text) => <MentionText text={text} users={users} />}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
        <div className="max-w-3xl text-[15px] leading-relaxed text-zk-text2">
          <ExpandableText maxLines={6} expandText="View more" collapseText="View less">
            <RichText
              className="mt-0!"
              content={initialDescription}
              renderMentions={(text) => <MentionText text={text} users={users} />}
            />
          </ExpandableText>
        </div>
          {tags ? <div className="flex shrink-0 flex-wrap justify-end gap-1.5 pt-0.5">{tags}</div> : null}
        </div>
      )}

      {children}
    </section>
  );
}
