"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IdeaChat } from "@/components/idea-chat";
import { ZikiMark } from "@/components/ziki-mark";
import { saveProjectLinksAction } from "@/app/(app)/projects/actions";

/**
 * First questions: a few full-screen questions, one at a time, the first time
 * someone opens a project that has no ideas yet (Pinterest-style sign-up
 * questions). 1. your website, 2. what you need help with (tap tiles),
 * 3. your first request, sent through the normal Ideas box. Skip or × closes it
 * for this project on this device; sending the request ends it because the
 * project then has an idea.
 */

const DONE_KEY = "ziki.first-questions.v1.done";

type Need = { id: string; icon: string; label: string; text: string };

const NEEDS: Need[] = [
  { id: "fix", icon: "🔧", label: "Fix something broken", text: "On my website, the ___ doesn't work." },
  { id: "new", icon: "✨", label: "Add something new", text: "I'd like my customers to be able to ___." },
  { id: "look", icon: "🎨", label: "Change how it looks", text: "Please change how the ___ looks on my website." },
  { id: "customers", icon: "📣", label: "Get more customers", text: "Help more people find my website when they search for ___." },
  { id: "safe", icon: "🔒", label: "Keep it safe", text: "Please check my website is safe, especially the ___." },
  { id: "fast", icon: "⚡", label: "Make it faster", text: "The ___ page on my website is slow to load." },
];

type Props = {
  projectId: string;
  projectSlug: string;
  siteUrl: string | null;
  repoUrl: string | null;
  canEditLinks: boolean;
  firstName: string | null;
};

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

const PRIMARY =
  "inline-flex min-h-12 w-full items-center justify-center rounded-full bg-electric-blue px-6 text-base font-bold text-white transition hover:bg-electric-blue-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full px-6 text-sm font-semibold text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";
const ICON_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-full text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

