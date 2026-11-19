"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { askMarketingAssistantAction, saveMarketingSiteAction } from "@/app/(app)/[org]/marketing/actions";
import { createBugAction } from "@/app/actions/issues";
import { MARKETING_ASSISTANT_MESSAGE_MAX, type MarketingAnswer, type MarketingDraft, type MarketingTurn } from "@/lib/marketing/assistant-shared";
import { useChatAttachments } from "@/components/chat-attachments";
import type { ProjectRef } from "@/lib/project-paths";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";
const primary = `inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;

/**
 * The Marketing agent (#marketing-agent-home), a card of its own above the Marketing list: one chat box, the same as
 * Your App's. A project without a website asks for it in the box: the first message that holds an address saves it
 * (and goes on to the agent when it says more); then anyone in the project can ask the agent, which can draft tasks
 * to file.
 */
export function MarketingChat({ slug, projectId, siteUrl }: { slug: ProjectRef; projectId: string; siteUrl: string | null }) {
  return (
    // The same chat box as Your App's, on its own above the list: the box is the only frame.
    <section aria-labelledby="marketing-agent-title" className="mx-auto mb-4 w-full max-w-[920px]">
      <h2 id="marketing-agent-title" className="sr-only">Marketing agent</h2>
      <PromptStep slug={slug} projectId={projectId} siteUrl={siteUrl} />
    </section>
  );
}

const smallIcon = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, className: "h-4 w-4" } as const;

/** The first web address in a message ("https://acme.com", or a bare "acme.com"), or null. */
function addressIn(text: string): string | null {
  const full = text.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (full) return full.replace(/[.,;:!?)]+$/, "");
  const bare = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/i)?.[0];
  return bare ? `https://${bare.replace(/[.,;:!?)]+$/, "")}` : null;
}

/** A turn as the page shows it: an assistant reply also says what it looked at and what it drafted. */
type ChatTurn = MarketingTurn & { activity?: string[]; drafts?: MarketingDraft[]; attachmentIds?: string[] };

/** What the model reads back of a past reply: its text, and the tasks it drafted. */
function historyText(turn: ChatTurn): string {
  // The agent reads text only: it hears that files came with the message, which go on any task filed from here.
  if (turn.attachmentIds?.length) return `${turn.text}

(The person attached ${turn.attachmentIds.length} file${turn.attachmentIds.length === 1 ? "" : "s"}, such as screenshots. They go on any task filed from this conversation.)`;
  if (!turn.drafts?.length) return turn.text;
  return `${turn.text}\n\n(Drafted tasks shown to the person: ${turn.drafts.map((draft) => `"${draft.title}"`).join(", ")}.)`;
}

