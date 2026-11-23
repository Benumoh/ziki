"use client";

import { useState, useTransition } from "react";
import { sendIssueSteer } from "@/app/actions/agent-steering";

/**
 * Nudge a stuck agent (#online-agents): one click sends it a steer note asking
 * where it is (sendIssueSteer, so only its owner may), which it reads on its
 * next poll. The button then says it was sent, or why it wasn't.
 */
export function NudgeButton({
  agentId,
  issueId,
  note,
  label,
  className,
}: {
  agentId: string;
  issueId: string;
  /** The steer note to send (nudgeNote). */
  note: string;
  label: string;
  className: string;
}) {
  const [state, setState] = useState<{ sent: boolean; error: string | null }>({ sent: false, error: null });
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pending || state.sent}
        onClick={() =>
          startTransition(async () => {
            const result = await sendIssueSteer(agentId, issueId, note);
            setState(result.ok ? { sent: true, error: null } : { sent: false, error: result.error });
          })
        }
        className={className}
      >
        {pending ? "Nudging…" : state.sent ? "Nudged" : label}
      </button>
      <span role="status" className={`max-w-[12rem] text-right text-[11px] ${state.error ? "text-zk-bad-fg" : "text-zk-muted"}`}>
        {state.error ?? (state.sent ? "It reads it on its next check-in" : "")}
      </span>
    </span>
  );
}
