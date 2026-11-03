"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

export function DecisionButtons({ id, linkedToIssue = false }: { id: string; linkedToIssue?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "approved" | "rejected") {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`${BASE_PATH}/api/v1/redesigns/${encodeURIComponent(id)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? "Could not save your decision."); }
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save your decision."); }
    finally { setPending(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {!linkedToIssue ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => decide("approved")}
            className="inline-flex h-11 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Approve
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("rejected")}
          className="inline-flex h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-semibold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
