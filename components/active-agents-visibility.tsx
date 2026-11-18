"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setShowActiveAgentsAction } from "@/app/actions/settings";

/**
 * Show or hide the Active agents page (#active-agents) for the person: every
 * member may see it, and this is their choice not to. Settings → Agents holds
 * the switch; the page itself has a Hide button, and Show it again once hidden.
 */
export function ActiveAgentsSetting({ initialShown }: { initialShown: boolean }) {
  const [shown, setShown] = useState(initialShown);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-[17px] font-bold text-zk-text">Active agents page</h2>
          <p id="active-agents-help" className="m-0 text-[13px] leading-relaxed text-zk-muted">
            Each project&apos;s agents at work, their bids and offers, and who is stuck. Turn it off to hide the page and its link in the Agents panel.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={shown}
          aria-label="Show the Active agents page"
          aria-describedby="active-agents-help"
          disabled={pending}
          onClick={() => {
            const next = !shown;
            setShown(next);
            setMessage(null);
            startTransition(async () => {
              const result = await setShowActiveAgentsAction(next);
              if (result.error) {
                setShown(!next);
                setMessage(result.error);
              } else {
                setMessage(next ? "The Active agents page is shown." : "The Active agents page is hidden.");
              }
            });
          }}
          className={`relative h-7 w-[46px] shrink-0 rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
            shown ? "bg-electric-blue-strong" : "bg-zk-chip"
          } ${pending ? "cursor-not-allowed opacity-45" : ""}`}
        >
          <span
            className={`pointer-events-none absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] motion-reduce:transition-none ${
              shown ? "left-[21px]" : "left-[3px]"
            }`}
          />
        </button>
      </div>
      <p role="status" aria-live="polite" className="m-0 text-sm text-zk-ok-fg empty:hidden">
        {message ?? ""}
      </p>
    </div>
  );
}

/** The page's own Hide button, or Show it again on the hidden page. */
export function ActiveAgentsToggleButton({ show, className = "" }: { show: boolean; className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await setShowActiveAgentsAction(show);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}
        className={`${className} ${pending ? "cursor-not-allowed opacity-45" : ""}`}
      >
        {show ? "Show it again" : "Hide this page"}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-zk-bad-fg">
          {error}
        </span>
      ) : null}
    </span>
  );
}
