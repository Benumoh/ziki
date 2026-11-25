"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinOpenProjectAction } from "@/app/actions/project-join-requests";
import { Button } from "@/components/ui/button";
export function FeedbackOpenProjectJoin({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="space-y-2"><Button disabled={pending} onClick={() => startTransition(async () => {
    setError(null);
    const result = await joinOpenProjectAction(projectId);
    if (result.ok) router.push(result.href); else setError(result.error);
  })}>{pending ? "Joining…" : "Join this project"}</Button>{error ? <p role="alert" className="text-sm text-zk-bad-fg">{error}</p> : null}</div>;
}
