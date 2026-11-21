"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { addTimeEntryAction, deleteTimeEntryAction } from "@/app/actions/time-tracking";
import { formatDuration, MAX_TIME_ENTRY_MINUTES, parseMinutesInput } from "@/lib/time-tracking";

export type TimeEntryView = {
  id: string;
  minutes: number;
  note: string | null;
  spentOnLabel: string;
  userId: string;
  userName: string;
};

type Props = {
  bugId: string;
  canEdit: boolean;
  isAdmin: boolean;
  viewerId: string;
  entries: TimeEntryView[];
};

export function TimeTrackingPanel({ bugId, canEdit, isAdmin, viewerId, entries }: Props) {
  const router = useRouter();
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = parseMinutesInput(minutes);
    if (parsed === null) {
      setError(`Enter whole minutes between 1 and ${MAX_TIME_ENTRY_MINUTES}.`);
      return;
    }
    startTransition(async () => {
      const result = await addTimeEntryAction(bugId, parsed, note);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMinutes("");
      setNote("");
      router.refresh();
    });
  };

  const remove = (entryId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await deleteTimeEntryAction(entryId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section aria-label="Time tracking" data-testid="time-tracking-panel" className="rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Time tracking</h2>
        <span className="rounded-full bg-zk-chip px-2.5 py-0.5 text-sm font-semibold tabular-nums text-zk-text" aria-label={`Total time logged: ${formatDuration(total)}`}>
          {formatDuration(total)} logged
        </span>
      </div>

      {entries.length ? (
        <ul className="mt-3 space-y-2 text-sm text-zk-text2">
          {entries.map((entry) => {
            const canRemove = canEdit && (isAdmin || entry.userId === viewerId);
            return (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-zk-border/60 pb-2 last:border-b-0 last:pb-0">
                <span className="font-semibold tabular-nums text-zk-text">{formatDuration(entry.minutes)}</span>
                <span className="text-zk-muted">{entry.userName}</span>
                <span className="text-zk-muted">· {entry.spentOnLabel}</span>
                {entry.note ? <span className="w-full text-zk-text2">{entry.note}</span> : null}
                {canRemove ? (
                  <button type="button" disabled={pending} onClick={() => remove(entry.id)} className="text-xs text-zk-muted underline hover:text-zk-text disabled:opacity-50">
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 mt-2 text-sm text-zk-muted">No time logged yet.</p>
      )}

      {canEdit ? (
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zk-border pt-3">
          <label className="text-xs font-medium text-zk-muted">
            Minutes
            <input
              type="number"
              min={1}
              max={MAX_TIME_ENTRY_MINUTES}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              placeholder="60"
              className="mt-1 block w-24 rounded-lg border border-zk-border bg-zk-bg px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted focus:outline-none focus:ring-2 focus:ring-zk-accent"
            />
          </label>
          <label className="min-w-[12rem] flex-1 text-xs font-medium text-zk-muted">
            What did you work on?
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Optional note"
              className="mt-1 block w-full rounded-lg border border-zk-border bg-zk-bg px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted focus:outline-none focus:ring-2 focus:ring-zk-accent"
            />
          </label>
          <button type="submit" disabled={pending || !minutes.trim()} className="rounded-lg border border-zk-border px-3 py-2 text-sm font-semibold text-zk-text disabled:opacity-50">
            {pending ? "Saving…" : "Log time"}
          </button>
        </form>
      ) : null}

      {error ? <p role="alert" className="m-0 mt-2 text-sm text-zk-bad-fg">{error}</p> : null}
    </section>
  );
}
