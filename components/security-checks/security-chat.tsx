"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSecurityAsset, talkToSecurityAssistant } from "@/app/actions/security-assistant";
import { TARGET_KIND_LABEL } from "@/lib/security-checks";
import { ClaudeWorking } from "@/components/claude-working";
import { parseSecurityTarget, PRIVATE_TARGET_ERROR } from "@/lib/security-checks/target";
import type { AssistantTurn } from "@/lib/security-checks/assistant";
import type { PreviewSummary } from "@/lib/security-checks/preview-summary";
import { PreviewResult } from "./preview-result";

const MESSAGE_MAX = 600;

/** What Ziki is doing while it answers, typed out like the Ideas chat. */
const WORKING_STEPS = [
  "Reading what you wrote…",
  "Working out what you want to secure…",
  "Checking it's a website, server or repo…",
  "Writing back…",
];

/** While Dave's quick scan looks at a site (#security-checks): the areas it checks. */
const SCAN_STEPS = [
  "Checking HTTPS and the certificate…",
  "Reading the security headers…",
  "Looking at the cookies…",
  "Checking the email settings…",
];

/**
 * The conversation, kept while the client moves around Security (Assets, Your
 * work and back), so nothing typed or said is lost. It lives only in this
 * browser tab's memory: a refresh starts afresh, and so does "Show it's yours".
 */
const kept: { turns: ChatItem[]; text: string } = { turns: [], text: "" };

/** A message in the chat; Ziki's can carry a quick scan of the site. */
type ChatItem = AssistantTurn & { scan?: { target: string; summary: PreviewSummary | null; note: string | null; canAdd: boolean } };

/**
 * The box on Security, with Ziki's AI behind it (#security-checks, plan part
 * C3). It looks like the Ideas box. Paste a link and it goes straight on;
 * type anything else ("I want to secure my shop's website") and Ziki answers,
 * asks for what's missing, and once the site is clear leads on to "Show it's
 * yours". It only talks about checking a site with Ziki, and creates nothing
 * else.
 */
