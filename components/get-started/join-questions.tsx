"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IdeaChat } from "@/components/idea-chat";
import { NeedPicker, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/get-started/need-picker";
import { saveJoinAnswersAction } from "@/app/actions/join-questions";
import { quickIdeaVerdictAction } from "@/app/actions/idea-verdicts";
import {
  JOIN_REASON_OPTIONS,
  STRENGTH_OPTIONS,
  WEEKLY_TIME_OPTIONS,
  type FirstThing,
  type JoinReason,
  type Strength,
  type WeeklyTime,
} from "@/lib/join-questions";

/**
 * Join questions (#join-questions): for someone who joins an organisation that
 * someone else set up (its owner and admins get First questions instead). The
 * questions are there to keep them: who they are here, what they're good at, how
 * much time they have, and then one real thing to do in the first minute, picked
 * from those answers (lib/join-first-thing.ts). Shaped like First questions: one
 * card over the dimmed app, a progress bar, one big question per screen.
 *
 * 1. why they joined, 2. what they're good at (skipped for "Just looking"),
 * 3. how much time they have, 4. their first thing: an idea to vote on there and
 * then, an issue to confirm or delivered work to judge, or a request of their own.
 * The answers are saved on their membership when they reach the first thing, or
 * when they close the card early, so it is asked once per organisation on any device.
 */

type Step = "reason" | "strengths" | "time" | "first";

type Props = {
  /** Whether to ask: read once, when it mounts (see `open`). */
  ask: boolean;
  organisationId: string;
  organisationName: string | null;
  firstName: string | null;
};

const ICON_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-full text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";
const TILE =
  "relative flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-panel border-2 px-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

const STARTERS = [
  { label: "Something is broken", text: "The ___ doesn't work when I ___." },
  { label: "Add something new", text: "I'd like to be able to ___." },
  { label: "Change how it looks", text: "Please change how the ___ looks." },
];

export function JoinQuestions({ ask, organisationId, organisationName, firstName }: Props) {
  const router = useRouter();
  // Latched when it mounts: once the answers are saved the layout passes ask={false}, but an open card stays until closed.
  const [open, setOpen] = useState(ask);
  // It draws on <body>, which exists only after mounting.
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<JoinReason | null>(null);
  const [strengths, setStrengths] = useState<Strength[]>([]);
  const [time, setTime] = useState<WeeklyTime | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstThing, setFirstThing] = useState<FirstThing | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<HTMLDivElement>(null);

  const steps: Step[] = reason === "looking" ? ["reason", "time", "first"] : ["reason", "strengths", "time", "first"];
  const index = Math.max(0, steps.indexOf(step));
  const place = organisationName ?? "the team";
  const greeting = firstName ? `Welcome to ${place}, ${firstName}!` : `Welcome to ${place}!`;

  function answers(timeAnswer: WeeklyTime | null = time) {
    return { organisationId, joinReason: reason, strengths, weeklyTime: timeAnswer };
  }

  // Closing early still saves what was answered, so it isn't asked again elsewhere.
  function close() {
    if (!saved) void saveJoinAnswersAction(answers()).catch(() => undefined);
    setOpen(false);
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open || !mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, saved, reason, strengths, time]);

  // Each screen's question takes focus, so screen readers say it.
  useEffect(() => {
    if (!open || !mounted) return;
    if (step === "first" && firstThing?.kind === "request" && !done) {
      const timer = setTimeout(() => requestRef.current?.querySelector("textarea")?.focus(), 200);
      return () => clearTimeout(timer);
    }
    headingRef.current?.focus();
  }, [open, mounted, step, firstThing, done]);

  function back() {
    if (index > 0 && step !== "first") setStep(steps[index - 1]);
  }

  async function finishQuestions(timeAnswer: WeeklyTime | null) {
    setTime(timeAnswer);
    setSaving(true);
    setError(null);
    const result = await saveJoinAnswersAction(answers(timeAnswer)).catch(() => ({ error: "Could not save that. Please try again." }));
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    setFirstThing(result.firstThing);
    setStep("first");
  }

  async function vote(opinion: "good" | "bad") {
    if (firstThing?.kind !== "idea") return;
    setVoting(true);
    setError(null);
    const result = await quickIdeaVerdictAction(firstThing.ideaId, opinion).catch(() => ({ error: "Could not save that. Please try again." }));
    setVoting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone(opinion === "good" ? "Nice, your vote counted. Enough good votes turn an idea into work." : "Thanks, your vote counted. It helps the team skip what isn't worth doing.");
  }

  function fill(text: string) {
    const box = requestRef.current?.querySelector("textarea");
    if (!box) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    const blank = text.indexOf("___");
    if (blank >= 0) box.setSelectionRange(blank, blank + 3);
  }

  if (!open || !mounted) return null;

  const heading = (text: string) => (
    <h2
      id="join-questions-heading"
      ref={headingRef}
      tabIndex={-1}
      className="m-0 whitespace-pre-line text-[30px] font-extrabold leading-[1.12] tracking-tight text-zk-text outline-none sm:text-[38px]"
    >
      {text}
    </h2>
  );
  const lead = (text: string) => <p className="m-0 mt-3 text-base leading-relaxed text-zk-text2 sm:text-[17px]">{text}</p>;
  const errorLine = error ? <p role="alert" className="m-0 mt-3 px-1 text-sm text-zk-bad-fg">{error}</p> : null;
  const check = (on: boolean) => (
    <span aria-hidden="true" className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full transition ${on ? "bg-electric-blue text-white" : "border-2 border-zk-border"}`}>
      {on ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : null}
    </span>
  );
  const inboxNote = (
    <p className="m-0 mt-6 rounded-panel bg-zk-tint px-4 py-3 text-sm leading-relaxed text-zk-text2">
      📬 When something you touched moves on, or someone answers you, it lands in your <strong className="text-zk-text">Inbox</strong> at the top of the page.
    </p>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:p-0" onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-questions-heading"
        className="relative flex max-h-[calc(100dvh-2rem)] min-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[610px] flex-col overflow-hidden rounded-panel border border-zk-border bg-zk-surface shadow-xl max-sm:h-[100dvh] max-sm:max-h-none max-sm:min-h-0 max-sm:max-w-none max-sm:rounded-none"
      >
        <div className="relative flex h-16 shrink-0 items-center justify-center px-4">
          {index > 0 && step !== "first" ? (
            <button type="button" onClick={back} aria-label="Back" className={`${ICON_BUTTON} absolute left-3`}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          ) : null}
          <div
            className="h-1.5 w-36 overflow-hidden rounded-sm bg-zk-chip"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
            aria-valuetext={`Step ${index + 1} of ${steps.length}`}
          >
            <div className="h-full rounded-sm bg-electric-blue transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
          <button type="button" onClick={close} aria-label="Close" className={`${ICON_BUTTON} absolute right-3`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-8 pt-8 sm:px-14 sm:pb-10 sm:pt-10">
          {step === "reason" ? (
            <>
              {heading(`${greeting}\nWhat brings you here?`)}
              {lead("So we show you the right things first. You can change your mind any time.")}
              <ul className="mt-7 grid w-full list-none grid-cols-2 gap-3 p-0">
                {JOIN_REASON_OPTIONS.map((option) => {
                  const on = reason === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setReason(option.id);
                          if (option.id === "looking") setStrengths([]);
                        }}
                        className={`${TILE} ${on ? "border-electric-blue bg-zk-tint" : "border-zk-border bg-zk-surface hover:border-zk-muted"}`}
                      >
                        {check(on)}
                        <span aria-hidden="true" className="text-3xl leading-none">{option.icon}</span>
                        <span className="text-[15px] font-bold leading-tight text-zk-text">{option.label}</span>
                        <span className="text-xs leading-snug text-zk-muted">{option.hint}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-auto flex w-full flex-col gap-2 pt-8">
                <button type="button" onClick={() => setStep(reason === "looking" ? "time" : "strengths")} disabled={!reason} className={PRIMARY_BUTTON}>
                  {reason ? "Continue" : "Pick one"}
                </button>
                <button type="button" onClick={close} className={SECONDARY_BUTTON}>
                  Skip for now
                </button>
              </div>
            </>
          ) : null}

          {step === "strengths" ? (
            <NeedPicker
              heading={heading("What are you\ngood at?")}
              needs={STRENGTH_OPTIONS.map((option) => ({ ...option, text: "" }))}
              picked={strengths}
              onPickedChange={(picked) => setStrengths(picked as Strength[])}
              onNext={() => setStep("time")}
              onSkip={() => {
                setStrengths([]);
                setStep("time");
              }}
            />
          ) : null}

          {step === "time" ? (
            <>
              {heading("How much time\ncan you give?")}
              {lead("No pressure: it only sets how often we bring things to you.")}
              <ul className="mt-7 flex w-full list-none flex-col gap-3 p-0">
                {WEEKLY_TIME_OPTIONS.map((option) => {
                  const on = time === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setTime(option.id)}
                        className={`relative flex min-h-16 w-full items-center gap-4 rounded-panel border-2 px-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
                          on ? "border-electric-blue bg-zk-tint" : "border-zk-border bg-zk-surface hover:border-zk-muted"
                        }`}
                      >
                        <span aria-hidden="true" className="text-2xl leading-none">{option.icon}</span>
                        <span className="flex flex-col">
                          <span className="text-[15px] font-bold leading-tight text-zk-text">{option.label}</span>
                          <span className="text-xs leading-snug text-zk-muted">{option.hint}</span>
                        </span>
                        {check(on)}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {errorLine}
              <div className="mt-auto flex w-full flex-col gap-2 pt-8">
                <button type="button" onClick={() => void finishQuestions(time)} disabled={!time || saving} className={PRIMARY_BUTTON}>
                  {saving ? "Saving…" : time ? "Continue" : "Pick one"}
                </button>
                <button type="button" onClick={() => void finishQuestions(null)} disabled={saving} className={SECONDARY_BUTTON}>
                  Not sure yet
                </button>
              </div>
            </>
          ) : null}

          {step === "first" ? (
            <>
              {done ? (
                <>
                  {heading("That counted 🎉")}
                  {lead(done)}
                </>
              ) : firstThing?.kind === "idea" ? (
                <>
                  {heading("Here's your\nfirst thing")}
                  {lead("A teammate suggested this. Is it a good idea?")}
                  <div className="mt-6 rounded-panel border border-zk-border bg-zk-surface p-5">
                    <p className="m-0 text-xs font-semibold uppercase tracking-wide text-zk-muted">Idea #{firstThing.number}</p>
                    <p className="m-0 mt-1 text-lg font-bold leading-snug text-zk-text">{firstThing.title}</p>
                    {firstThing.summary ? <p className="m-0 mt-2 whitespace-pre-line text-sm leading-relaxed text-zk-text2">{firstThing.summary}</p> : null}
                    <Link href={firstThing.href} onClick={close} className="mt-3 inline-block text-sm font-semibold text-zk-accent hover:underline">
                      Read all of it
                    </Link>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button type="button" disabled={voting} onClick={() => void vote("good")} className={PRIMARY_BUTTON}>
                      👍 Good idea
                    </button>
                    <button
                      type="button"
                      disabled={voting}
                      onClick={() => void vote("bad")}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-control border-2 border-zk-border px-6 text-base font-bold text-zk-text transition hover:border-zk-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue disabled:opacity-40"
                    >
                      👎 Not really
                    </button>
                  </div>
                </>
              ) : firstThing?.kind === "confirm" || firstThing?.kind === "judge" ? (
                <>
                  {heading("Here's your\nfirst thing")}
                  {lead(
                    firstThing.kind === "confirm"
                      ? "Someone reported this. Can you see the problem too? Confirm it with what you saw."
                      : "This work was just delivered. Try it and say whether it's good to merge.",
                  )}
                  <div className="mt-6 rounded-panel border border-zk-border bg-zk-surface p-5">
                    <p className="m-0 text-xs font-semibold uppercase tracking-wide text-zk-muted">Issue #{firstThing.number}</p>
                    <p className="m-0 mt-1 text-lg font-bold leading-snug text-zk-text">{firstThing.title}</p>
                  </div>
                  <Link href={firstThing.href} onClick={close} className={`${PRIMARY_BUTTON} mt-4`}>
                    {firstThing.kind === "confirm" ? "Open it and confirm" : "Open it and judge"}
                  </Link>
                </>
              ) : firstThing?.kind === "request" ? (
                <>
                  {heading("Tell us one thing\nyou want")}
                  {lead("Use your own words. Tap a start below, then fill in the blank.")}
                  <div className="mt-6 flex flex-wrap gap-2">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter.label}
                        type="button"
                        onClick={() => fill(starter.text)}
                        className="inline-flex min-h-10 items-center rounded-chip border border-zk-border bg-zk-surface px-4 text-sm font-semibold text-zk-text transition hover:border-electric-blue hover:bg-zk-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
                      >
                        {starter.label}
                      </button>
                    ))}
                  </div>
                  <div ref={requestRef} className="mt-4 w-full">
                    <IdeaChat
                      projectId={firstThing.projectId}
                      alwaysOpen
                      placeholder="For example: I can't find where to change my password."
                      onSent={() => {
                        setDone("Sent! It starts as an idea: your teammates and their agents vote on it, and good ones become work.");
                        router.refresh();
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  {heading("You're all set")}
                  {lead("There's nothing waiting for you right now. Look around: anything you open, you can help along.")}
                </>
              )}
              {errorLine}
              {inboxNote}
              <div className="mt-auto flex w-full flex-col pt-8">
                <button type="button" onClick={close} className={done || !firstThing ? PRIMARY_BUTTON : SECONDARY_BUTTON}>
                  {done || !firstThing ? "Done" : "I'll do this later"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
