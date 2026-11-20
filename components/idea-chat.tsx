"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { createBugAction } from "@/app/actions/issues";
import { askProjectChatAction } from "@/app/actions/project-chat";
import { IDEA_ADDED_EVENT } from "@/lib/just-added";
import type { ProjectRef } from "@/lib/project-paths";
import { Avatar } from "@/components/avatar";
import { ClaudeWorking } from "@/components/claude-working";
import { ZikiMark } from "@/components/ziki-mark";
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
  chatSlug,
  me,
}: {
  projectId: string;
  className?: string;
  /** Just the box, open from the start and never closed (the Ideas empty state). */
  alwaysOpen?: boolean;
  placeholder?: string;
  /**
   * The project chat (#project-chat): given the project, the box is a conversation with Ziki instead of a form. Ziki
   * replies, sets the product's basics as they're given (lib/project-chat/assistant.ts) and files described work as an
   * idea, with the attached files.
   */
  chatSlug?: ProjectRef;
  /** Who is chatting: their picture goes beside their messages. */
  me?: { name: string | null; image: string | null };
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
  const router = useRouter();
  // The conversation with Ziki (#project-chat), oldest first; the page keeps it, the server doesn't.
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; text: string; activity?: string[] }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Keep the newest message in view as it arrives and types itself out.
  useEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };
    toBottom();
    const observer = new ResizeObserver(toBottom);
    observer.observe(list);
    return () => observer.disconnect();
  }, [turns.length]);

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

  /**
   * File work as an idea: the first line is its title. From the project chat it stays on the page (#just-added): the
   * feed below refreshes and flashes the new idea. Elsewhere the action takes you to it.
   */
  async function fileIdea(body: string) {
    const data = new FormData();
    data.set("title", titleFrom(body));
    data.set("description", body);
    data.set("proofLinks", "");
    data.set("projectId", projectId);
    data.set("isReport", "true");
    if (files.ids.length) data.set("attachmentIds", files.ids.join(","));
    if (chatSlug) data.set("stay", "true");
    const result = await createBugAction(data);
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (chatSlug && result?.ideaNumber) {
      files.clear();
      router.refresh();
      window.dispatchEvent(new CustomEvent(IDEA_ADDED_EVENT, { detail: { number: result.ideaNumber } }));
    }
  }

  /** The project chat: send the conversation, show Ziki's reply, refresh what it set, file what it filed. */
  function talk(body: string) {
    const history = [...turns.map(({ role, text: said }) => ({ role, text: said })), { role: "user" as const, text: body }];
    setTurns((previous) => [...previous, { role: "user", text: body }]);
    setText("");
    setError(null);
    startTransition(async () => {
      try {
        const answer = await askProjectChatAction(chatSlug!, history);
        if (!answer.ok) {
          setError(answer.error);
          return;
        }
        setTurns((previous) => [...previous, { role: "assistant", text: answer.reply, activity: answer.activity }]);
        if (answer.changed.length) router.refresh();
        if (answer.idea) await fileIdea(answer.idea);
      } catch (thrown) {
        unstable_rethrow(thrown);
        setError("Could not reach Ziki. Try again.");
      }
    });
  }

  function send() {
    const body = text.trim();
    if (chatSlug) {
      if (!body || pending || files.uploading) return;
      talk(body);
      return;
    }
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
    startTransition(async () => {
      try {
        // On success the action takes you to the new idea.
        const result = await createBugAction(data);
        if (result?.error) setError(result.error);
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
  // The conversation so far, above the box (#project-chat): Ziki on the left, you on the right, as a chat. Ziki's newest
  // reply types itself out, as paper coming out of a typewriter.
  // It sits on a sheet of white paper rising out of the box, as from a typewriter, which scrolls once it is tall and
  // closes with ×.
  const conversation = chatSlug && turns.length ? (
    <div
      className="zk-paper relative mx-auto mb-4 w-[calc(100%-1rem)] max-w-[820px] rounded-[24px] bg-white pb-3 shadow-[0_28px_56px_-16px_rgba(16,24,40,0.28),0_10px_20px_-10px_rgba(16,24,40,0.16),0_0_0_1px_rgba(16,24,40,0.04)]"
      style={{ animation: "zk-sheet 0.45s ease-out both" }}
    >
      <style>{`
/* The clips end past the edges, so they never cut off the drop shadows. */
@keyframes zk-sheet { from { clip-path: inset(100% -80px -80px -80px); transform: translateY(14px) } to { clip-path: inset(-80px -80px -80px -80px); transform: translateY(0) } }
@keyframes zk-paper { from { clip-path: inset(-40px -40px 100% -40px); transform: translateY(-6px) } to { clip-path: inset(-40px -40px -40px -40px); transform: translateY(0) } }
@keyframes zk-caret { 50% { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .zk-paper { animation: none !important } }
`}</style>
      <button
        type="button"
        onClick={() => setTurns([])}
        aria-label="Close the chat"
        title="Close"
        className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-electric-blue"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <div ref={scrollRef} className="max-h-[300px] overflow-y-auto px-5 pb-4 pt-4">
    <ol ref={listRef} aria-label="Conversation with Ziki" aria-live="polite" className="m-0 flex list-none flex-col gap-2.5 p-0 pr-6">
      {turns.map((turn, index) => {
        const mine = turn.role === "user";
        const newest = index === turns.length - 1;
        return (
          <li key={index} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
            {mine ? (
              <Avatar name={me?.name ?? "You"} image={me?.image ?? null} size="sm" className="mb-0.5 !h-6 !w-6 shadow-[0_2px_6px_rgba(16,24,40,0.18)]" />
            ) : (
              <span aria-hidden="true" className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zk-text text-zk-surface shadow-[0_2px_6px_rgba(16,24,40,0.22)]">
                <ZikiMark className="h-3 w-auto" />
              </span>
            )}
            <div
              className={`zk-paper relative max-w-[75%] px-3 py-1.5 text-[13px] leading-relaxed shadow-[0_8px_18px_-6px_rgba(16,24,40,0.22),0_2px_4px_-1px_rgba(16,24,40,0.10)] ${mine
                ? "rounded-2xl rounded-br-[4px] bg-zk-text text-zk-surface"
                : "rounded-2xl rounded-bl-[4px] bg-[#f1f3f6] text-zk-text"}`}
              style={!mine && newest ? { animation: "zk-paper 0.5s ease-out both" } : undefined}
            >
              {/* The little tail on the bubble's bottom corner, toward who said it. */}
              <span
                aria-hidden="true"
                className={`absolute bottom-0 h-3 w-3 ${mine ? "-right-1.5 bg-zk-text [clip-path:polygon(0_0,0_100%,100%_100%)]" : "-left-1.5 bg-[#f1f3f6] [clip-path:polygon(100%_0,0_100%,100%_100%)]"}`}
              />
              <span className="sr-only">{mine ? "You: " : "Ziki: "}</span>
              {!mine && newest ? <Typed text={turn.text} /> : <span className="whitespace-pre-wrap">{turn.text}</span>}
              {turn.activity?.length ? (
                <ul className="m-0 mt-1.5 list-none p-0 text-[11.5px] text-zk-muted">
                  {turn.activity.map((line) => <li key={line}>✓ {line}</li>)}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
      </div>
    </div>
  ) : null;
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
          {conversation}
          <div
            role="presentation"
            // A click anywhere in the box that isn't a control (the empty space under the text, beside +) puts the
            // cursor in the text, ready to type.
            onMouseDown={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("button, a, input, textarea, [role='menu']")) return;
              event.preventDefault();
              boxRef.current?.focus();
            }}
            className="relative z-[1] cursor-text rounded-[22px] border border-black/[0.06] bg-zk-surface px-4 pb-2.5 pt-3 shadow-[0_14px_34px_rgba(16,24,40,0.10),0_3px_8px_rgba(16,24,40,0.06)] focus-within:border-electric-blue-strong/50"
          >
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
              className="block max-h-[220px] min-h-[28px] w-full resize-none border-0 bg-transparent p-1 text-[14px] leading-6 text-zk-text placeholder:text-zk-muted focus:outline-none"
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
                aria-label={chatSlug ? "Send" : "Send idea"}
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

/**
 * Ziki's newest reply, typed out a few characters at a time with a caret, like a typewriter (#project-chat). Screen
 * readers get the whole text at once; people who ask for reduced motion see it whole.
 */
function Typed({ text }: { text: string }) {
  // Whole at once for people who ask for reduced motion.
  const [still] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const [typed, setShown] = useState(0);
  const shown = still ? text.length : typed;
  useEffect(() => {
    if (still) return;
    let count = 0;
    const timer = setInterval(() => {
      count = Math.min(text.length, count + 3);
      setShown(count);
      if (count >= text.length) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [text, still]);
  const done = shown >= text.length;
  return (
    <span className="whitespace-pre-wrap">
      <span aria-hidden="true">{text.slice(0, shown)}</span>
      {done ? null : <span aria-hidden="true" className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] bg-zk-text" style={{ animation: "zk-caret 0.8s step-end infinite" }} />}
      <span className="sr-only">{text}</span>
    </span>
  );
}
