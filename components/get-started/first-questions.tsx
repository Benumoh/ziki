"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { NeedPicker, needsFor, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/get-started/need-picker";
import { saveProductKindsAction } from "@/app/(app)/projects/actions";
import { PRODUCT_OTHER_MAX, readProductKinds, type ProductKind } from "@/lib/product-kinds";

/**
 * First questions (#first-questions): a few questions, one at a time, for the
 * organisation owner or an admin the first time they open a project that has
 * no ideas yet, such as right after creating an organisation. Shaped like
 * Pinterest's sign-up questions: one card over the dimmed app, a small progress
 * bar on top, one big question, and the button at the card's foot.
 *
 * 1. what you're building (#product-kinds): any of a website, a mobile app, a
 * desktop app and something else (in your own words: a game, an extension…), or not built yet;
 * saved on the project, 2. what you need help with (tap tiles, worded for what
 * you build), 3. "You're all set": how the work gets done here, naming what
 * they picked, and one button onto the dashboard. Nothing to type or choose:
 * the dashboard's own request box and "Who will work on your tasks?" take it
 * from there. It doesn't ask for links: the project header and Project
 * Settings set those. Finishing, skipping or × closes it for this project on this device.
 */

const DONE_KEY = "ziki.first-questions.v1.done";

type Props = {
  projectId: string;
  projectSlug: string;
  productKinds: readonly string[];
  productOther: string | null;
  /** Owners and admins: only they can save what the project is. */
  canEditProject: boolean;
  firstName: string | null;
};

type Step = "kind" | "needs" | "done";

