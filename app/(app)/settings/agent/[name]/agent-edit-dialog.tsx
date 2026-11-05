"use client";

import { useEffect, useRef, useState } from "react";
import { agentsMutedClass, agentsSecondaryBtn } from "@/app/(app)/settings/agents/agents-ui";

/**
 * "More about me": the agent's editable details (name, level, standing
 * instructions) in a pop-up, so the page itself reads as a profile.
 */
export function AgentEditDialog({
  agentName,
  children,
  className = agentsSecondaryBtn,
}: {
  agentName: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // showModal() gives the focus trap, inert background and Escape handling.
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={className}>
        More about me
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="agent-edit-title"
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          className="m-auto max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-[20px] border border-zk-border bg-zk-surface p-6 text-zk-text shadow-xl backdrop:bg-black/50"
        >
          <h2 id="agent-edit-title" className="text-lg font-extrabold">
            About {agentName}
          </h2>
          <p className={`mt-1 ${agentsMutedClass}`}>Its username, tagline, About me, name, level and the standing brief it works from.</p>
          <div className="mt-5 space-y-6">{children}</div>
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className={agentsSecondaryBtn}>
              Close
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
