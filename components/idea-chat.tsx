"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { createBugAction } from "@/app/actions/issues";
import { ClaudeWorking } from "@/components/claude-working";
import { useChatAttachments } from "@/components/chat-attachments";
import { TOOL_BUTTON } from "@/lib/ui-style";

/** The first line, as the idea's title: up to 120 characters, without Markdown marks. */
function titleFrom(text: string): string {
  const line = text.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  const title = line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
  return title.length >= 3 ? title : "New idea";
}

/**
 * Add Idea as a chat box (#idea-chat): the button opens a composer on its
 * right, in the list's header bar above the table, which grows to hold it,
 * like a chat with an assistant. Type the idea, and with + attach files,
 * record the screen or capture an area of it (kept as images): the same +
 * menu as Marketing's chat (components/chat-attachments.tsx). Send with
 * Enter (Shift+Enter for a new line). It files an idea in this project with
 * the first line as its title; agents structure it afterwards, as any
 * unstructured draft.
 */
export function IdeaChat({
  projectId,
  className = "",
  alwaysOpen = false,
  placeholder,
  onSent,
}: {
  projectId: string;
  className?: string;
  /** Just the box, open from the start and never closed (the Ideas empty state). */
  alwaysOpen?: boolean;
  placeholder?: string;
  /** Stay on this page once it's filed, and run this instead of opening the new idea (First questions). */
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(alwaysOpen);
  // The empty state and the header may both hold a box on one page.
  const boxId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const files = useChatAttachments({ disabled: pending });
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 220)}px`;
  }, [text, open]);

  // Escape closes; a click outside closes it while nothing is typed or attached.
  useEffect(() => {
    if (!open || alwaysOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target) && !text.trim() && files.count === 0) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, alwaysOpen, text, files.count]);

  function send() {
    const body = text.trim();
    if (body.length < 10) {
      setError("Say a little more: at least 10 characters.");
      return;
    }
    if (files.uploading) return;
    setError(null);
    const data = new FormData();
    data.set("title", titleFrom(body));
    data.set("description", body);
    data.set("proofLinks", "");
    data.set("projectId", projectId);
    data.set("isReport", "true");
    if (files.ids.length) data.set("attachmentIds", files.ids.join(","));
    if (onSent) data.set("stay", "true");
    startTransition(async () => {
      try {
        // On success the action takes you to the new idea, unless this box stays where it is.
        const result = await createBugAction(data);
        if (result?.error) setError(result.error);
        else if (onSent && result?.ok) {
          setText("");
          onSent();
        }
      } catch (thrown) {
        unstable_rethrow(thrown);
        setError("Could not send the idea. Try again.");
      }
    });
  }

  const button = (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => boxRef.current?.focus());
        }}
        aria-expanded={open}
        title="Add Idea"
        className={`issues-new ${TOOL_BUTTON} justify-center ${className}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add Idea
      </button>
    </>
  );
  const shownError = error ?? files.error;
  const composer = (
        <div
          ref={panelRef}
          role="group"
          data-idea-chat-open=""
          aria-label="Add an idea"
          // In the header bar, to the right of the Add Idea button, above the table: it takes
          // the rest of the bar (its own row when there's no room) and the bar grows to hold it.
          className={`min-w-0 flex-1 basis-72 ${className}`}
        >
          <div className="rounded-[22px] border border-zk-border bg-zk-surface px-4 pb-2.5 pt-3 shadow-[0_2px_10px_rgba(0,0,0,0.06)] focus-within:border-electric-blue-strong/50">
            <label htmlFor={boxId} className="sr-only">Your idea</label>
            <textarea
              id={boxId}
              ref={boxRef}
              rows={1}
              value={text}
              disabled={pending}
              maxLength={5000}
              placeholder={placeholder ?? "Describe your idea: what's wrong or missing, and what should happen…"}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="block max-h-[220px] min-h-[28px] w-full resize-none border-0 bg-transparent p-1 text-[15px] leading-6 text-zk-text placeholder:text-zk-muted focus:outline-none"
            />
            {files.chips}
            {/* While the idea goes to Claude to be written up, show the work happening. */}
            {pending ? <ClaudeWorking className="mt-2" /> : null}
            {shownError ? <p role="alert" className="m-0 mt-1 px-1 text-xs text-zk-bad-fg">{shownError}</p> : null}
            <div className="mt-2 flex items-center justify-between gap-2">
              {/* + opens the menu: Attach files, Record screen, Capture area. */}
              {files.controls}
              <button
                type="button"
                onClick={send}
                disabled={pending || files.uploading || !text.trim()}
                aria-label="Send idea"
                title="Send"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zk-text text-zk-surface transition disabled:opacity-30"
              >
                {pending ? (
                  <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                )}
              </button>
            </div>
          </div>
          {files.dialog}
        </div>
  );
  if (!open) return button;
  if (alwaysOpen) return composer;

  return (
    <>
      {button}
      {composer}
    </>
  );
}
