"use client";

import { useId, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { createBugAction } from "@/app/actions/issues";
import { useChatAttachments } from "@/components/chat-attachments";

/** The first line, as the work's title: up to 120 characters, without Markdown marks. */
function titleFrom(text: string): string {
  const line = text.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
}

/**
 * Add work on an asset (#marketing-assets) the way Your App takes ideas: a chat box. What is typed is filed as a
 * marketing idea on this asset, under its type, with the first line as its title and the text as why it is worth
 * doing; + attaches files, Record screen and Capture area attach what's on screen. The list refreshes with it.
 */
export function AssetChat({ projectId, typeId, assetId, assetName }: { projectId: string; typeId: string; assetId: string; assetName: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const boxId = useId();
  const files = useChatAttachments({ disabled: pending });

  function send() {
    const body = text.trim();
    if (body.length < 10) {
      setError("Say a little more: at least 10 characters.");
      return;
    }
    if (files.uploading || pending) return;
    setError(null);
    const data = new FormData();
    data.set("track", "marketing");
    data.set("projectId", projectId);
    data.set("typeId", typeId);
    data.set("assetId", assetId);
    data.set("title", titleFrom(body));
    data.set("description", body);
    data.set("rationale", body);
    data.set("proofLinks", "");
    data.set("stay", "true");
    if (files.ids.length) data.set("attachmentIds", files.ids.join(","));
    startTransition(async () => {
      try {
        const result = await createBugAction(data);
        if (result?.href) {
          setText("");
          files.clear();
          router.refresh();
        } else {
          setError(result?.error ?? Object.values(result?.fieldErrors ?? {})[0] ?? "Could not add the work. Try again.");
        }
      } catch (thrown) {
        unstable_rethrow(thrown);
        setError("Could not add the work. Try again.");
      }
    });
  }

  return (
    <div className="rounded-[22px] border border-zk-border bg-zk-surface px-4 pb-2.5 pt-3 shadow-[0_2px_10px_rgba(0,0,0,0.06)] focus-within:border-electric-blue-strong/50">
      <label htmlFor={boxId} className="sr-only">Add work on {assetName}</label>
      <textarea
        id={boxId}
        ref={boxRef}
        rows={1}
        value={text}
        disabled={pending}
        maxLength={5000}
        placeholder={`Tell the agents what to do on ${assetName}: a change to make, something to add…`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
        className="block max-h-[220px] min-h-[28px] w-full resize-none border-0 bg-transparent p-1 text-[15px] leading-6 text-zk-text placeholder:text-zk-muted focus:outline-none [field-sizing:content]"
      />
      {files.chips}
      {error ?? files.error ? <p role="alert" className="m-0 mt-1 px-1 text-xs text-zk-bad-fg">{error ?? files.error}</p> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        {files.controls}
        <button
          type="button"
          onClick={send}
          disabled={pending || files.uploading || !text.trim()}
          aria-label="Add the work"
          title="Send"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zk-text text-zk-surface transition disabled:opacity-30"
        >
          {pending ? (
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          )}
        </button>
      </div>
      {files.dialog}
    </div>
  );
}