/** Everyone in the project talks to the agent, for now. */
function PromptStep({ slug, projectId, siteUrl }: { slug: ProjectRef; projectId: string; siteUrl: string | null }) {
  const router = useRouter();
  const files = useChatAttachments();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const site = siteUrl ? siteUrl.replace(/^https:\/\//, "").replace(/\/$/, "") : null;
  const started = turns.length > 0;
  // Everything attached in this conversation goes on the tasks filed from it.
  const attachmentIds = turns.flatMap((turn) => turn.attachmentIds ?? []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns.length, pending]);


  function send(asked?: string) {
    const text = (asked ?? prompt).trim();
    if (!text || pending || files.uploading) return;
    // No website yet: the first message names it. It is saved, then the rest of the message (if any) goes on.
    if (!siteUrl) {
      const address = addressIn(text);
      if (!address) {
        setError("First, paste your website's address, like https://yourproduct.com.");
        return;
      }
      setError(null);
      startTransition(async () => {
        const data = new FormData();
        data.set("siteUrl", address);
        const saved = await saveMarketingSiteAction(slug, undefined, data);
        if (saved.error) {
          setError(saved.error);
          return;
        }
        const rest = text.replace(/https?:\/\/[^\s<>"']+/i, "").replace(address.replace(/^https:\/\//, ""), "").trim();
        setPrompt(rest.length >= 10 ? rest : "");
        router.refresh();
      });
      return;
    }
    const shown: ChatTurn[] = [...turns, { role: "user", text, attachmentIds: files.ids }];
    setTurns(shown);
    if (!asked) setPrompt("");
    files.clear();
    setError(null);
    startTransition(async () => {
      let answer: MarketingAnswer;
      try {
        answer = await askMarketingAssistantAction(slug, shown.map((turn) => ({ role: turn.role, text: historyText(turn) })));
      } catch {
        answer = { ok: false, error: "The message couldn't be sent. Check your connection and try again." };
      }
      if (answer.ok) {
        setTurns([...shown, { role: "assistant", text: answer.reply, activity: answer.activity, drafts: answer.drafts }]);
      } else {
        // Put the message back so it can be sent again.
        setTurns(turns);
        setPrompt(text);
        setError(answer.error);
      }
      inputRef.current?.focus();
    });
  }

  function startOver() {
    setTurns([]);
    setPrompt("");
    setError(null);
    files.clear();
    inputRef.current?.focus();
  }

  const siteLink = siteUrl ? (
    <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={`rounded-sm font-semibold text-zk-accent hover:underline ${focus}`}>
      {site}
    </a>
  ) : null;

  return (
    <>
      {started ? (
        <div className="mb-4 max-h-[420px] overflow-y-auto px-1">
          <ol aria-label="Conversation" className="flex w-full flex-col gap-4 text-left text-sm">
            {turns.map((turn, index) => (
              <li key={index} className={turn.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-2"}>
                {turn.role === "assistant" && turn.activity?.length ? (
                  <ul aria-label="What the agent did" className="flex flex-col gap-1">
                    {turn.activity.map((item, step) => (
                      <li key={step} className="flex items-start gap-1.5 text-xs text-zk-muted">
                        <svg {...smallIcon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zk-accent"><path d="M20 6 9 17l-5-5" /></svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div
                  className={turn.role === "user"
                    ? "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-zk-tint px-3.5 py-2.5 text-zk-text"
                    : "max-w-full whitespace-pre-wrap break-words leading-relaxed text-zk-text"}
                >
                  <span className="sr-only">{turn.role === "user" ? "You: " : "Agent: "}</span>
                  {turn.text}
                </div>
                {turn.drafts?.length ? (
                  <ul aria-label="Drafted tasks" className="flex w-full flex-col gap-3">
                    {turn.drafts.map((draft, number) => (
                      <li key={number}>
                        <DraftCard draft={draft} projectId={projectId} attachmentIds={attachmentIds} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {pending ? (
              <li className="flex justify-start">
                <p role="status" className="text-zk-muted motion-safe:animate-pulse">Working on it…</p>
              </li>
            ) : null}
          </ol>
          <div ref={endRef} />
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="text-left"
      >
        <label htmlFor={inputId} className="sr-only">{started ? "Reply to the agent" : "Ask the marketing agent"}</label>
        <div className="rounded-[22px] border border-zk-border bg-zk-surface px-4 pb-2.5 pt-3 shadow-[0_2px_10px_rgba(0,0,0,0.06)] focus-within:border-electric-blue-strong/50">
          <textarea
            id={inputId}
            ref={inputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={MARKETING_ASSISTANT_MESSAGE_MAX}
            placeholder={siteUrl
              ? "Tell the marketing agent what you want: a page to improve, a post to write, a campaign to run…"
              : "Which website should we market? Paste its address, like https://yourproduct.com"}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            className="block max-h-[220px] min-h-[28px] w-full resize-none border-0 bg-transparent p-1 text-[15px] leading-6 text-zk-text placeholder:text-zk-muted focus:outline-none [field-sizing:content]"
          />
          {files.chips}
          {files.error ? <p role="alert" className="m-0 mt-1 px-1 text-xs text-zk-bad-fg">{files.error}</p> : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p id={hintId} className="sr-only">Enter to send, Shift+Enter for a new line.</p>
            {files.controls}
            <button type="submit" disabled={pending || files.uploading || !prompt.trim()} aria-label="Send" title="Send" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zk-text text-zk-surface transition disabled:opacity-30">
              {pending ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
            </button>
          </div>
        </div>
        {error ? <p id={errorId} role="alert" className="mt-2 px-1 text-sm text-zk-bad-fg">{error}</p> : null}
        {/* Under the box: the site the agent works on, and a fresh start once there is a conversation. */}
        <p className="m-0 mt-2 flex items-center gap-2 px-2 text-[12px] text-zk-muted">
          {siteLink ? <span className="min-w-0 truncate">Marketing {siteLink}</span> : null}
          {started ? (
            <button type="button" onClick={startOver} disabled={pending} className={`shrink-0 rounded-sm font-semibold text-zk-text2 hover:text-zk-text hover:underline disabled:opacity-40 ${focus}`}>
              New chat
            </button>
          ) : null}
        </p>
        {files.dialog}
      </form>
    </>
  );
}

type DraftState = { kind: "draft" } | { kind: "filing" } | { kind: "filed"; href: string } | { kind: "dismissed" } | { kind: "error"; message: string };

/**
 * A task the assistant drafted. Filing it goes through the same action as the
 * Propose a task form, as the person, so it becomes a marketing idea with all
 * the form's checks; dismissing it only hides it.
 */
function DraftCard({ draft, projectId, attachmentIds }: { draft: MarketingDraft; projectId: string; attachmentIds: string[] }) {
  const [state, setState] = useState<DraftState>({ kind: "draft" });
  const [open, setOpen] = useState(false);
  const titleId = useId();

  if (state.kind === "dismissed") {
    return (
      <p className="rounded-xl border border-dashed border-zk-border px-4 py-2 text-sm text-zk-muted">
        Dismissed &ldquo;{draft.title}&rdquo;.{" "}
        <button type="button" onClick={() => setState({ kind: "draft" })} className={`rounded-sm font-semibold text-zk-accent hover:underline ${focus}`}>Undo</button>
      </p>
    );
  }

  async function file() {
    setState({ kind: "filing" });
    const form = new FormData();
    form.set("track", "marketing");
    form.set("projectId", projectId);
    form.set("title", draft.title);
    form.set("typeId", draft.typeId);
    form.set("description", draft.description);
    form.set("rationale", draft.rationale);
    form.set("stay", "true");
    if (attachmentIds.length) form.set("attachmentIds", attachmentIds.join(","));
    try {
      const result = await createBugAction(form);
      if (result.href) setState({ kind: "filed", href: result.href });
      else setState({ kind: "error", message: result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "The task couldn't be filed." });
    } catch {
      setState({ kind: "error", message: "The task couldn't be filed. Check your connection and try again." });
    }
  }

  return (
    <article aria-labelledby={titleId} className="w-full rounded-2xl border border-zk-border bg-zk-surface p-4 text-left shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-zk-muted">Draft task · {draft.typeName}</p>
      <h3 id={titleId} className="mt-1 text-base font-extrabold text-zk-text">{draft.title}</h3>
      <p className="mt-1 text-sm text-zk-muted">{draft.rationale}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`mt-2 rounded-sm text-sm font-semibold text-zk-accent hover:underline ${focus}`}>
        {open ? "Hide details" : "Show details"}
      </button>
      {open ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zk-text">{draft.description}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state.kind === "filed" ? (
          <p role="status" className="text-sm font-semibold text-zk-text">
            Filed.{" "}
            <Link href={state.href} className={`rounded-sm text-zk-accent hover:underline ${focus}`}>Open the idea</Link>
          </p>
        ) : (
          <>
            <button type="button" onClick={file} disabled={state.kind === "filing"} className={`${primary} min-h-9 px-4`}>
              {state.kind === "filing" ? "Filing…" : "File it"}
            </button>
            <button type="button" onClick={() => setState({ kind: "dismissed" })} disabled={state.kind === "filing"} className={`min-h-9 rounded-full px-4 text-sm font-bold text-zk-muted transition hover:bg-zk-chip disabled:opacity-50 ${focus}`}>
              Dismiss
            </button>
          </>
        )}
      </div>
      {state.kind === "error" ? <p role="alert" className="mt-2 text-sm text-zk-bad-fg">{state.message}</p> : null}
    </article>
  );
}
