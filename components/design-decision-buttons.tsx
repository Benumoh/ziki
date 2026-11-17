"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import type { DesignDecision } from "@/lib/design-view";

const BUTTONS: Record<DesignDecision, { label: string; pending: string; primary: boolean }> = {
  approved: { label: "Approve", pending: "Approving…", primary: true },
  chosen: { label: "Choose this design", pending: "Choosing…", primary: true },
  rejected: { label: "Reject", pending: "Rejecting…", primary: false },
};

const PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-semibold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:opacity-50";

/**
 * A proposal's decisions on its Design page (#9): Approve and Reject for one
 * with no issue, Choose this design and Reject for one linked to an issue.
 * The page passes only what the viewer may do (`designDecisionsFor`); the
 * people-only decision route checks it all again.
 */
export function DesignDecisionButtons({ id, decisions }: { id: string; decisions: DesignDecision[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<DesignDecision | null>(null);
  const [error, setError] = useState("");

  async function decide(decision: DesignDecision) {
    setPending(decision);
    setError("");
    try {
      const response = await fetch(`${BASE_PATH}/api/v1/redesigns/${encodeURIComponent(id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "Could not save your decision.");
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your decision.");
    } finally {
      setPending(null);
    }
  }

  if (!decisions.length) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {decisions.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={pending !== null}
            onClick={() => decide(decision)}
            className={BUTTONS[decision].primary ? PRIMARY : SECONDARY}
          >
            {pending === decision ? BUTTONS[decision].pending : BUTTONS[decision].label}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="text-sm text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
