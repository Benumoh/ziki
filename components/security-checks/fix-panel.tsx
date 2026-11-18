"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createFixProject, fixSecurityCheck, loadSecurityCheckFixOptions } from "@/app/actions/security-check-fix";
import { BorrowZiks } from "@/components/coins/borrow-ziks";
import { ZikAmount } from "@/components/zik-symbol";
import type { FixOptions, FixOutcome } from "@/lib/security-checks/fix";

/**
 * "Fix N selected" opens this under the Deeper scan's list (17 Nov, Hamzat), in place of the old Move to your app
 * page: choose the project, see what it costs in Ziks, then Pay and move. The ticked findings become issues in that
 * project for agents to fix. A check sends all its findings to one project, so once it has one, that is the only
 * choice. Someone who has never bought Ziks and is short is offered the one-time loan.
 */
export function FixPanel({ checkId, findings, onDone }: { checkId: string; findings: { id: string; price: number }[]; onDone: () => void }) {
  const router = useRouter();
  const [options, setOptions] = useState<FixOptions | null | undefined>();
  const [projectId, setProjectId] = useState("");
  // Where the fixes go (18 Nov, Chloe): a new private project named after the site (editable), or one of yours.
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState<FixOutcome>();
  const [attempt, setAttempt] = useState(0);
  const [pending, startTransition] = useTransition();
  const total = findings.reduce((sum, finding) => sum + finding.price, 0);

  useEffect(() => {
    let current = true;
    loadSecurityCheckFixOptions(checkId).then(
      (data) => {
        if (!current) return;
        setOptions(data);
        // A scan already tied to a project, or a project whose website is this site: that one. Otherwise a new one.
        const known = data?.projectId ?? data?.match ?? "";
        setProjectId(known);
        setMode(known ? "existing" : "new");
        setName(data?.site ?? "");
      },
      () => {
        if (current) setOptions(null);
      },
    );
    return () => {
      current = false;
    };
  }, [checkId, attempt]);

  const nameMissing = mode === "new" && !name.trim();
  const ready = findings.length > 0 && (mode === "new" ? !nameMissing : Boolean(projectId));
  const destination = mode === "new" ? name.trim() : options?.projects.find((project) => project.id === projectId)?.name ?? "";
  function send() {
    if (!ready) return;
    startTransition(async () => {
      try {
        let target = projectId;
        if (mode === "new") {
          const made = await createFixProject(checkId, name);
          if (!made.ok) {
            setOutcome({ ok: false, error: made.error });
            return;
          }
          target = made.projectId;
          setProjectId(made.projectId);
          setMode("existing");
          setAttempt((n) => n + 1);
        }
        const reply = await fixSecurityCheck({ checkId, projectId: target, resultIds: findings.map((finding) => finding.id) });
        setOutcome(reply);
        if (reply.ok) {
          onDone();
          router.refresh();
        }
      } catch {
        setOutcome({ ok: false, error: "Could not send the findings. Try again." });
      }
    });
  }

  if (options === undefined) return <p role="status" className="m-0 px-4 py-4 text-sm text-zk-text2 sm:px-6">Loading your projects…</p>;
  if (options === null) {
    return (
      <p role="status" className="m-0 px-4 py-4 text-sm text-zk-text2 sm:px-6">
        Couldn&apos;t load your projects.{" "}
        <button type="button" className="font-semibold text-zk-accent underline" onClick={() => { setOptions(undefined); setAttempt((n) => n + 1); }}>
          Try again
        </button>
      </p>
    );
  }
  const projects = options.projects.filter((project) => !options.projectId || project.id === options.projectId);
  // Once a scan's fixes have a project, they all go there: no choice to make.
  const locked = Boolean(options.projectId);
  const card = (on: boolean) => `flex gap-3 rounded-xl p-3.5 sm:p-4 ${on ? "border-2 border-electric-blue-strong bg-zk-tint/40" : "border border-zk-border bg-zk-surface"}`;
  return (
    <div id="fix-panel" className="space-y-4 border-t border-zk-border bg-zk-surface px-4 pb-6 pt-4 sm:px-6">
      {locked ? (
        <p className="m-0 text-sm text-zk-text2">
          Fixes go to <span className="font-semibold text-zk-text">{projects[0]?.name ?? "your project"}</span>, like this scan&apos;s earlier fixes.
        </p>
      ) : (
        <fieldset className="m-0 space-y-2 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold text-zk-text">Where should the fixes go?</legend>
          <label className={card(mode === "new")}>
            <input type="radio" name="fix-destination" checked={mode === "new"} onChange={() => setMode("new")} disabled={pending} className="mt-0.5 size-4 shrink-0 accent-electric-blue-strong" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-zk-text">
                New project
                <span className="rounded-full bg-zk-ok-bg px-2 py-0.5 text-xs font-bold text-zk-ok-fg">Recommended</span>
              </span>
              <span className="mt-2.5 block">
                <span className="mb-1 block text-xs font-semibold text-zk-text2">Project name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  onFocus={() => setMode("new")}
                  maxLength={80}
                  placeholder="Name this project"
                  aria-invalid={mode === "new" && nameMissing ? true : undefined}
                  disabled={pending}
                  className={`h-10 w-full rounded-[10px] border bg-zk-surface px-3 text-sm text-zk-text outline-none placeholder:text-zk-muted focus:ring-2 focus:ring-electric-blue-strong/30 ${mode === "new" && nameMissing ? "border-red-500" : "border-zk-border"} ${mode === "new" ? "" : "opacity-60"}`}
                />
              </span>
              {mode === "new" && nameMissing ? (
                <span className="mt-1.5 block text-xs font-semibold text-zk-bad-fg">Enter a name for the new project.</span>
              ) : (
                <span className="mt-1.5 block text-xs text-zk-text2">Private, just for this site&apos;s fixes. It isn&apos;t listed in Discover.</span>
              )}
            </span>
          </label>
          {projects.length ? (
            <label className={`${card(mode === "existing")} items-center`}>
              <input type="radio" name="fix-destination" checked={mode === "existing"} onChange={() => setMode("existing")} disabled={pending} className="size-4 shrink-0 accent-electric-blue-strong" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-zk-text">One of your projects</span>
                <span className="mt-0.5 block text-xs text-zk-text2">For a site that&apos;s yours, like your own website going into its project.</span>
              </span>
              <select
                aria-label="Your project"
                className="max-w-[45%] shrink-0 rounded-[10px] border border-zk-border bg-zk-surface px-2.5 py-2 text-sm text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent"
                value={mode === "existing" ? projectId : ""}
                disabled={pending}
                // Choosing a project also chooses this option (impeccable review, 18 Nov).
                onFocus={() => setMode("existing")}
                onChange={(event) => {
                  setMode("existing");
                  setProjectId(event.currentTarget.value);
                }}
              >
                <option value="">Choose…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
      )}
      <div role="status" className="flex items-center justify-between gap-3 border-t border-zk-divider pt-4">
        <div className="text-sm text-zk-text2">
          <p className="m-0">{findings.length} selected</p>
          <p className="m-0 text-xs text-zk-text2">Paid from your Ziks wallet</p>
        </div>
        <ZikAmount amount={total} className="font-semibold tabular-nums text-zk-text" />
      </div>
      <button
        type="button"
        onClick={send}
        disabled={pending || !ready}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-electric-blue-strong px-5 py-2 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        {pending ? "Sending…" : destination ? `Pay and send to ${destination}` : "Pay and send"}
      </button>
      {!ready && !pending && mode === "existing" && !projectId ? (
        <p className="m-0 -mt-2 text-center text-xs text-zk-text2">Choose one of your projects.</p>
      ) : null}
      {outcome && !outcome.ok ? <p role="alert" className="m-0 text-sm font-medium text-zk-bad-fg">{outcome.error}</p> : null}
      {/* Never bought Ziks: offer the one-time loan, then send again (16 Nov call). */}
      {outcome && !outcome.ok && outcome.canBorrow ? <BorrowZiks onBorrowed={send} /> : null}
      {outcome?.ok ? (
        <p role="status" className="m-0 text-sm text-zk-ok-fg">
          Sent to your app.{" "}
          {outcome.issues.map((issue, i) => (
            <span key={issue.number}>
              {i ? ", " : ""}
              <Link className="font-semibold underline" href={issue.href}>Issue #{issue.number}</Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
