"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { askMarketingAssistantAction, saveMarketingSiteAction, type MarketingSiteResult } from "@/app/(app)/[org]/[project]/marketing/actions";
import { createBugAction } from "@/app/actions/issues";
import { MARKETING_ASSISTANT_MESSAGE_MAX, type MarketingAnswer, type MarketingDraft, type MarketingTurn } from "@/lib/marketing/assistant-shared";
import { RowAge } from "@/components/issue-row-meta";
import { Badge } from "@/components/ui/badge";
import { marketingPath, type ProjectRef } from "@/lib/project-paths";
import type { HomeTaskGroup, HomeTaskType, MarketingHomeData } from "./model";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue";
const field = "w-full rounded-xl border border-zk-border bg-zk-surface px-4 text-base text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue/20";
const primary = `inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;

/** Asks the sidebar's agent something: the card's suggestion buttons send through it. */
const ASK_EVENT = "ziki:marketing-ask";
function ask(text: string) {
  window.dispatchEvent(new CustomEvent<string>(ASK_EVENT, { detail: text }));
}

/**
 * The Marketing home (#marketing-agent-home): the organisation's marketing task
 * types across the top, the picked type's goal and work in the main card, and
 * the marketing agent in a sidebar on the right. A project without a website
 * first asks for it in the sidebar.
 */
export function MarketingHome({ slug, projectId, siteUrl, data }: { slug: ProjectRef; projectId: string; siteUrl: string | null; data: MarketingHomeData }) {
  const canAsk = Boolean(siteUrl);
  return (
    <div className="mx-auto grid w-full max-w-[1400px] items-start gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="marketing-home-title" className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 id="marketing-home-title" className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-zk-text">Marketing</h1>
            <p className="max-w-xl text-zk-muted">See what each kind of marketing work is for, follow its tasks, and ask the marketing agent for help.</p>
          </div>
          {/* The section header's Create video button, which the home page doesn't show. */}
          <Link href={marketingPath(slug, "video")} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-zk-tint px-4 text-sm font-bold text-zk-accent transition hover:opacity-90 ${focus}`}>
            <svg {...smallIcon}><rect x="2" y="5" width="14" height="14" rx="3" /><path d="m16 10 6-4v12l-6-4" /></svg>
            Create video
            <Badge className="rounded-full bg-zk-accent text-[10px] font-extrabold uppercase tracking-wide text-zk-surface">New</Badge>
          </Link>
        </header>
        {data.types.length === 0 ? (
          <div className="rounded-[20px] border border-zk-border bg-zk-surface px-4 py-12 text-center">
            <p className="font-bold text-zk-text">No marketing task types yet.</p>
            <p className="mt-1.5 text-sm text-zk-muted">An organisation owner or admin can add them in Marketing settings.</p>
          </div>
        ) : (
          <>
            <TypePills slug={slug} types={data.types} selected={data.selected} />
            {data.selected ? <TypeCard slug={slug} type={data.selected} groups={data.groups} canAsk={canAsk} /> : null}
          </>
        )}
      </section>
      <aside aria-label="Marketing agent" className="flex min-h-[420px] flex-col overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface lg:sticky lg:top-4 lg:h-[calc(100dvh-7rem)]">
        <div className="flex items-center justify-between gap-2 border-b border-zk-border px-4 py-3">
          <h2 className="text-sm font-extrabold text-zk-text">Marketing agent</h2>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {siteUrl ? <PromptStep slug={slug} projectId={projectId} siteUrl={siteUrl} /> : <SiteStep slug={slug} />}
        </div>
      </aside>
    </div>
  );
}

/** The task form, with the picked type already chosen. */
function newTaskHref(slug: ProjectRef, type: HomeTaskType | null): string {
  const href = marketingPath(slug, "tasks/new");
  return type ? `${href}?type=${encodeURIComponent(type.id)}` : href;
}

