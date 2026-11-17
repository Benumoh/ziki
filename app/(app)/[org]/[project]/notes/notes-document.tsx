"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MarkdownEditor } from "@/components/markdown-editor";
import { RichText } from "@/components/rich-text";
import { saveNotesAction, restoreNotesAction } from "./actions";

export type NotesDocumentData = { body: string; version: number; editorName: string; editorAgentId: string | null; updatedAt: string };
export type NoteRevisionData = { id: string; body: string; version: number; editorName: string; editorAgentId: string | null; reason: string; createdAt: string };
const buttonBaseClass = "inline-flex min-h-10 items-center justify-center rounded-lg border border-zk-border px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent disabled:opacity-50";
const buttonClass = `${buttonBaseClass} hover:bg-zk-chip`;

export function NotesDocument({ projectId, notes, canEdit, revisions, historyLink }: {
  projectId: string; notes: NotesDocumentData | null; canEdit: boolean;
  revisions: NoteRevisionData[]; historyLink?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(notes?.body ?? "");
  const [expectedVersion, setExpectedVersion] = useState(notes?.version ?? 0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const beginEdit = () => {
    setBody(notes?.body ?? ""); setExpectedVersion(notes?.version ?? 0); setReason("");
    setError(null); setMessage(null); setEditing(true);
  };
  const save = () => startTransition(async () => {
    setError(null); setMessage(null);
    try {
      const result = await saveNotesAction(projectId, { body, expectedVersion, reason });
      if (result.error) { setError(result.error); return; }
      setEditing(false); setMessage("Project notes saved."); router.refresh();
    } catch { setError("Could not save notes. Your draft is still here; try again."); }
  });
  const restore = (revision: NoteRevisionData) => startTransition(async () => {
    setError(null); setMessage(null);
    try {
      const result = await restoreNotesAction(projectId, revision.id, {
        expectedVersion: notes?.version ?? 0, reason: `Restore version ${revision.version}`,
      });
      if (result.error) { setError(result.error); return; }
      setMessage(`Version ${revision.version} restored as a new revision.`); router.refresh();
    } catch { setError("Could not restore this revision. Try again."); }
  });

  return (
    <section aria-labelledby="official-notes-heading" className="rounded-[20px] border border-zk-border bg-zk-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zk-border px-5 py-4 sm:px-7">
        <div>
          <h2 id="official-notes-heading" className="text-base font-bold text-zk-text">Project notes</h2>
          <p className="mt-1 text-sm text-zk-text2">Official guidance for everyone working on this project.</p>
        </div>
        {canEdit && !editing ? <button type="button" className={buttonClass} onClick={beginEdit} disabled={pending}>{notes ? "Edit notes" : "Create notes"}</button> : null}
      </div>
      <div className="px-5 py-6 sm:px-7">
        {error ? <p role="alert" className="mb-4 rounded-lg border border-zk-bad-bd bg-zk-bad-soft p-3 text-sm text-zk-bad-fg">{error}</p> : null}
        {message ? <p role="status" className="mb-4 text-sm text-zk-accent">{message}</p> : null}
        {editing ? (
          <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-4">
            <label htmlFor="project-notes-body" className="block text-sm font-semibold text-zk-text">Official notes</label>
            <MarkdownEditor id="project-notes-body" aria-label="Official notes" value={body} onChange={setBody} rows={14} allowUploads={false} required maxLength={100000} disabled={pending} placeholder="Document how this project works, its conventions and lessons agents should know." />
            <div>
              <label htmlFor="notes-change-summary" className="mb-2 block text-sm font-semibold text-zk-text">Change summary</label>
              <input id="notes-change-summary" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} disabled={pending} className="min-h-11 w-full rounded-lg border border-zk-border bg-zk-bg px-3 text-sm text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent" placeholder="Explain what changed and why" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending || !body.trim() || !reason.trim()} className={`${buttonBaseClass} bg-electric-blue-strong text-white hover:brightness-105`}>{pending ? "Saving…" : "Save notes"}</button>
              <button type="button" disabled={pending} className={buttonClass} onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            </div>
          </form>
        ) : notes ? (
          <>
            <RichText content={notes.body} className="text-zk-text [&_a]:text-zk-accent" />
            <p className="mt-6 border-t border-zk-border pt-4 text-xs text-zk-muted">Version {notes.version} · Updated by {notes.editorName}{notes.editorAgentId ? " (agent)" : ""} · <time dateTime={notes.updatedAt}>{new Date(notes.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</time></p>
          </>
        ) : (
          <div className="py-8 text-center">
            <h3 className="font-semibold text-zk-text">No project notes yet</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm text-zk-text2">{canEdit ? "Add the guidance agents should read before starting work." : "Add what you learn as a comment below; a merger agent promotes the best comments into the official notes."}</p>
          </div>
        )}
      </div>
      {revisions.length > 0 && !editing ? (
        <details className="border-t border-zk-border px-5 py-4 sm:px-7">
          <summary className="cursor-pointer text-sm font-semibold text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent">Revision history</summary>
          <ol className="mt-4 divide-y divide-zk-border">
            {revisions.map((revision) => (
              <li key={revision.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold text-zk-text">Version {revision.version} · {revision.editorName}{revision.editorAgentId ? " (agent)" : ""}</p><p className="mt-1 text-sm text-zk-text2">{revision.reason}</p><time className="mt-1 block text-xs text-zk-muted" dateTime={revision.createdAt}>{new Date(revision.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</time></div>
                  {canEdit && revision.version !== notes?.version ? <button type="button" className={buttonClass} disabled={pending} onClick={() => restore(revision)}>Restore version {revision.version}</button> : null}
                </div>
                <details className="mt-2"><summary className="cursor-pointer text-xs text-zk-accent">Read version {revision.version}</summary><RichText content={revision.body} className="text-zk-text" /></details>
              </li>
            ))}
          </ol>
          {historyLink ? <a href={historyLink} className="text-sm font-semibold text-zk-accent underline">Older revisions</a> : null}
        </details>
      ) : null}
    </section>
  );
}
