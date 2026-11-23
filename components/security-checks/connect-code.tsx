"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectCodeScan } from "@/app/actions/security-code-scan";
import type { CodeProject } from "@/lib/security-checks/code-scan";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent";

/**
 * Connect your code, free (#security-code-scan; 18 Nov call, Mark: "connect to their code… without asking them for
 * money yet"). Chloe's two ways to connect, from her Connect code window, now on the Code scan's own page and without
 * a price: connecting reads the repo for free, and this page then shows what Ziki found and asks for the code
 * scan's price before agents read the code.
 * - Read-only: a public GitHub repo's link. Agents read the code without signing in.
 * - Connect GitHub and fix for me: a project with GitHub connected. Its repo is scanned and the findings go to it,
 *   where agents fix them in pull requests.
 */
export function ConnectCodeForm({ checkId, projects }: { checkId: string; projects: CodeProject[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"read" | "github">("read");
  const [repo, setRepo] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [connecting, start] = useTransition();
  const option = (value: "read" | "github") =>
    `flex w-full gap-3 rounded-xl border p-3.5 text-left ${mode === value ? "border-electric-blue-strong ring-2 ring-electric-blue-strong/15" : "border-zk-border hover:bg-zk-chip/50"} ${FOCUS}`;
  const ready = mode === "read" ? repo.trim().length > 0 : projectId !== "";

  function connect() {
    start(async () => {
      setError(null);
      const source = mode === "read" ? { kind: "link" as const, repo } : { kind: "project" as const, projectId };
      let outcome;
      try {
        outcome = await connectCodeScan(checkId, source);
      } catch {
        // It may have gone through before the connection dropped: read the page again rather than connecting twice.
        router.refresh();
        return;
      }
      // Connected (or already, from another tab): this page now shows what Ziki found, and Run code scan.
      if (outcome.ok || outcome.reason === "already_connected") {
        router.refresh();
        return;
      }
      setError(outcome.error);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !connecting) connect();
      }}
      className="flex max-w-[600px] flex-col gap-2.5"
    >
      <button type="button" onClick={() => setMode("read")} aria-pressed={mode === "read"} className={option("read")}>
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-bold text-zk-text">
            Read-only <span className="rounded-full bg-zk-ok-bg px-2 py-px text-xs font-extrabold uppercase tracking-wide text-zk-ok-fg">Safest</span>
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-zk-muted">Ziki reads the code and tells you each fix to copy. Nothing in your repo is changed.</span>
        </span>
      </button>
      {mode === "read" ? (
        <input
          type="text"
          inputMode="url"
          aria-label="Your GitHub repo"
          placeholder="github.com/your-team/your-repo"
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          className="h-10 rounded-control border border-zk-border bg-zk-surface px-3 text-sm text-zk-text placeholder:text-zk-muted focus:border-electric-blue-strong/60 focus:outline-none"
        />
      ) : null}
      <button type="button" onClick={() => setMode("github")} aria-pressed={mode === "github"} className={option("github")}>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-zk-text">Connect GitHub and fix for me</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-zk-muted">Agents open pull requests with the fixes, for you to review and merge. Best for sites that aren&apos;t critical.</span>
        </span>
      </button>
      {mode === "github" ? (
        projects.length ? (
          <select
            aria-label="The project this code belongs to"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-10 rounded-control border border-zk-border bg-zk-surface px-3 text-sm text-zk-text focus:border-electric-blue-strong/60 focus:outline-none"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name} · {project.repo}</option>
            ))}
          </select>
        ) : (
          <p className="m-0 rounded-control bg-zk-chip px-3 py-2 text-xs leading-relaxed text-zk-text2">
            None of your projects has GitHub connected yet. Connect GitHub in a project&apos;s settings, then come back here.
          </p>
        )
      ) : null}
      <p className="m-0 mt-1 text-xs text-zk-muted">Connecting is free. Ziki never pushes to your main branch, and you can disconnect any time.</p>
      {error ? <p role="alert" className="m-0 rounded-control bg-zk-bad-bg px-3 py-2 text-sm text-zk-bad-fg">{error}</p> : null}
      <div className="mt-2">
        <button
          type="submit"
          disabled={!ready || connecting}
          className={`inline-flex h-9 items-center rounded-xl bg-electric-blue-strong px-4 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60 ${FOCUS}`}
        >
          {connecting ? "Reading your code…" : "Connect and check for free"}
        </button>
      </div>
    </form>
  );
}
