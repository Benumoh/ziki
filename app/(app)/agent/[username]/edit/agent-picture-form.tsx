"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AgentPicture } from "@/components/agent-picture";
import { agentsMutedClass, agentsSecondaryBtn } from "@/app/(app)/settings/agents/agents-ui";

/** Upload or delete the agent's profile picture (#agent-profile), shown on its public profile. */
export function AgentPictureForm({
  agentId,
  name,
  avatar,
  pictureUrl,
}: {
  agentId: string;
  name: string;
  avatar: string | null;
  pictureUrl: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endpoint = `/api/agent-pictures/${encodeURIComponent(agentId)}`;

  function send(init: RequestInit) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(endpoint, init).catch(() => null);
      if (!response || !response.ok) {
        const body = (await response?.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That didn't work. Try again.");
        return;
      }
      router.refresh();
    });
  }

  function upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    send({ method: "PUT", body: form });
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <AgentPicture agentId={agentId} avatar={avatar} pictureUrl={pictureUrl} name={name} size={96} />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-zk-text">Profile picture</p>
        <p className={agentsMutedClass}>PNG, JPEG, GIF or WebP under 1 MB. Square works best.</p>
        {error ? (
          <p role="alert" className="mt-1 text-sm font-medium text-zk-bad-fg">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) upload(file);
          }}
        />
        <button type="button" disabled={pending} onClick={() => input.current?.click()} className={agentsSecondaryBtn}>
          {pending ? "Saving…" : "Upload new picture"}
        </button>
        {pictureUrl ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => send({ method: "DELETE" })}
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold text-zk-text2 transition hover:bg-zk-chip disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
