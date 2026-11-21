"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useProjectRef } from "@/lib/use-project-ref";
import {
  createMilestoneAction,
  deleteMilestoneAction,
  setMilestoneClosedAction,
  updateMilestoneAction,
} from "@/app/actions/milestones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { MilestoneProgressBar } from "@/components/milestone-progress";
import { MilestoneDue } from "@/components/milestone-due";
import { milestoneIssuesHref, type MilestoneProgress } from "@/lib/milestones";

export type ManagedMilestone = {
  id: string;
  title: string;
  description: string | null;
  /** "YYYY-MM-DD" or null. */
  dueDate: string | null;
  isClosed: boolean;
  progress: MilestoneProgress;
};

type Draft = { title: string; description: string; dueDate: string };
const EMPTY: Draft = { title: "", description: "", dueDate: "" };

export function MilestoneManager({ milestones }: { milestones: ManagedMilestone[] }) {
  const slug = useProjectRef()!;
  const [editing, setEditing] = useState<ManagedMilestone | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();

  const open = (m: ManagedMilestone | "new") => {
    setError(null);
    setEditing(m);
    setDraft(m === "new" ? EMPTY : { title: m.title, description: m.description ?? "", dueDate: m.dueDate ?? "" });
  };
  const close = () => {
    setEditing(null);
    setError(null);
  };

   /**
   * Handles milestone form submission.
   * Ignores clicks while a save action is pending to prevent duplicates.
   */
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    // ...
    const fd = new FormData();
    fd.set("title", draft.title);
    fd.set("description", draft.description);
    fd.set("dueDate", draft.dueDate);
    startTransition(async () => {
      const result =
        editing === "new" ? await createMilestoneAction(fd) : await updateMilestoneAction((editing as ManagedMilestone).id, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editing === "new" ? `Milestone "${draft.title.trim()}" created.` : "Milestone saved.");
      close();
    });
  };

  const toggleClosed = (m: ManagedMilestone) =>
    startTransition(async () => {
      const result = await setMilestoneClosedAction(m.id, !m.isClosed);
      if (result.error) toast(result.error, "error");
      else toast(m.isClosed ? `"${m.title}" reopened.` : `"${m.title}" closed. Its issues are unchanged.`);
    });

  const remove = async (m: ManagedMilestone) => {
    const n = m.progress.total;
    const ok = await confirm({
      title: `Delete "${m.title}"?`,
      body:
        n > 0
          ? `${n} issue${n === 1 ? "" : "s"} will be taken out of this milestone. No issues are deleted.`
          : "No issues are in it.",
      confirmLabel: "Delete milestone",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteMilestoneAction(m.id);
      if (result.error) toast(result.error, "error");
      else toast(`"${m.title}" deleted.`);
    });
  };

  return (
    <div className="space-y-4">
      {editing ? (
        <form onSubmit={save} className="space-y-4 rounded-panel border border-zk-border bg-zk-surface p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-medium text-zk-text">
            {editing === "new" ? "New milestone" : `Edit "${editing.title}"`}
          </h2>
          {error ? (
            <p role="alert" className="rounded-xl border border-zk-bad-bd bg-zk-bad-bg p-3 text-sm text-zk-bad-fg">
              {error}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-1.5">
              <label htmlFor="milestoneTitle" className="text-sm font-medium text-zk-text2">
                Title
              </label>
              <Input
                id="milestoneTitle"
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. v2.4 release"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="milestoneDue" className="text-sm font-medium text-zk-text2">
                Due date (optional)
              </label>
              <Input
                id="milestoneDue"
                type="date"
                value={draft.dueDate}
                onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="milestoneDescription" className="text-sm font-medium text-zk-text2">
              Description (optional)
            </label>
            <Textarea
              id="milestoneDescription"
              rows={2}
              maxLength={500}
              placeholder="What this release or sprint is for"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing === "new" ? "Create milestone" : "Save milestone"}
            </Button>
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" onClick={() => open("new")}>
          New milestone
        </Button>
      )}

      {milestones.length === 0 ? (
        <p className="rounded-panel border border-dashed border-zk-border bg-zk-surface px-6 py-10 text-center text-sm text-zk-text2">
          No milestones yet. Create one, then put issues in it from each issue&apos;s triage panel.
        </p>
      ) : (
        <ul className="divide-y divide-zk-border overflow-hidden rounded-panel border border-zk-border bg-zk-surface">
          {milestones.map((m) => (
            <li key={m.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_14rem_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={milestoneIssuesHref(slug, m.id)} className="font-medium text-zk-text hover:underline">
                    {m.title}
                  </Link>
                  <MilestoneDue due={m.dueDate} isClosed={m.isClosed} />
                </div>
                {m.description ? <p className="mt-1 text-sm text-zk-text2">{m.description}</p> : null}
              </div>
              <MilestoneProgressBar progress={m.progress} label={m.title} />
              <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => open(m)} disabled={pending}>
                  Edit
                </Button>
                <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => toggleClosed(m)} disabled={pending}>
                  {m.isClosed ? "Reopen" : "Close"}
                </Button>
                <Button
                  variant="ghost"
                  className="px-2.5 py-1 text-xs text-zk-bad-fg hover:bg-zk-bad-bg"
                  onClick={() => void remove(m)}
                  disabled={pending}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}