function TypePills({ slug, types, selected: picked }: { slug: ProjectRef; types: HomeTaskType[]; selected: HomeTaskType | null }) {
  const selectedId = picked?.id ?? null;
  return (
    <nav aria-label="Task types" className="flex flex-wrap gap-2">
      {types.map((type) => {
        const selected = type.id === selectedId;
        return (
          <Link
            key={type.id}
            href={`${marketingPath(slug)}?type=${encodeURIComponent(type.id)}`}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-sm font-bold transition ${focus} ${selected ? "border-transparent bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"}`}
          >
            {type.name}
            <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums ${selected ? "bg-zk-accent text-zk-surface" : "bg-zk-chip text-zk-text2"}`}>
              {type.count}
              <span className="sr-only">{type.count === 1 ? " task" : " tasks"}</span>
            </span>
          </Link>
        );
      })}
      {/* Last pill: create a task of the picked type by hand. */}
      <Link
        href={newTaskHref(slug, picked)}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white transition hover:opacity-90 ${focus}`}
      >
        <svg {...smallIcon}><path d="M12 5v14M5 12h14" /></svg>
        Create a task
      </Link>
    </nav>
  );
}

function TypeCard({ slug, type, groups, canAsk }: { slug: ProjectRef; type: HomeTaskType; groups: HomeTaskGroup[]; canAsk: boolean }) {
  const suggestions = [`Suggest new ${type.name.toLowerCase()} tasks`, `How are our ${type.name.toLowerCase()} tasks going?`];
  return (
    <article aria-labelledby="marketing-type-title" className="grid gap-6 rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <div className="space-y-5">
        <h2 id="marketing-type-title" className="text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-zk-text">{type.name}</h2>
        <section aria-labelledby="marketing-goal" className="space-y-2">
          <h3 id="marketing-goal" className="flex items-center gap-2 text-sm font-semibold text-zk-muted">
            <svg {...smallIcon}><path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5" /></svg>
            Goal
          </h3>
          <p className="text-sm leading-relaxed text-zk-text">{type.goal ?? "No goal set for this task type yet."}</p>
        </section>
        {canAsk ? (
          <section aria-labelledby="marketing-ask" className="space-y-2">
            <h3 id="marketing-ask" className="flex items-center gap-2 text-sm font-semibold text-zk-muted">
              <svg {...smallIcon}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              Ask the agent
            </h3>
            <div className="flex flex-col items-start gap-2">
              {suggestions.map((text) => (
                <button key={text} type="button" onClick={() => ask(text)} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border border-zk-border bg-zk-surface px-3 text-left text-sm font-semibold text-zk-text transition hover:bg-zk-chip ${focus}`}>
                  <svg {...smallIcon} className="h-4 w-4 shrink-0 text-zk-accent"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
                  {text}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <div className="min-w-0 space-y-6">
        {groups.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-zk-border px-4 py-10 text-center">
            <p className="font-bold text-zk-text">No {type.name.toLowerCase()} tasks yet.</p>
            <p className="mt-1 text-sm text-zk-muted">{canAsk ? "Create one, or ask the agent to suggest some." : "Create one to get started."}</p>
            <Link href={newTaskHref(slug, type)} className={`mt-3 rounded-sm text-sm font-semibold text-zk-accent hover:underline ${focus}`}>Create a {type.name.toLowerCase()} task</Link>
          </div>
        ) : groups.map((group) => (
          <section key={group.key} aria-labelledby={`marketing-group-${group.key}`} className="space-y-3">
            <h3 id={`marketing-group-${group.key}`} className="flex items-center gap-3 text-sm font-semibold text-zk-muted">
              <span aria-hidden="true" className="h-px flex-1 bg-zk-divider" />
              {group.heading}
              <span aria-hidden="true" className="h-px flex-1 bg-zk-divider" />
            </h3>
            <ul className="space-y-3">
              {group.items.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className={`block rounded-xl border-l-4 bg-zk-tint/50 px-4 py-3 transition hover:bg-zk-tint ${group.key === "done" ? "border-electric-blue" : "border-zk-border"} ${focus}`}>
                    <span className="block font-bold text-zk-text">{item.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zk-muted">
                      <span className="font-semibold text-zk-text2">{item.label}</span>
                      {item.agentName ? <span>{item.agentName}</span> : null}
                      <RowAge date={item.updatedAt} sort="updated" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {group.more > 0 ? <p className="text-sm text-zk-muted">And {group.more} more.</p> : null}
          </section>
        ))}
      </div>
    </article>
  );
}

const smallIcon = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, className: "h-4 w-4" } as const;

