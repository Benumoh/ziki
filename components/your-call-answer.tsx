"use client";

import { useRef, useState, useTransition } from "react";
import { answerYourCallAction } from "@/app/actions/your-call";
import { PLAIN, plainTitle, type YourCallAnswer, type YourCallItem, type YourCallVote } from "@/lib/your-call-shared";

const GO_BUTTON = "inline-flex h-8 items-center rounded-lg bg-zk-ok-fg px-3 text-[13px] font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";
const STOP_BUTTON = "inline-flex h-8 items-center rounded-lg border border-zk-border bg-zk-surface px-3 text-[13px] font-semibold text-zk-text hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent";

/** What the agents on one side said, in their own words. */
function Side({ heading, votes }: { heading: string; votes: YourCallVote[] }) {
  return (
    <div className="rounded-xl border border-zk-border bg-zk-bg px-3 py-2.5">
      <p className="m-0 text-[13px] font-semibold text-zk-text">{heading}</p>
      <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
        {votes.map((vote) => (
          <li key={vote.agentId} className="text-[13px] leading-snug text-zk-text2">
            <span className="font-semibold text-zk-text">{vote.agentName}: </span>
            {vote.says}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One plain choice on the Your call list (#your-call): a button, and when it
 * is pressed a small box that says what the agents could not agree on and
 * what each side said, and takes an optional note. No files, no jargon: the
 * answer goes to the agents as a comment on the issue.
 */
export function YourCallAnswerButton({ item, answer, onSent }: { item: YourCallItem; answer: YourCallAnswer; onSent: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const words = PLAIN[item.kind];
  const label = answer === "yes" ? words.yes : words.no;

  const show = () => {
    setOpen(true);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();
  const send = () => {
    setError(null);
    startTransition(async () => {
      const result = await answerYourCallAction(item.id, item.kind, answer, note);
      if (result.error) {
        setError(result.error);
        return;
      }
      close();
      onSent();
    });
  };

  return (
    <>
      <button type="button" onClick={show} className={answer === "yes" ? GO_BUTTON : STOP_BUTTON}>
        {label}
      </button>
      <dialog
        ref={dialogRef}
        aria-label={label}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40"
      >
        {open ? (
          <div className="relative flex flex-col gap-3 p-5 sm:p-6">
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
            <h2 className="m-0 pr-8 text-base font-bold text-zk-text">{plainTitle(item.title)}</h2>
            <p className="m-0 text-sm text-zk-text2">{words.question}</p>
            <Side heading={words.yesSaid} votes={item.yes} />
            <Side heading={words.noSaid} votes={item.no} />
            <p className="m-0 text-sm font-semibold text-zk-text">Your answer: {label}</p>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-zk-text">
              Anything the agents should know? (optional)
              <textarea
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm font-normal text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
              />
            </label>
            {error ? <p role="alert" className="m-0 text-xs font-medium text-red-700">{error}</p> : null}
            <div>
              <button
                type="button"
                onClick={send}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-full bg-electric-blue-strong px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send my answer"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
