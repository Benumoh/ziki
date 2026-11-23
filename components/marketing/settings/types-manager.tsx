"use client";
import type { ProjectRef } from "@/lib/project-paths";

import { useState, useTransition } from "react";

import {
  createMarketingIssueTypeAction,
  deleteMarketingIssueTypeAction,
  toggleMarketingIssueTypeActiveAction,
  updateMarketingIssueTypeAction,
} from "@/app/(app)/[org]/marketing/settings/actions";
import { getIssueTypeBadgeClass } from "@/lib/issue-type-styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

import type { MarketingTaskType } from "./model";

/**
 * The marketing task types manager (M-UI-7 for M-API-7): add, rename, retire
 * and delete the kinds of marketing task people propose. Types carry no points
 * (D5): every task pays its own reward, so this list doesn't show any.
 */
export function TypesManager({ slug, types }: { slug: ProjectRef; types: MarketingTaskType[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [inUse, setInUse] = useState<MarketingTaskType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();

  function startCreate() {
    setEditingId(null);
    setError(null);
    setIsCreating(true);
  }

  function startEdit(type: MarketingTaskType) {
    setIsCreating(false);
    setError(null);
    setEditingId(type.id);
  }

  function cancel() {
    setIsCreating(false);
    setEditingId(null);
    setError(null);
  }

  function save(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);
    const formData = new FormData(formEvent.currentTarget);
    const id = editingId;

    startTransition(async () => {
      try {
        const result = id
          ? await updateMarketingIssueTypeAction(slug, id, formData)
          : await createMarketingIssueTypeAction(slug, formData);
        if (result.error) {
          setError(result.error);
        } else {
          cancel();
        }
      } catch {
        setError("An unexpected error occurred. Please try again.");
      }
    });
  }

  function toggle(type: MarketingTaskType) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await toggleMarketingIssueTypeActiveAction(slug, type.id);
        if (result.error) setError(result.error);
      } catch {
        setError("Failed to update status.");
      }
    });
  }

  function remove(type: MarketingTaskType) {
    if (type.usage > 0) {
      setError(null);
      setInUse(type);
      return;
    }

    setInUse(null);
    // Ask before the transition starts: its state updates wait for it to finish, so a dialog opened inside it never shows.
    void confirm({
      title: `Delete task type "${type.name}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete type",
      tone: "danger",
    }).then((agreed) => {
      if (!agreed) return;
      startTransition(async () => {
        try {
          const result = await deleteMarketingIssueTypeAction(slug, type.id);
          if (result.error) {
            setError(result.error);
            toast(result.error, "error");
          } else {
            toast(`Task type "${type.name}" deleted.`);
          }
        } catch {
          setError("Failed to delete the task type.");
          toast("Failed to delete the task type.", "error");
        }
      });
    });
  }

  const editing = types.find((type) => type.id === editingId) ?? null;
  const formOpen = isCreating || editing !== null;

  return (
    <section aria-labelledby="marketing-types" className="rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="marketing-types" className="m-0 text-base font-bold text-zk-text">
            Task types
          </h2>
          <p className="m-0 mt-1 max-w-2xl text-sm text-zk-text2">
            The kinds of marketing task people propose. They show only in the Marketing section. Types carry no
            points: every task pays its own reward.
          </p>
        </div>
        {!formOpen ? <Button onClick={startCreate}>Add task type</Button> : null}
      </div>

      {inUse ? (
        <div
          id="marketing-type-in-use"
          role="alert"
          className="mt-4 rounded-xl border border-zk-warn-bd bg-zk-warn-bg px-4 py-3 text-sm text-zk-warn-fg"
        >
          <p className="m-0">
            “{inUse.name}” is labelled on {inUse.usage} marketing task{inUse.usage === 1 ? "" : "s"}, so it can&apos;t
            be deleted. Retire it instead: past tasks keep showing it, and nobody can propose with it again.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {inUse.isActive ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      const result = await toggleMarketingIssueTypeActiveAction(slug, inUse.id);
                      if (result.error) {
                        toast(result.error, "error");
                      } else {
                        setInUse(null);
                      }
                    } catch {
                      toast("Failed to update status.", "error");
                    }
                  })
                }
              >
                Retire instead
              </Button>
            ) : null}
            <button
              type="button"
              className="rounded px-1 text-xs font-medium underline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
              onClick={() => setInUse(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-4 rounded-xl border border-zk-bad-bd bg-zk-bad-bg px-4 py-3 text-sm text-zk-bad-fg">
          {error}
        </div>
      ) : null}

      {formOpen ? (
        <form onSubmit={save} className="mt-4 rounded-panel border border-zk-divider p-4" aria-label={editing ? `Edit ${editing.name}` : "New task type"}>
          <h3 className="m-0 text-sm font-bold text-zk-text">{editing ? `Edit “${editing.name}”` : "New task type"}</h3>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="marketing-type-name" className="text-sm font-medium text-zk-text">
                Name
              </label>
              <Input
                id="marketing-type-name"
                name="name"
                required
                minLength={2}
                maxLength={50}
                defaultValue={editing?.name ?? ""}
                autoComplete="off"
                placeholder="e.g. Email newsletter"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="marketing-type-description" className="text-sm font-medium text-zk-text">
                Description (optional)
              </label>
              <Textarea
                id="marketing-type-description"
                name="description"
                rows={2}
                maxLength={300}
                defaultValue={editing?.description ?? ""}
                placeholder="When to pick this type"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="marketing-type-active"
                name="isActive"
                defaultChecked={editing?.isActive ?? true}
                className="h-4 w-4 rounded border-zk-border"
              />
              <label htmlFor="marketing-type-active" className="text-sm text-zk-text">
                Active — offered when a task is proposed
              </label>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save type" : "Create type"}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-zk-muted">
              <th scope="col" className="px-2 py-2.5 font-semibold">
                Type
              </th>
              <th scope="col" className="px-2 py-2.5 font-semibold">
                Description
              </th>
              <th scope="col" className="px-2 py-2.5 font-semibold">
                Status
              </th>
              <th scope="col" className="px-2 py-2.5 font-semibold">
                Tasks
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.id} className="border-t border-zk-divider">
                <td className="px-2 py-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getIssueTypeBadgeClass(type.name)}`}
                  >
                    {type.name}
                  </span>
                </td>
                <td className="px-2 py-3 text-zk-text2">
                  {type.description || <span className="text-zk-muted">—</span>}
                </td>
                <td className="px-2 py-3">
                  <Badge className={type.isActive ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-chip text-zk-muted"}>
                    {type.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-2 py-3 tabular-nums text-zk-text2">
                  {type.usage}
                </td>
                <td className="px-2 py-3 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-medium">
                    <button type="button" disabled={pending} onClick={() => startEdit(type)} className="text-zk-text2 hover:text-zk-text hover:underline">
                      Edit
                    </button>
                    <span aria-hidden="true">·</span>
                    <button type="button" disabled={pending} onClick={() => toggle(type)} className="text-zk-accent hover:underline">
                      {type.isActive ? "Retire" : "Activate"}
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(type)}
                      className={type.usage > 0 ? "text-zk-text2 hover:text-zk-text hover:underline" : "text-zk-bad-fg hover:underline"}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {types.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-zk-muted">No marketing task types yet.</p>
        ) : null}
      </div>
    </section>
  );
}
