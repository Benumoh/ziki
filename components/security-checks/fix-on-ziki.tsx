"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import type { SecuritySeverity } from "@prisma/client";
import { fixSecurityCheck, loadSecurityCheckFixOptions } from "@/app/actions/security-check-fix";
import { SEVERITY_LABEL } from "@/lib/security-severity";
import type { FixOptions, FixOutcome } from "@/lib/security-checks/fix";

type Props = {
  checkId: string;
  results: readonly { id: string; severity: SecuritySeverity; title: string }[];
};

export function FixOnZiki(props: Props) {
  if (!props.results.length) return null;
  return <FixPicker key={props.checkId} {...props} />;
}

function FixPicker({ checkId, results }: Props) {
  const [options, setOptions] = useState<FixOptions | null | undefined>();
  const [projectId, setProjectId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<FixOutcome>();
  const [loadingAttempt, setLoadingAttempt] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    loadSecurityCheckFixOptions(checkId).then((data) => {
      if (!current) return;
      setOptions(data);
      setProjectId(data?.projectId ?? "");
    }, () => { if (current) setOptions(null); });
    return () => { current = false; };
  }, [checkId, loadingAttempt]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !selected.length || pending) return;
    startTransition(async () => {
      try {
        const reply = await fixSecurityCheck({ checkId, projectId, resultIds: selected });
        setOutcome(reply);
        if (reply.ok) {
          setOptions((old) => old && { ...old, projectId });
          setSelected([]);
        }
      } catch {
        setOutcome({ ok: false, error: "Could not send the findings. Try again." });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-zk-border p-4">
      <h2 className="font-semibold text-zk-text">Fix on Ziki</h2>
      {options === undefined ? <p role="status">Loading projects…</p> : options === null ? (
        <p role="status">
          Fix on Ziki is available once the report is posted and at least one finding is unlocked.{" "}
          <button type="button" className="underline" onClick={() => {
            setOptions(undefined);
            setLoadingAttempt((attempt) => attempt + 1);
          }}>Retry</button>
        </p>
      ) : options.projects.length === 0 ? <p>No eligible projects are available in this workspace.</p> : (
        <>
          <fieldset disabled={pending} className="space-y-2">
            <legend className="mb-2 font-medium">Choose findings</legend>
            {results.map((result) => (
              <label key={result.id} className="flex items-start gap-2 break-words">
                <input type="checkbox" className="mt-1 shrink-0" checked={selected.includes(result.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelected((ids) => checked ? [...ids, result.id] : ids.filter((id) => id !== result.id));
                  }} />
                <span className="min-w-0"><strong>{SEVERITY_LABEL[result.severity]}</strong> {result.title}</span>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1">
            <span className="block font-medium">Destination project</span>
            <select className="max-w-full rounded border border-zk-border bg-zk-bg p-2"
              required value={projectId} disabled={pending || Boolean(options.projectId)}
              onChange={(event) => setProjectId(event.currentTarget.value)}>
              <option value="">Choose a project</option>
              {options.projects.filter((project) => !options.projectId || project.id === options.projectId)
                .map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={pending || !projectId || !selected.length}
            className="rounded bg-zk-text px-4 py-2 text-zk-bg disabled:opacity-50">
            {pending ? "Sending…" : "Send selected findings"}
          </button>
        </>
      )}
      {outcome && !outcome.ok ? <p role="alert">{outcome.error}</p> : null}
      {outcome?.ok ? (
        <div role="status" className="space-y-1">
          <p>{outcome.created} created. {outcome.reused} already sent.</p>
          {outcome.issues.length ? <ul>
            {outcome.issues.map((issue) => <li key={issue.number}>
              <Link className="underline" href={issue.href}>Issue #{issue.number}</Link>
            </li>)}
          </ul> : null}
        </div>
      ) : null}
    </form>
  );
}
