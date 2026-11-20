"use client";

import { useEffect, useState } from "react";
import type { PublicProjectRef } from "@/lib/public-project-paths";

export function PublicFeedbackVote({ project, number, count, detailed = false }: {
  project: PublicProjectRef; number: number; count: number; detailed?: boolean;
}) {
  const [current, setCurrent] = useState({ count, voted: false });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const endpoint = `/api/public/projects/${encodeURIComponent(project.orgSlug)}/${encodeURIComponent(project.projectSlug)}/issues/${number}/votes`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (response.ok) setCurrent(await response.json()); })
      .catch(() => {});
    return () => controller.abort();
  }, [endpoint]);
  async function vote() {
    setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voted: !current.voted }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Your vote could not be saved.");
      setCurrent({ count: result.count, voted: result.voted });
      setMessage(result.voted ? "Your vote has been added" : "Your vote has been removed");
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setPending(false); }
  }
  return (
    <div className="shrink-0">
      <button type="button" aria-pressed={current.voted} disabled={pending} onClick={vote}
        aria-label={`${current.voted ? "Remove your vote from" : "Upvote"} feedback #${number}; ${current.count} customer votes`}
        className={`inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent disabled:opacity-50 ${detailed ? "flex-row" : "flex-col gap-0.5"} ${current.voted ? "border-zk-accent bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text2 hover:border-zk-accent hover:text-zk-accent"}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg>
        <span className="tabular-nums">{current.count}</span>
        {detailed ? <span>{current.voted ? "Voted · I have this problem too" : "I have this problem too"}</span> : null}
      </button>
      {message ? <p role="status" className="mt-1 max-w-64 text-xs text-zk-accent">{message}</p> : null}
      {error ? <p role="alert" className="mt-1 max-w-64 text-xs text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
