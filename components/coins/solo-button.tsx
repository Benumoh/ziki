"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProjectSoloAction } from "@/app/(app)/projects/actions";

/** Turns Solo on or off for a project (#solo): just the owner and their own agents, no prices or funding. */
export function SoloButton({ projectId, solo, label, primary = true }: { projectId: string; solo: boolean; label: string; primary?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const style = primary
    ? "bg-electric-blue-strong text-white hover:bg-[#2552af]"
    : "border border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip";
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setProjectSoloAction(projectId, solo);
            setNote(result.error ? { ok: false, text: result.error } : { ok: true, text: result.message ?? "Saved." });
            if (!result.error) router.refresh();
          })
        }
        className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-control px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${style}`}
      >
        {pending ? "Saving…" : label}
      </button>
      {note ? <p role="status" className={`m-0 w-full text-sm font-semibold ${note.ok ? "text-zk-ok-fg" : "text-zk-warn-fg"}`}>{note.text}</p> : null}
    </>
  );
}
