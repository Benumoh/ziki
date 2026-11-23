"use client";

import { useId, useState, useTransition } from "react";
import { giveConfirmationAction } from "@/app/actions/confirmations";
import { evidenceFileLines, parseEvidenceFileLines, type EvidenceFile } from "@/lib/agent-api/evidence-files";

export type ConfirmationVerdictName = "confirm" | "reject" | "neutral";

const VERDICTS: { value: ConfirmationVerdictName; label: string }[] = [
  { value: "confirm", label: "Confirm" },
  { value: "neutral", label: "Neutral" },
  { value: "reject", label: "Reject" },
];

/** Sentences end in `.`, `!` or `?` and a space or the end, as the server counts them. */
function sentences(text: string): number {
  return text.trim().split(/(?<=[.!?])\s+/).filter((part) => part.trim()).length;
}

const fieldClass =
  "w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong";

/**
 * A person's confirmation entry on an issue (#issue-confirmations): confirm,
 * neutral or reject, a summary of two sentences at most and a full
 * description. Reject may name the issue this one duplicates. Giving it
 * again replaces the earlier one.
 */
export function ConfirmationForm({
  bugId,
  summaryMaxChars,
  initial = null,
  onSaved,
}: {
  bugId: string;
  summaryMaxChars: number;
  initial?: {
    verdict: ConfirmationVerdictName;
    summary: string;
    description: string;
    duplicateOfNumber: number | null;
    files?: EvidenceFile[];
  } | null;
  /** Called once the entry is saved, so a dialog can close. */
  onSaved?: () => void;
}) {
  const id = useId();
  const [verdict, setVerdict] = useState<ConfirmationVerdictName | null>(initial?.verdict ?? null);
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [duplicateOf, setDuplicateOf] = useState(initial?.duplicateOfNumber ? String(initial.duplicateOfNumber) : "");
  const [files, setFiles] = useState(evidenceFileLines(initial?.files ?? []));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const replacing = initial !== null;
  const left = summaryMaxChars - summary.length;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaved(null);
    if (!verdict) return setError("Pick confirm, reject or neutral.");
    if (!summary.trim()) return setError("Add a summary.");
    if (sentences(summary) > 2) return setError("Keep the summary to two sentences.");
    if (!description.trim()) return setError("Add a description explaining your verdict.");
    const duplicate = duplicateOf.trim().replace(/^#/, "");
    if (verdict === "reject" && duplicate && !/^\d+$/.test(duplicate)) return setError("Give the duplicate as an issue number, like 42.");
    if (verdict === "confirm" && parseEvidenceFileLines(files).length === 0) return setError("List the files where you found it, one per line.");
    const data = new FormData();
    data.set("verdict", verdict);
    data.set("summary", summary);
    data.set("description", description);
    if (verdict === "reject" && duplicate) data.set("duplicateOfId", duplicate);
    data.set("files", files);
    startTransition(async () => {
      const result = await giveConfirmationAction(bugId, data);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(result.replaced ? "Your confirmation was updated." : "Your confirmation was saved.");
      onSaved?.();
    });
  };

  return (
    <form onSubmit={onSubmit} aria-label="Your confirmation" className="flex flex-col gap-3">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-semibold text-zk-text">
          {replacing ? "Change your verdict" : "Your verdict"}
        </legend>
        <div className="flex flex-wrap gap-2">
          {VERDICTS.map((option) => (
            <label
              key={option.value}
              className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-bold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-electric-blue-strong ${
                verdict === option.value
                  ? "border-electric-blue-strong bg-electric-blue-strong text-white"
                  : "border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"
              }`}
            >
              <input
                type="radio"
                name="verdict"
                value={option.value}
                checked={verdict === option.value}
                onChange={() => setVerdict(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="mb-0 mt-1.5 text-xs text-zk-muted">
          Confirm means it is real and not a duplicate. Neutral counts for nothing either way.
        </p>
      </fieldset>

      {verdict === "reject" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-duplicate`} className="text-[13px] font-semibold text-zk-text">
            Duplicate of #
          </label>
          <input
            id={`${id}-duplicate`}
            name="duplicateOfId"
            inputMode="numeric"
            value={duplicateOf}
            onChange={(event) => setDuplicateOf(event.target.value)}
            aria-describedby={`${id}-duplicate-help`}
            className={`${fieldClass} h-9 sm:w-56`}
          />
          <p id={`${id}-duplicate-help`} className="m-0 text-xs text-zk-muted">
            Optional. The number of the issue this one duplicates; leave it empty if it is simply not real.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-files`} className="text-[13px] font-semibold text-zk-text">
          Files{verdict === "confirm" ? "" : " (optional)"}
        </label>
        <textarea
          id={`${id}-files`}
          name="files"
          rows={3}
          value={files}
          onChange={(event) => setFiles(event.target.value)}
          aria-describedby={`${id}-files-help`}
          placeholder="lib/coins/issue-payout.ts:40-58"
          className={`${fieldClass} font-mono text-[13px]`}
        />
        <p id={`${id}-files-help`} className="m-0 text-xs text-zk-muted">
          Where you found it, one file per line, with the lines after a colon. Others see them once they confirm too.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-summary`} className="text-[13px] font-semibold text-zk-text">
          Summary
        </label>
        <textarea
          id={`${id}-summary`}
          name="summary"
          rows={2}
          maxLength={summaryMaxChars}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          aria-describedby={`${id}-summary-help`}
          className={fieldClass}
        />
        <p id={`${id}-summary-help`} className="m-0 text-xs text-zk-muted">
          Two sentences at most. <span className="tabular-nums">{left}</span> {left === 1 ? "character" : "characters"} left.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-description`} className="text-[13px] font-semibold text-zk-text">
          Description
        </label>
        <textarea
          id={`${id}-description`}
          name="description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-describedby={`${id}-description-help`}
          className={fieldClass}
        />
        <p id={`${id}-description-help`} className="m-0 text-xs text-zk-muted">
          What you checked and what you found, in full.
        </p>
      </div>

      {error ? (
        <p role="alert" className="m-0 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="m-0 text-xs font-medium text-zk-ok-fg">
          {saved}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center rounded-full bg-electric-blue-strong px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : replacing ? "Update confirmation" : "Give confirmation"}
        </button>
      </div>
    </form>
  );
}
