"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import { askSite, siteChat } from "@/app/actions/security-assistant";
import "./site-chat.css";

type Message = { id: string; role: "user" | "assistant"; text: string };

const MESSAGE_MAX = 600;

/**
 * The way back into a site's saved chat from its scan page (16 Nov): an icon
 * beside "More actions" at the top, and the chat opening as the page's first
 * section under it, growing open with a soft settle. The holder shares whether
 * it's open between the two; it adds nothing to the page itself.
 */
type SiteChatState = {
  checkId: string;
  site: string;
  /** What the button shows: open as soon as it's clicked. */
  open: boolean;
  /** The chat has been built (the first time it opens), and stays built after. */
  opened: boolean;
  /** Shown a frame after it's built, so even the first opening animates from closed. */
  shown: boolean;
  /** Fully open: focus rings and the card's edge aren't clipped any more. */
  settled: boolean;
  setSettled: (settled: boolean) => void;
  toggle: (open: boolean) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
};
const SiteChatContext = createContext<SiteChatState | null>(null);

function useSiteChat(): SiteChatState {
  const state = useContext(SiteChatContext);
  if (!state) throw new Error("SiteChatButton and SiteChatPanel go inside SiteChatHolder.");
  return state;
}

export function SiteChatHolder({ checkId, site, children }: { checkId: string; site: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const waits = useRef<{ frames: number[]; timer?: ReturnType<typeof setTimeout> }>({ frames: [] });

  function clearWaits() {
    waits.current.frames.forEach((frame) => cancelAnimationFrame(frame));
    clearTimeout(waits.current.timer);
    waits.current = { frames: [] };
  }

  function toggle(next: boolean) {
    clearWaits();
    setOpen(next);
    if (!next) {
      setShown(false);
      setSettled(false);
      return;
    }
    setOpened(true);
    // Two frames, so the closed chat is drawn first and opening it animates; the
    // timer is a backup for a tab whose frames are paused (hidden in the background).
    const show = () => {
      clearWaits();
      setShown(true);
    };
    waits.current.frames.push(requestAnimationFrame(() => waits.current.frames.push(requestAnimationFrame(show))));
    waits.current.timer = setTimeout(show, 120);
  }

  useEffect(() => clearWaits, []);

  return (
    <SiteChatContext.Provider value={{ checkId, site, open, opened, shown, settled, setSettled, toggle, buttonRef }}>{children}</SiteChatContext.Provider>
  );
}

/** The chat icon, the same size and look as the "More actions" button beside it. */
export function SiteChatButton() {
  const { checkId, site, open, toggle, buttonRef } = useSiteChat();
  const label = open ? "Close chat" : `Chat about ${site}`;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => toggle(!open)}
      aria-expanded={open}
      aria-controls={`site-chat-panel-${checkId}`}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border print:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue ${
        open ? "border-electric-blue-strong/40 bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
      </svg>
    </button>
  );
}

/**
 * The chat itself, as the first section under the top row. It's built the
 * first time it opens (so the saved chat loads only when asked for) and kept
 * after, so closing and opening again keeps the conversation and its motion.
 */
export function SiteChatPanel() {
  const { checkId, site, opened, shown, settled, setSettled, toggle, buttonRef } = useSiteChat();
  const panel = useRef<HTMLDivElement>(null);

  // Opening puts you in the box, ready to type.
  useEffect(() => {
    if (!shown) return;
    panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }, [shown]);

  // Escape inside the chat closes it and goes back to the button.
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !panel.current?.contains(event.target as Node)) return;
      toggle(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown, toggle, buttonRef]);

  return (
    <div
      id={`site-chat-panel-${checkId}`}
      className="site-chat-drawer"
      data-open={shown}
      data-settled={settled}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && shown) setSettled(true);
      }}
    >
      <div ref={panel} className="site-chat-drawer__inner" inert={!shown}>
        {opened ? (
          <div className="site-chat-drawer__card">
            <SiteChatBox checkId={checkId} site={site} active={shown} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The chat under one site's result (#security-checks, 14 Nov call): the earlier
 * conversation about that site, carried on. It's saved, so it's still here after
 * a refresh or on another device. Just the messages and the box; loads when the
 * result opens.
 */
export function SiteChatBox({ checkId, site, active = true }: { checkId: string; site: string; active?: boolean }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const log = useRef<HTMLOListElement>(null);

  // The saved chat is the record (16 Nov): read it each time the chat opens and
  // whenever the page comes back into view, so what was said in the Assets chat shows here.
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = () => {
      siteChat(checkId)
        .then((answer) => {
          if (!live) return;
          if (answer.ok) setMessages(answer.messages);
          else setError(answer.error);
        })
        .catch(() => live && setError("This chat couldn't load just now."));
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkId, active]);

  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages, pending]);

  function send() {
    const question = text.trim();
    if (!question || pending) return;
    setText("");
    setError(null);
    // Show the question straight away; the saved conversation replaces it when the answer is in.
    setMessages((current) => [...(current ?? []), { id: `pending-${Date.now()}`, role: "user", text: question }]);
    start(async () => {
      try {
        const answer = await askSite(checkId, question);
        if (answer.ok) setMessages(answer.messages);
        else setError(answer.error);
      } catch {
        setError("Couldn't send that just now. Try again.");
      }
    });
  }

  return (
    <section aria-label={`Chat about ${site}`} className="flex flex-col gap-2 rounded-2xl border border-zk-border bg-zk-surface p-3 sm:p-4">
      {messages && messages.length ? (
        <ol ref={log} className="m-0 flex max-h-80 list-none flex-col gap-2 overflow-y-auto p-0">
          {messages.map((message) => (
            <li key={message.id} className={message.role === "user" ? "ml-auto max-w-[85%]" : "mr-auto max-w-[90%]"}>
              <p
                className={`m-0 whitespace-pre-wrap break-words px-3.5 py-2 text-[14px] ${
                  message.role === "user"
                    ? "rounded-[16px] rounded-br-md bg-electric-blue-strong text-white"
                    : "rounded-[16px] rounded-tl-md border border-zk-border bg-zk-bg text-zk-text2"
                }`}
              >
                <span className="sr-only">{message.role === "user" ? "You: " : "Reply: "}</span>
                {message.text}
              </p>
            </li>
          ))}
          {pending ? (
            <li className="mr-auto">
              <p className="m-0 rounded-[16px] rounded-tl-md border border-zk-border bg-zk-bg px-3.5 py-2 text-[14px] text-zk-muted">Thinking…</p>
            </li>
          ) : null}
        </ol>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="flex items-end gap-2"
      >
        <label htmlFor={`site-chat-${checkId}`} className="sr-only">
          Ask about {site}
        </label>
        <textarea
          id={`site-chat-${checkId}`}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX}
          disabled={pending}
          placeholder={`Ask about ${site}`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="min-h-[40px] flex-1 resize-none rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-[14px] text-zk-text placeholder:text-zk-muted focus:border-electric-blue-strong/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          aria-label="Send"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-zk-text text-zk-surface transition disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </section>
  );
}
