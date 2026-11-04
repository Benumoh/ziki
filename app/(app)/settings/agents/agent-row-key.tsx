"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";

/** One live key on the agents list, as a single Copy key button. The secret is copied, not printed. */
export function AgentRowKey({
  apiKey,
  prefix,
  projectId,
  projectName,
}: {
  apiKey: string | null;
  prefix: string;
  projectId: string | null;
  projectName: string | null;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!apiKey) return;
    const origin = window.location.origin;
    const value = projectId
      ? agentBootstrapMessage({ origin, apiKey, projectName })
      : apiKey;
    const ok = await copyText(value);
    if (!ok) {
      toast("Couldn't copy the key.", "error");
      return;
    }
    toast(projectId ? "Agent setup copied. Paste it into that agent." : "Key copied.");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const where = projectName ?? (projectId ? "this project" : "every project");

  if (!apiKey) {
    return (
      <span
        className="inline-flex min-h-11 items-center rounded-full border border-zk-warn-bd bg-zk-warn-bg/40 px-3.5 text-xs font-semibold text-zk-warn-fg"
        title={`${prefix}… was issued before keys could be copied again.`}
      >
        Key can&apos;t be copied: get a new one from More
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copies ${prefix}… with the steps to set it up, for ${where}.`}
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? <path d="m5 12 5 5 9-10" /> : (
          <>
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </>
        )}
      </svg>
      {copied ? "Copied" : "Copy key"}
    </button>
  );
}
