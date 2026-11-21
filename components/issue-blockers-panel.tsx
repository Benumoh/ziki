"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { addIssueBlockerAction, removeIssueBlockerAction, type IssueBlockerCandidate } from "@/app/actions/issue-blockers";
import { blockerGuidance } from "@/lib/issue-blockers";
import { issuePath } from "@/lib/issue-ref";
import { formatIssueNumber } from "@/lib/issue-number";
import { stateLabel } from "@/lib/labels";
import type { ProjectRef } from "@/lib/project-paths";
import { useProjectRef } from "@/lib/use-project-ref";

type Props = {
  projectSlug?: ProjectRef | null;
  issueId: string;
  blockedBy: IssueBlockerCandidate[];
  blocking: IssueBlockerCandidate[];
  canEdit: boolean;
};

function IssueLink({ issue, projectSlug }: { issue: IssueBlockerCandidate; projectSlug: ProjectRef | null }) {
  return (
    <Link
      href={projectSlug ? issuePath(projectSlug, issue.number) : `#${issue.number}`}
      className="font-semibold text-zk-accent hover:underline"
    >
      {formatIssueNumber(issue.number)} · {issue.title}
    </Link>
  );
}

export function IssueBlockersPanel({ projectSlug: propProjectSlug, issueId, blockedBy, blocking, canEdit }: Props) {
  const currentProjectRef = useProjectRef();
  const projectSlug = propProjectSlug ?? currentProjectRef;
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addIssueBlockerAction(issueId, reference);
      if (result.error) {
        setError(result.error);
        return;
      }
      setReference("");
      router.refresh();
    });
  };

  const remove = (blockerId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await removeIssueBlockerAction(issueId, blockerId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section aria-label="Issue blockers" data-testid="issue-blockers-panel" className="rounded-panel border border-zk-border bg-zk-surface px-4 py-3.5">
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">Blockers</h2>

      <div className="mt-3">
        <h3 className="m-0 text-sm font-semibold text-zk-text">Blocked by</h3>
        {blockedBy.length ? (
          <ul className="mt-2 space-y-3 pl-5 text-sm text-zk-text2">
            {blockedBy.map((issue) => {
              const guidance = blockerGuidance(issue);
              return (
                <li key={issue.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <IssueLink issue={issue} projectSlug={projectSlug} />
                    <span className="rounded-full bg-zk-chip px-2 py-0.5 text-xs text-zk-muted">{stateLabel(issue.substatus)}</span>
                    {canEdit ? <button type="button" disabled={pending} onClick={() => remove(issue.id)} className="text-xs text-zk-muted underline hover:text-zk-text">Remove blocker</button> : null}
                  </div>
                  <p className="m-0 text-sm"><b className="font-semibold text-zk-text">What this means:</b> {guidance.meaning}</p>
                  <p className="m-0 text-sm"><b className="font-semibold text-zk-text">Next step:</b> {guidance.nextStep}</p>
                </li>
              );
            })}
          </ul>
        ) : <p className="m-0 mt-1 text-sm text-zk-muted">No known blocker. This issue can follow its next step.</p>}
      </div>

      {blocking.length ? (
        <div className="mt-4 border-t border-zk-border pt-3">
          <h3 className="m-0 text-sm font-semibold text-zk-text">Blocking</h3>
          <ul className="mt-1 space-y-1 pl-5 text-sm text-zk-text2">
            {blocking.map((issue) => <li key={issue.id}><IssueLink issue={issue} projectSlug={projectSlug} /> <span className="text-zk-muted">· {stateLabel(issue.substatus)}</span></li>)}
          </ul>
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zk-border pt-3">
          <label className="flex-1 text-xs font-medium text-zk-muted">
            Add a blocker by issue number
            <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="#123" maxLength={200} className="mt-1 block w-full rounded-lg border border-zk-border bg-zk-bg px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted focus:outline-none focus:ring-2 focus:ring-zk-accent" />
          </label>
          <button type="submit" disabled={pending || !reference.trim()} className="rounded-lg border border-zk-border px-3 py-2 text-sm font-semibold text-zk-text disabled:opacity-50">{pending ? "Saving…" : "Add blocker"}</button>
        </form>
      ) : null}
      {error ? <p role="alert" className="m-0 mt-2 text-sm text-zk-bad-fg">{error}</p> : null}
    </section>
  );
}
