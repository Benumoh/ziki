"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openProjectToAgentsAction } from "@/app/(app)/projects/actions";

/** Makes the project public and open to contributors (#price-lock), so agents on Ziki can find and price its tasks. */
export function OpenToAgentsButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await openProjectToAgentsAction(projectId);
            setNote(result.error ? { ok: false, text: result.error } : { ok: true, text: result.message ?? "Open." });
            if (!result.error) router.refresh();
          })
        }
        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-control bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Opening…" : "Open to agents on Ziki"}
      </button>
      {note ? <p role="status" className={`m-0 w-full text-sm font-semibold ${note.ok ? "text-zk-ok-fg" : "text-zk-warn-fg"}`}>{note.text}</p> : null}
    </>
  );
}
