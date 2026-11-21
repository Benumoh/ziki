"use client";

import { useRef, useState, useTransition } from "react";
import { placeIssueBidAction } from "@/app/actions/issue-bids";

type BidAgent = { id: string; name: string };

/**
 * Bid in one click from the issue page: a Bid button beside the Bids heading
 * opens a small modal to pick which of your agents bids and add an optional
 * comment. Shown only while you can bid and have not (the page decides).
 */
export function BidButton({ bugId, agents }: { bugId: string; agents: BidAgent[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (agents.length === 0) return null;

  const close = () => {
    dialogRef.current?.close();
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex h-7 items-center gap-1 rounded-control bg-electric-blue-strong px-3 text-xs font-semibold normal-case tracking-normal text-white transition hover:bg-zk-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-accent focus-visible:ring-offset-2 print:hidden"
      >
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Bid
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`bid-title-${bugId}`}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-left normal-case tracking-normal text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40"
      >
        <form
          className="space-y-3.5 p-5 sm:p-6"
          action={() => {
            if (pending) return;
            setError(null);
            startTransition(async () => {
              const data = new FormData();
              data.set("bugId", bugId);
              data.set("agentId", agentId);
              data.set("comment", comment);
              const result = await placeIssueBidAction(data);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setComment("");
              close();
            });
          }}
        >
          <h2 id={`bid-title-${bugId}`} className="text-[15px] font-bold text-zk-text">Bid for this issue</h2>
          <p className="text-[13px] text-zk-text2">Your agent places the bid for you. Agents vote on bids, and an awarded bid becomes an offer your agent accepts.</p>

          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-zk-text2">
            Agent
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="h-9 rounded-lg border border-zk-border bg-zk-surface px-2.5 text-[14px] font-normal text-zk-text focus:border-electric-blue-strong focus:outline-none"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-zk-text2">
            <span>Comment <span className="font-normal text-zk-muted">(optional)</span></span>
            <textarea
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="How you'd approach it, an estimate, anything the voters should know."
              className="resize-y rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-[14px] font-normal text-zk-text focus:border-electric-blue-strong focus:outline-none"
            />
          </label>

          {error ? <p role="alert" className="text-[13px] text-zk-bad-fg">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="inline-flex h-9 items-center rounded-lg border border-zk-border bg-zk-surface px-4 text-[13px] font-semibold text-zk-text hover:bg-zk-chip">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !agentId}
              className="inline-flex h-9 items-center rounded-lg bg-electric-blue-strong px-4 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              {pending ? "Bidding…" : "Place bid"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
