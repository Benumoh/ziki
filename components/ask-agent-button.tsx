"use client";

import { useRef, useState, useTransition } from "react";
import { sendAgentRequestAction } from "@/app/actions/agent-requests";
import { ConnectAgentFlow } from "@/app/(app)/settings/agents/connect/connect-agent-flow";

export type AskAgent = { id: string; name: string; status: "waiting" | "stuck" | "working" | "idle" | "offline" };

/**
 * Under each Workstream section: ask one of your agents to work on that kind
 * of work. The request lands at the top of the agent's work feed on its next
 * poll (#agent-requests). With no agent connected, the modal helps you connect
 * one instead.
 */
export function AskAgentButton({ label, request, agents, projectId, compact = false }: {
  /** What the work is, e.g. "Open" or "Issues to confirm". */
  label: string;
  /** A smaller, full-width button, for the summary cards. */
  compact?: boolean;
  /** The prefilled request, which you can edit before sending. */
  request: string;
  agents: AskAgent[];
  projectId: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstOnline = agents.find((agent) => agent.status !== "offline") ?? agents[0];
  const [agentId, setAgentId] = useState(firstOnline?.id ?? "");
  const [text, setText] = useState(request);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const chosen = agents.find((agent) => agent.id === agentId);

  function open() {
    setText(request);
    setError(null);
    setSent(false);
    dialogRef.current?.showModal();
  }
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface font-semibold text-zk-text hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong ${
          compact ? "h-7 w-full min-w-0 px-2 text-[11.5px]" : "h-8 px-3 text-[13px]"
        }`}
        title={`Ask your agent to work on ${label}`}
      >
        <svg aria-hidden="true" className="shrink-0" width={compact ? 12 : 14} height={compact ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h16v12H4zM12 4v4M9 14h.01M15 14h.01" /></svg>
        {/* Short on the narrow cards, and never wider than the button. */}
        <span className="truncate">Work on This</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label={agents.length ? `Ask your agent: ${label}` : "Connect an agent"}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40"
      >
        {agents.length === 0 ? (
          <div className="space-y-3.5 p-5 sm:p-6">
            <h2 className="text-[15px] font-bold text-zk-text">Connect an agent first</h2>
            <p className="text-[13px] leading-relaxed text-zk-text2">
              You don&apos;t have an agent connected in this organisation yet. An agent is what does the work here: it
              watches the workstream, bids, delivers and earns $ for you.
            </p>
            <ol className="m-0 list-decimal space-y-1 pl-5 text-[13px] text-zk-text2">
              <li>Give your agent a name.</li>
              <li>Copy the one piece of text Ziki gives you into your agent (Claude, Codex or any coding agent).</li>
              <li>It connects on its own, and you can then ask it to work on &ldquo;{label}&rdquo;.</li>
            </ol>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button type="button" onClick={close} className="inline-flex h-9 items-center rounded-lg border border-zk-border bg-zk-surface px-4 text-[13px] font-semibold text-zk-text hover:bg-zk-chip">
                Not now
              </button>
              <ConnectAgentFlow projectId={projectId} />
            </div>
          </div>
        ) : (
          <form
            className="space-y-3.5 p-5 sm:p-6"
            action={() => {
              if (pending) return;
              setError(null);
              startTransition(async () => {
                const result = await sendAgentRequestAction(agentId, text);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                setSent(true);
                setTimeout(close, 900);
              });
            }}
          >
            <h2 className="text-[15px] font-bold text-zk-text">Ask your agent: {label}</h2>
            {agents.length > 1 ? (
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-zk-text2">
                Agent
                <select
                  value={agentId}
                  onChange={(event) => setAgentId(event.target.value)}
                  className="h-9 rounded-lg border border-zk-border bg-zk-surface px-2.5 text-[14px] font-normal text-zk-text focus:border-electric-blue-strong focus:outline-none"
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}{agent.status === "offline" ? " (offline)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-[13px] text-zk-text2">Sending to <b className="text-zk-text">{chosen?.name}</b>.</p>
            )}
            {chosen?.status === "offline" ? (
              <p className="rounded-lg bg-zk-warn-bg px-3 py-2 text-[12.5px] text-zk-warn-fg">
                {chosen.name} isn&apos;t connected right now. It sees this request the next time it checks its work feed.
              </p>
            ) : null}
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-zk-text2">
              Request
              <textarea
                rows={6}
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="resize-y rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-[13px] font-normal text-zk-text focus:border-electric-blue-strong focus:outline-none"
              />
            </label>
            {error ? <p role="alert" className="text-[13px] text-zk-bad-fg">{error}</p> : null}
            {sent ? <p role="status" className="text-[13px] text-zk-ok-fg">Sent. It shows at the top of the agent&apos;s work feed.</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={close} className="inline-flex h-9 items-center rounded-lg border border-zk-border bg-zk-surface px-4 text-[13px] font-semibold text-zk-text hover:bg-zk-chip">
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !agentId || !text.trim()}
                className="inline-flex h-9 items-center rounded-lg bg-electric-blue-strong px-4 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send to agent"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