export function FirstQuestions({ projectId, projectSlug, siteUrl, repoUrl, canEditLinks, firstName }: Props) {
  const router = useRouter();
  const steps = canEditLinks ? (["site", "needs", "request"] as const) : (["needs", "request"] as const);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [site, setSite] = useState(siteUrl ?? "");
  const [siteError, setSiteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<HTMLDivElement>(null);
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

  // Each screen's question takes focus, so screen readers say it; the last one starts in the box.
  useEffect(() => {
    if (!open) return;
    if (step === "request") {
      const timer = setTimeout(() => requestRef.current?.querySelector("textarea")?.focus(), 200);
      return () => clearTimeout(timer);
    }
    headingRef.current?.focus();
  }, [open, step]);

  function close() {
    markDone(projectId);
    setOpen(false);
  }

  function next() {
    if (index < steps.length - 1) setIndex(index + 1);
  }

  async function saveSite() {
    if (!site.trim()) return next();
    setSaving(true);
    setSiteError(null);
    const form = new FormData();
    form.set("slug", projectSlug);
    form.set("siteUrl", site.trim());
    form.set("repoUrl", repoUrl ?? "");
    const result = await saveProjectLinksAction(undefined, form);
    setSaving(false);
    if (result?.error) {
      setSiteError(result.error);
      return;
    }
    router.refresh();
    next();
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

  if (!open) return null;

  const pickedNeeds = NEEDS.filter((need) => picked.includes(need.id));
  const starters = pickedNeeds.length > 0 ? pickedNeeds : NEEDS.slice(0, 3);

  const heading = (text: string) => (
    <h2 id="first-questions-heading" ref={headingRef} tabIndex={-1} className="m-0 text-balance text-3xl font-extrabold tracking-tight text-zk-text outline-none sm:text-4xl">
      {text}
    </h2>
  );
  const lead = (text: string) => <p className="m-0 mt-3 text-balance text-base text-zk-text2">{text}</p>;

  // On <body>, so nothing on the page (a transformed parent, a sticky bar) can clip or cover it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-questions-heading"
      className="fixed inset-0 z-[100] flex flex-col bg-zk-surface"
      // The Ideas box closes itself on a click outside it; clicks in here are inside this screen.
      onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}
    >
      <header className="shrink-0">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-8">
          <ZikiMark className="h-7 w-auto text-zk-text" title="Ziki" />
          <p className="m-0 text-sm font-semibold text-zk-muted">Step {index + 1} of {steps.length}</p>
          <button type="button" onClick={close} aria-label="Close" className={ICON_BUTTON}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="h-1 w-full bg-zk-chip" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}>
          <div className="h-full bg-electric-blue transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
      </header>

      <main className="flex flex-1 overflow-y-auto">
        <div className={`m-auto flex w-full flex-col items-center px-4 py-10 text-center sm:px-8 ${step === "needs" ? "max-w-2xl" : "max-w-xl"}`}>
          {step === "site" ? (
            <>
              {heading(`${greeting} What's your website?`)}
              {lead("So the people who help you can see your site and understand what you mean.")}
              <form
                className="mt-8 flex w-full max-w-md flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSite();
                }}
              >
                <label className="sr-only" htmlFor="first-questions-site">Website address</label>
                <input
                  id="first-questions-site"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                  placeholder="https://yourwebsite.com"
                  aria-invalid={siteError ? true : undefined}
                  aria-describedby={siteError ? "first-questions-site-error" : undefined}
                  className="min-h-14 w-full rounded-2xl border-2 border-zk-border bg-zk-surface px-5 text-center text-lg text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none"
                />
                {siteError ? <p id="first-questions-site-error" role="alert" className="m-0 text-sm text-zk-bad-fg">{siteError}</p> : null}
                <button type="submit" disabled={saving || !site.trim()} className={PRIMARY}>
                  {saving ? "Saving…" : "Next"}
                </button>
                <button type="button" onClick={next} className={SECONDARY}>
                  I don&apos;t have one yet
                </button>
              </form>
            </>
          ) : null}

          {step === "needs" ? (
            <>
              {heading(canEditLinks ? "What do you need help with?" : `${greeting} What do you need help with?`)}
              {lead("Pick as many as you like.")}
              <ul className="mt-8 grid w-full list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 sm:gap-4">
                {NEEDS.map((need) => {
                  const on = picked.includes(need.id);
                  return (
                    <li key={need.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked(on ? picked.filter((id) => id !== need.id) : [...picked, need.id])}
                        className={`relative flex h-32 w-full flex-col items-center justify-center gap-2.5 rounded-3xl border-2 px-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 sm:h-36 ${
                          on ? "border-electric-blue bg-zk-tint" : "border-zk-border bg-zk-surface hover:border-zk-muted"
                        }`}
                      >
                        <span aria-hidden="true" className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full transition ${on ? "bg-electric-blue text-white" : "border-2 border-zk-border"}`}>
                          {on ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : null}
                        </span>
                        <span aria-hidden="true" className="text-4xl leading-none">{need.icon}</span>
                        <span className="text-[15px] font-bold leading-tight text-zk-text">{need.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 flex w-full max-w-md flex-col gap-3">
                <button type="button" onClick={next} disabled={picked.length === 0} className={PRIMARY}>
                  {picked.length === 0 ? "Pick at least one" : `Next (${picked.length} picked)`}
                </button>
                <button type="button" onClick={next} className={SECONDARY}>
                  Not sure yet
                </button>
              </div>
            </>
          ) : null}

          {step === "request" ? (
            <>
              {heading("Tell us one thing you want")}
              {lead("Use your own words. Tap a start below, then fill in the blank.")}
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {starters.map((need) => (
                  <button
                    key={need.id}
                    type="button"
                    onClick={() => fill(need.text)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-semibold text-zk-text transition hover:border-electric-blue hover:bg-zk-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
                  >
                    <span aria-hidden="true">{need.icon}</span>
                    {need.label}
                  </button>
                ))}
              </div>
              <div ref={requestRef} className="mt-4 w-full text-left">
                <IdeaChat projectId={projectId} alwaysOpen placeholder="For example: The contact form on my website doesn't send me an email." />
              </div>
              <p className="m-0 mt-3 text-sm text-zk-muted">Press Enter or the round arrow to send it. Nothing changes on your site without your OK.</p>
              <div className="mt-6 flex w-full max-w-md flex-col">
                <button type="button" onClick={close} className={SECONDARY}>
                  I&apos;ll do this later
                </button>
              </div>
            </>
          ) : null}
        </div>
      </main>

      {index > 0 ? (
        <footer className="shrink-0 border-t border-zk-divider">
          <div className="mx-auto flex h-16 w-full max-w-5xl items-center px-4 sm:px-8">
            <button type="button" onClick={() => setIndex(index - 1)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
          </div>
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}