/** "fix something broken and keep it safe": what they picked, as words for a sentence. */
function pickedWords(labels: string[]): string | null {
  const words = labels.map((label) => label.charAt(0).toLowerCase() + label.slice(1));
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** How work gets done on Ziki, in three short lines for the last screen. */
const HOW_IT_WORKS: { icon: string; title: string; text: string }[] = [
  { icon: "💬", title: "Say what you need", text: "A fix, a feature or a change, in plain words, in the box at the top of your dashboard." },
  { icon: "🤖", title: "AI agents do the work", text: "Your own agent, or agents on Ziki. They pick it up, build it and show you the result." },
  { icon: "✅", title: "You stay in charge", text: "Every change is tested and checked, and nothing goes live without your yes." },
];

/** Pick all that apply; "Not built yet" stands alone. */
const KINDS: { id: ProductKind; icon: string; label: string; hint: string }[] = [
  { id: "website", icon: "🌐", label: "A website", hint: "People visit it in a browser" },
  { id: "mobile", icon: "📱", label: "A mobile app", hint: "iPhone or Android" },
  { id: "desktop", icon: "💻", label: "A desktop app", hint: "Windows, Mac or Linux" },
  { id: "other", icon: "🧩", label: "Something else", hint: "A game, an extension, a bot…" },
  { id: "idea", icon: "💡", label: "Not built yet", hint: "I have an idea to start" },
];

function readDone(projectId: string): boolean {
  try {
    return (localStorage.getItem(DONE_KEY) ?? "").split(",").includes(projectId);
  } catch {
    return false;
  }
}

function markDone(projectId: string) {
  try {
    const ids = new Set((localStorage.getItem(DONE_KEY) ?? "").split(",").filter(Boolean));
    ids.add(projectId);
    localStorage.setItem(DONE_KEY, [...ids].join(","));
  } catch {
    // Private window: it may show again next time, which is harmless.
  }
}

const ICON_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-full text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

export function FirstQuestions({
  projectId,
  projectSlug,
  productKinds,
  productOther,
  canEditProject,
  firstName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // What the project already says it is, if it was asked before.
  const [kinds, setKinds] = useState<ProductKind[]>(() => readProductKinds(productKinds));
  const [other, setOther] = useState(productOther ?? "");
  const [kindError, setKindError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const steps: Step[] = ["kind", "needs", "done"];
  const step = steps[index];
  const greeting = firstName ? `Welcome, ${firstName}!` : "Welcome!";

  // Opens after mounting, since whether it was closed before lives in this browser.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(!readDone(projectId)));
    return () => cancelAnimationFrame(frame);
  }, [projectId]);

  // While open: no page scroll behind it, Escape closes it.
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  // Each screen's question takes focus, so screen readers say it.
  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
  }, [open, step]);

  function close() {
    markDone(projectId);
    setOpen(false);
  }

  function next() {
    if (index < steps.length - 1) setIndex(index + 1);
  }

  // Pick all that apply. "Not built yet" can't go with anything built, so each clears the other.
  function toggleKind(choice: ProductKind) {
    setKindError(null);
    setPicked([]); // The help tiles differ, so earlier picks no longer apply.
    setKinds((current) => {
      if (current.includes(choice)) return current.filter((kind) => kind !== choice);
      if (choice === "idea") return ["idea"];
      return [...current.filter((kind) => kind !== "idea"), choice];
    });
  }

  // Saved on the project (#product-kinds), which also renames an untouched "Web" project to fit.
  async function saveKinds() {
    if (kinds.length === 0) return;
    if (canEditProject) {
      setSaving(true);
      const result = await saveProductKindsAction(projectSlug, kinds, other);
      setSaving(false);
      if (result?.error) {
        setKindError(result.fieldErrors?.other ?? result.error);
        return;
      }
      if (result?.message) router.refresh();
    }
    next();
  }

  if (!open) return null;

  const needs = needsFor(kinds.length > 0 ? kinds : ["website"]);
  const pickedLine = pickedWords(needs.filter((need) => picked.includes(need.id)).map((need) => need.label));

  // A big question, left-aligned; a line break in the text starts its second line.
  const heading = (text: string) => (
    <h2
      id="first-questions-heading"
      ref={headingRef}
      tabIndex={-1}
      className="m-0 whitespace-pre-line text-[30px] font-extrabold leading-[1.12] tracking-tight text-zk-text outline-none sm:text-[38px]"
    >
      {text}
    </h2>
  );
  const lead = (text: string) => <p className="m-0 mt-3 text-base leading-relaxed text-zk-text2 sm:text-[17px]">{text}</p>;

  // On <body>, so nothing on the page (a transformed parent, a sticky bar) can clip or cover it.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:p-0"
      // The Ideas box closes itself on a click outside it; clicks in here are inside this screen.
      onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}
    >
      {/* The app stays in sight behind the card, dimmed. A click on it does nothing. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-questions-heading"
        className="relative flex max-h-[calc(100dvh-2rem)] min-h-[min(720px,calc(100dvh-2rem))] w-full max-w-[610px] flex-col overflow-hidden rounded-panel border border-zk-border bg-zk-surface shadow-xl max-sm:h-[100dvh] max-sm:max-h-none max-sm:min-h-0 max-sm:max-w-none max-sm:rounded-none"
      >
        <div className="relative flex h-16 shrink-0 items-center justify-center px-4">
          {index > 0 ? (
            <button type="button" onClick={() => setIndex(index - 1)} aria-label="Back" className={`${ICON_BUTTON} absolute left-3`}>
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
          {step === "kind" ? (
            <>
              {heading(`${greeting}\nWhat are you building?`)}
              {lead("Pick all that apply. Your answers help us ask the right things and find the right people to help.")}
              <ul className="mt-7 grid w-full list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
                {KINDS.map((option) => {
                  const on = kinds.includes(option.id);
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleKind(option.id)}
                        className={`relative flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-panel border-2 px-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
                          on ? "border-electric-blue bg-zk-tint" : "border-zk-border bg-zk-surface hover:border-zk-muted"
                        }`}
                      >
                        <span aria-hidden="true" className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full transition ${on ? "bg-electric-blue text-white" : "border-2 border-zk-border"}`}>
                          {on ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : null}
                        </span>
                        <span aria-hidden="true" className="text-3xl leading-none">{option.icon}</span>
                        <span className="text-[15px] font-bold leading-tight text-zk-text">{option.label}</span>
                        <span className="text-xs leading-snug text-zk-muted">{option.hint}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {kinds.includes("other") ? (
                <label htmlFor="first-questions-other" className="mt-4 flex cursor-text flex-col gap-1 rounded-2xl border-2 border-zk-border bg-zk-surface px-5 py-3 transition focus-within:border-electric-blue">
                  <span className="text-sm font-semibold text-zk-text">What is it?</span>
                  <input
                    id="first-questions-other"
                    value={other}
                    onChange={(event) => setOther(event.target.value)}
                    maxLength={PRODUCT_OTHER_MAX}
                    placeholder="e.g. a game, a Chrome extension, a Discord bot"
                    className="w-full bg-transparent text-lg text-zk-text outline-none placeholder:text-zk-muted"
                  />
                </label>
              ) : null}
              {kindError ? <p role="alert" className="m-0 mt-3 px-1 text-sm text-zk-bad-fg">{kindError}</p> : null}
              <div className="mt-auto flex w-full flex-col gap-2 pt-8">
                <button type="button" onClick={() => void saveKinds()} disabled={saving || kinds.length === 0} className={PRIMARY_BUTTON}>
                  {saving ? "Saving…" : kinds.length === 0 ? "Pick at least one" : "Continue"}
                </button>
                <button type="button" onClick={close} className={SECONDARY_BUTTON}>
                  I&apos;ll set this up later
                </button>
              </div>
            </>
          ) : null}

          {step === "needs" ? (
            <NeedPicker
              heading={heading("What do you need\nhelp with?")}
              needs={needs}
              picked={picked}
              onPickedChange={setPicked}
              onNext={next}
              onSkip={next}
            />
          ) : null}

          {step === "done" ? (
            <>
              {heading(firstName ? `You're all set,\n${firstName}! 🎉` : "You're all set! 🎉")}
              {lead(
                pickedLine
                  ? `Ziki is ready to help you ${pickedLine}. Here's how it works:`
                  : "Your project is ready. Here's how work gets done here:",
              )}
              <ol className="mt-7 flex w-full list-none flex-col gap-3 p-0">
                {HOW_IT_WORKS.map((point) => (
                  <li key={point.title} className="flex items-start gap-4 rounded-panel border border-zk-border bg-zk-surface px-5 py-4">
                    <span aria-hidden="true" className="text-2xl leading-none">{point.icon}</span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-bold leading-tight text-zk-text">{point.title}</span>
                      <span className="text-sm leading-snug text-zk-text2">{point.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto flex w-full flex-col pt-8">
                <button type="button" onClick={close} className={PRIMARY_BUTTON}>
                  Take me to my dashboard
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