function SiteStep({ slug }: { slug: ProjectRef }) {
  const [result, action, pending] = useActionState<MarketingSiteResult | undefined, FormData>(saveMarketingSiteAction.bind(null, slug), undefined);
  const inputId = useId();
  const errorId = useId();
  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1.5">
        <h3 className="text-base font-extrabold text-zk-text">Which website should we market?</h3>
        <p className="text-sm text-zk-muted">Add your site&apos;s address so the agent knows what it is improving. You can change it later in Project settings.</p>
      </header>
      <form action={action} className="flex w-full flex-col gap-2 text-left">
        <label htmlFor={inputId} className="text-sm font-bold text-zk-text">Website address</label>
        <div className="flex flex-col gap-2">
          <input
            id={inputId}
            name="siteUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            required
            placeholder="https://yourproduct.com"
            aria-invalid={result?.error ? true : undefined}
            aria-describedby={result?.error ? errorId : undefined}
            className={`${field} min-h-11`}
          />
          <button type="submit" disabled={pending} className={primary}>
            {pending ? "Saving…" : "Continue"}
          </button>
        </div>
        {result?.error ? <p id={errorId} role="alert" className="text-sm text-zk-bad-fg">{result.error}</p> : null}
      </form>
    </div>
  );
}

/** A turn as the page shows it: an assistant reply also says what it looked at and what it drafted. */
type ChatTurn = MarketingTurn & { activity?: string[]; drafts?: MarketingDraft[] };

/** What the model reads back of a past reply: its text, and the tasks it drafted. */
function historyText(turn: ChatTurn): string {
  if (!turn.drafts?.length) return turn.text;
  return `${turn.text}\n\n(Drafted tasks shown to the person: ${turn.drafts.map((draft) => `"${draft.title}"`).join(", ")}.)`;
}

/** Everyone in the project talks to the agent, for now. */
function PromptStep({ slug, projectId, siteUrl }: { slug: ProjectRef; projectId: string; siteUrl: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const site = siteUrl.replace(/^https:\/\//, "").replace(/\/$/, "");
  const started = turns.length > 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns.length, pending]);

  // The card's suggestion buttons ask through here.
  const sendRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    const onAsk = (event: Event) => sendRef.current((event as CustomEvent<string>).detail);
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  function send(asked?: string) {
    const text = (asked ?? prompt).trim();
    if (!text || pending) return;
    const shown: ChatTurn[] = [...turns, { role: "user", text }];
    setTurns(shown);
    if (!asked) setPrompt("");
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
  sendRef.current = send;

  function startOver() {
    setTurns([]);
    setPrompt("");
    setError(null);
    inputRef.current?.focus();
  }

  const siteLink = (
    <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={`rounded-sm font-semibold text-zk-accent hover:underline ${focus}`}>
      {site}
    </a>
  );

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-3 text-sm">
        <p className="min-w-0 truncate text-zk-muted">Marketing {siteLink}</p>
        {started ? (
          <button type="button" onClick={startOver} disabled={pending} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold text-zk-text2 transition hover:bg-zk-chip disabled:opacity-50 ${focus}`}>
            New chat
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {started ? (
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
                        <DraftCard draft={draft} projectId={projectId} />
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
        ) : (
          <div className="flex h-full flex-col justify-center gap-1 text-center">
            <p className="font-bold text-zk-text">What marketing problem should we fix?</p>
            <p className="text-sm text-zk-muted">Ask about your marketing, or have the agent suggest tasks.</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="border-t border-zk-border p-3 text-left"
      >
        <label htmlFor={inputId} className="sr-only">{started ? "Reply to the agent" : "Ask the marketing agent"}</label>
        <div className="rounded-xl border border-zk-border bg-zk-surface focus-within:border-electric-blue focus-within:ring-2 focus-within:ring-electric-blue/20">
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
            rows={2}
            maxLength={MARKETING_ASSISTANT_MESSAGE_MAX}
            placeholder="Ask me anything"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            className="block w-full resize-none bg-transparent px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <p id={hintId} className="sr-only">Enter to send, Shift+Enter for a new line.</p>
            <span aria-hidden="true" />
            <button type="submit" disabled={pending || !prompt.trim()} className={`${primary} min-h-8 px-4 text-xs`}>
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
        {error ? <p id={errorId} role="alert" className="mt-2 text-sm text-zk-bad-fg">{error}</p> : null}
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
function DraftCard({ draft, projectId }: { draft: MarketingDraft; projectId: string }) {
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
