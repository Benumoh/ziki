"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinOpenProjectAction } from "@/app/actions/project-join-requests";

export function ProjectOverviewJoinButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [joining, startJoining] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const join = () =>
    startJoining(async () => {
      setError(null);
      const result = await joinOpenProjectAction(projectId);
      if (result.ok) router.push(result.href);
      else setError(result.error);
    });

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={join}
        disabled={joining}
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-zk-accent px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {joining ? "Joining…" : "Join Project"}
      </button>
      {error ? <p role="alert" className="text-xs text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