export function SecurityChat({
  id = "security-chat",
  focusOnOpen = false,
  startWith,
}: {
  id?: string;
  focusOnOpen?: boolean;
  /** An address brought from the public page after sign-up: sent once, so its quick scan starts on arrival. */
  startWith?: string;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<ChatItem[]>(() => kept.turns);
  const [adding, setAdding] = useState<string | null>(null);
  const [text, setText] = useState(() => kept.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const value = text.trim();
  const parsed = value ? parseSecurityTarget(value) : null;
  const target = parsed?.ok ? parsed.target : null;
  const isPrivate = parsed !== null && !parsed.ok && parsed.error === PRIVATE_TARGET_ERROR;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (focusOnOpen) box.current?.focus();
  }, [focusOnOpen]);
  // Keep the conversation for when the client comes back to it.
  useEffect(() => {
    kept.turns = turns;
    kept.text = text;
  }, [turns, text]);
  // Keep the newest message in view.
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns, pending]);
  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function send() {
    sendText(value);
  }

  function sendText(raw: string) {
    const words = raw.trim();
    if (!words || pending) return;
    const next: ChatItem[] = [...turns, { role: "user", text: words.slice(0, MESSAGE_MAX) }];
    setTurns(next);
    setText("");
    setError(null);
    startTransition(async () => {
      try {
        // Only the words go to the server, never a scan card.
        const answer = await talkToSecurityAssistant(next.map(({ role, text }) => ({ role, text })));
        if (answer.kind === "error") {
          setError(answer.error);
          return;
        }
        if (answer.kind === "scan") {
          setTurns([...next, { role: "assistant", text: answer.reply, scan: { target: answer.target, summary: answer.summary, note: answer.note, canAdd: answer.canAdd } }]);
          return;
        }
        if (answer.kind === "go") {
          kept.turns = [];
          kept.text = "";
          router.push(answer.href);
          return;
        }
        setTurns([...next, { role: "assistant", text: answer.reply }]);
      } catch {
        setError("Ziki couldn't answer just now. Try again.");
      }
    });
  }

  // "Show it's yours" under a scan: only now is the asset added, then on to prove it.
  function showItsYours(site: string) {
    if (adding) return;
    setAdding(site);
    setError(null);
    startTransition(async () => {
      try {
        const answer = await addSecurityAsset(site);
        if (answer.kind === "go") {
          // On to Show it's yours: this conversation is done.
          kept.turns = [];
          kept.text = "";
          router.push(answer.href);
          return;
        }
        if (answer.kind === "error") setError(answer.error);
        else setTurns((current) => [...current, { role: "assistant", text: answer.reply }]);
        setAdding(null);
      } catch {
        setError("Ziki couldn't add it just now. Try again.");
        setAdding(null);
      }
    });
  }
  // Brought an address from the public page: send it once, as if typed.
  const started = useRef(false);
  useEffect(() => {
    if (!startWith || started.current) return;
    started.current = true;
    sendText(startWith);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
  const lastTarget = lastUser ? parseSecurityTarget(lastUser) : null;
  const scanning = pending && !adding && lastTarget?.ok === true;

  return (
    <div className="flex flex-col gap-3">
      {turns.length ? (
        <ol ref={log} aria-label="Conversation with Ziki" aria-live="polite" className="m-0 flex max-h-[34rem] list-none flex-col gap-2.5 overflow-y-auto p-0">
          {turns.map((turn, index) => (
            <li key={index} className={turn.role === "user" ? "ml-auto max-w-[85%]" : `mr-auto flex items-start gap-2 ${turn.scan ? "w-full max-w-[95%]" : "max-w-[90%]"}`}>
              {turn.role === "user" ? (
                <p className="m-0 whitespace-pre-wrap break-words rounded-[18px] rounded-br-md bg-electric-blue-strong px-4 py-2 text-[15px] text-white">
                  <span className="sr-only">You: </span>
                  {turn.text}
                </p>
              ) : (
                <>
                  <span aria-hidden="true" className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zk-text text-[11px] font-extrabold text-zk-surface">Z</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {turn.text ? (
                      <p className="m-0 w-fit whitespace-pre-wrap break-words rounded-[18px] rounded-tl-md border border-zk-border bg-zk-surface px-4 py-2 text-[15px] text-zk-text2">
                        <span className="sr-only">Ziki: </span>
                        {turn.text}
                      </p>
                    ) : null}
                    {turn.scan ? <ScanCard scan={turn.scan} adding={adding === turn.scan.target} onShow={() => showItsYours(turn.scan!.target)} /> : null}
                  </div>
                </>
              )}
            </li>
          ))}
          {pending ? (
            // The same "Claude is working" lines as the Ideas chat, for this job.
            <li className="mr-auto w-full max-w-[90%]">
              {scanning ? (
                <ClaudeWorking steps={SCAN_STEPS} statusText={`Ziki is scanning ${lastTarget.ok ? lastTarget.target.value : "the site"}.`} />
              ) : (
                <ClaudeWorking steps={WORKING_STEPS} statusText="Ziki is reading your message." />
              )}
            </li>
          ) : null}
        </ol>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        noValidate
      >
        <div className="rounded-[22px] border border-zk-border bg-zk-surface px-4 pb-2.5 pt-3 shadow-[0_2px_10px_rgba(0,0,0,0.06)] focus-within:border-electric-blue-strong/50">
          <label htmlFor={id} className="sr-only">What do you want to secure?</label>
          <textarea
            id={id}
            ref={box}
            name="target"
            rows={1}
            value={text}
            disabled={pending}
            maxLength={MESSAGE_MAX}
            placeholder={turns.length ? "Reply to Ziki" : "Tell Ziki what you want to secure"}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : `${id}-reading`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            className="block min-h-[28px] w-full resize-none border-0 bg-transparent p-1 text-[15px] leading-6 text-zk-text placeholder:text-zk-muted focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p id={`${id}-reading`} aria-live="polite" className="m-0 min-w-0 truncate px-1 text-[13px] text-zk-muted">
              {target ? (
                <span className="inline-flex items-center gap-1.5 text-zk-ok-fg">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {TARGET_KIND_LABEL[target.kind]}: <span className="font-semibold">{target.value}</span>
                </span>
              ) : isPrivate ? (
                <span className="text-zk-bad-fg">That&apos;s a private address</span>
              ) : null}
            </p>
            <button
              type="submit"
              disabled={pending || !value}
              aria-label="Send"
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
        </div>
        {error ? <p id={errorId} role="alert" className="m-0 mt-2 px-2 text-sm text-zk-bad-fg">{error}</p> : null}
      </form>
    </div>
  );
}

/** The quick scan in the chat, then the one next step: show it's yours. */
function ScanCard({ scan, adding, onShow }: { scan: NonNullable<ChatItem["scan"]>; adding: boolean; onShow: () => void }) {
  const next = (
    <div className="flex flex-wrap items-center gap-3 border-t border-zk-divider pt-3">
      <p className="m-0 min-w-[12rem] flex-1 text-[13px] leading-snug text-zk-muted">
        A quick scan only sees what a browser sees. Show {scan.target} is yours to see every problem and have agents check it properly.
      </p>
      <button
        type="button"
        onClick={onShow}
        disabled={adding}
        className="inline-flex h-10 shrink-0 items-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {adding ? "Adding…" : "Show it\u2019s yours"}
      </button>
    </div>
  );
  if (scan.summary) return <PreviewResult summary={scan.summary}>{next}</PreviewResult>;
  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl border border-zk-border bg-zk-surface p-4 text-left">
      <p className="m-0 text-sm leading-relaxed text-zk-text2">{scan.note ?? "The quick scan couldn't run just now."}</p>
      {/* A site the scan couldn't reach has nothing to secure yet, so no Show it's yours. */}
      {scan.canAdd ? next : null}
    </div>
  );
}
