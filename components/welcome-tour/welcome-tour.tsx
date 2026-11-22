"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The member tour (#member-tour): a short welcome for someone who joined an
 * organisation that its owner or an admin already set up (they get First
 * questions instead). It shows how work gets done there: send a request, what
 * happens to it, how to help an issue along, and where replies arrive.
 *
 * It dims the page and lights up the real parts, which stay as they are; the
 * request box stays usable, with starters that fill in a sentence to finish.
 * When the request is sent (the app opens the new idea), it carries on with
 * what happens next. It adds nothing to the page and changes nothing under it.
 *
 * It opens once per person per organisation, on the first project page that
 * has the request box. Finishing or skipping remembers that in this browser.
 * Adding `?tour=1` to the address shows it again.
 */

const DONE_KEY = "ziki.member-tour.v1.done";
const REQUEST_BOX = '[aria-label="Add an idea"]';
const ADD_IDEA_BUTTON = 'button[title="Add Idea"]';

type StepId = "welcome" | "request" | "next" | "issues" | "inbox";

type Step = {
  id: StepId;
  /** Where on the page this step points. Null: a centred card with no spotlight. */
  target: string | null;
  /** The lit part stays usable (typing and sending), the rest of the page stays blocked. */
  interactive?: boolean;
  /** Shown as a centred card when its part isn't on this page, instead of being skipped. */
  centredIfMissing?: boolean;
};

const STEPS: Step[] = [
  { id: "welcome", target: null },
  { id: "request", target: REQUEST_BOX, interactive: true },
  { id: "next", target: null },
  // The stage tabs (New, In Progress, Delivered): not on an idea's own page, so it is a centred card there.
  { id: "issues", target: 'nav[aria-label="Stages"]', centredIfMissing: true },
  { id: "inbox", target: 'header a[href="/inbox"]' },
];

/** Sentences to finish, one blank each. The ___ is selected, so typing replaces it. */
const STARTERS = [
  { label: "Something is broken", text: "The ___ doesn't work when I ___." },
  { label: "Add something new", text: "I'd like people to be able to ___." },
  { label: "Change how it looks", text: "Please change how the ___ looks." },
];

type Rect = { top: number; left: number; width: number; height: number };

/** Who has seen it where: `<user id>:<organisation id>` entries, newest last, capped. */
function readDone(entry: string): boolean {
  try {
    return (window.localStorage.getItem(DONE_KEY) ?? "").split(",").includes(entry);
  } catch {
    return false;
  }
}

function writeDone(entry: string) {
  try {
    const entries = (window.localStorage.getItem(DONE_KEY) ?? "").split(",").filter((value) => value && value !== entry);
    entries.push(entry);
    window.localStorage.setItem(DONE_KEY, entries.slice(-50).join(","));
  } catch {
    // Private windows may refuse storage; the tour then shows again next visit, which is harmless.
  }
}

/** A page with somewhere to send a request: the box itself, or the button that opens it. */
function hasRequestBox(): boolean {
  return Boolean(document.querySelector(REQUEST_BOX) || document.querySelector(ADD_IDEA_BUTTON));
}

/** The element a step lights up, when it is on the screen and visible. */
function findTarget(step: Step): Element | null {
  if (!step.target) return null;
  const el = document.querySelector(step.target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return null;
  return el;
}

function requestTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`${REQUEST_BOX} textarea`);
}

/** Puts a starter in the request box the way typing would, so the box's own state sees it. */
function fillStarter(text: string) {
  const box = requestTextarea();
  if (!box) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  const blank = text.indexOf("___");
  if (blank >= 0) box.setSelectionRange(blank, blank + 3);
}

const PAD = 8;
const GAP = 14;
const EDGE = 16;
const DIM = "color-mix(in srgb, var(--zk-ink) 60%, transparent)";

const primary =
  "inline-flex min-h-9 items-center rounded-control bg-electric-blue-strong px-5 text-sm font-bold text-white hover:bg-zk-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";
const quiet =
  "inline-flex min-h-9 items-center rounded-control px-4 text-sm font-semibold text-zk-text2 hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

type Props = {
  userId: string;
  organisationId: string;
  organisationName: string | null;
  firstName: string | null;
};

export function WelcomeTour({ userId, organisationId, organisationName, firstName }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forced = searchParams.get("tour") === "1";
  const doneEntry = `${userId}:${organisationId}`;

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ width: 400, height: 260 });
  const [seenPath, setSeenPath] = useState(pathname);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = STEPS[index];

  // Sending the request opens the new idea, a new address. The tour lives in the
  // layout, so it is still here: carry on with what happens next.
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (open && step.id === "request") {
      setSent(true);
      setRect(null);
      setIndex(STEPS.findIndex((s) => s.id === "next"));
    }
  }

  // Open once per organisation, on a page with the request box, after the page has drawn so the parts exist.
  useEffect(() => {
    if (open) return;
    if (!forced && readDone(doneEntry)) return;
    const timer = window.setTimeout(() => {
      if (!hasRequestBox()) return;
      setIndex(0);
      setSent(false);
      setOpen(true);
    }, 600);
    return () => window.clearTimeout(timer);
    // Checked again on each page until a page with the box opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, forced, doneEntry]);

  const close = useCallback(() => {
    writeDone(doneEntry);
    setOpen(false);
    setRect(null);
  }, [doneEntry]);

  /** Moves by `dir`, skipping a step whose part isn't on the screen. */
  const go = useCallback((from: number, dir: 1 | -1) => {
    let next = from + dir;
    // A project that already has ideas keeps the request box behind "Add Idea": open it.
    if (STEPS[next]?.id === "request" && !findTarget(STEPS[next])) {
      document.querySelector<HTMLButtonElement>('button[title="Add Idea"][aria-expanded="false"]')?.click();
    }
    while (next > 0 && next < STEPS.length - 1 && STEPS[next].target && !findTarget(STEPS[next]) && STEPS[next].id !== "request" && !STEPS[next].centredIfMissing) next += dir;
    if (next < 0 || next >= STEPS.length) return;
    setRect(null);
    setIndex(next);
  }, []);

  // Bring the step's part into view, then follow it while the page moves.
  useEffect(() => {
    if (!open || !step.target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scrolled = false;
    let frame = 0;
    let last = "";
    // Follows the part every frame; it may appear a moment late (the request box opening).
    const track = () => {
      const now = findTarget(step);
      if (now) {
        if (!scrolled) {
          scrolled = true;
          now.scrollIntoView({ block: "center", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
        }
        const r = now.getBoundingClientRect();
        const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
        if (key !== last) {
          last = key;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      }
      frame = window.requestAnimationFrame(track);
    };
    frame = window.requestAnimationFrame(track);
    return () => window.cancelAnimationFrame(frame);
  }, [open, step]);

  // Measure the card so it can sit beside the spotlight without leaving the screen.
  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    if (Math.abs(r.width - cardSize.width) > 1 || Math.abs(r.height - cardSize.height) > 1) {
      setCardSize({ width: r.width, height: r.height });
    }
  }, [open, index, rect, cardSize.width, cardSize.height]);

  // Focus: the request box on the typing step, else the step's title (screen readers read it).
  useEffect(() => {
    if (!open) return;
    if (step.id === "request") {
      const timer = window.setTimeout(() => requestTextarea()?.focus(), 350);
      return () => window.clearTimeout(timer);
    }
    headingRef.current?.focus();
  }, [open, step]);

  // Keyboard: Escape skips. Off the typing step, Tab stays inside the card.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab" && !step.interactive && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>("button, [tabindex='-1']");
        const first = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, close]);

  const content = useMemo(() => {
    switch (step.id) {
      case "welcome":
        return {
          kicker: organisationName ? `Welcome to ${organisationName}` : "Welcome",
          title: firstName ? `Hi ${firstName}, here's how work gets done here` : "Here's how work gets done here",
          body: (
            <>
              <p>Your admin has already set this workspace up, so you can start straight away. You ask for what you want, people and AI agents do the work, and it&apos;s checked before anything goes live.</p>
              <p className="mt-2">Four quick steps, under a minute.</p>
            </>
          ),
        };
      case "request":
        return {
          kicker: "Step 1 of 4",
          title: "Ask for something",
          body: (
            <>
              <p>Write it in everyday words, or tap a starter and fill in the blanks:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.label}
                    type="button"
                    onClick={() => fillStarter(starter.text)}
                    className="inline-flex min-h-9 items-center rounded-control border border-zk-border bg-zk-tint px-3 text-sm font-semibold text-zk-text hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
              <p className="mt-3">
                Then press <strong className="text-zk-text">Enter</strong> or the round arrow to send it.
              </p>
            </>
          ),
        };
      case "next":
        return {
          kicker: "Step 2 of 4",
          title: sent ? "Sent! Here's what happens next" : "What happens to a request",
          body: (
            <ol className="space-y-2">
              <li><strong className="text-zk-text">It starts as an idea.</strong> Your teammates and their agents say whether it&apos;s a good one.</li>
              <li><strong className="text-zk-text">Good ideas become issues.</strong> Agents offer to do the work, and one of them is picked.</li>
              <li><strong className="text-zk-text">It&apos;s checked before it goes live.</strong> The work is tested and reviewed first, and you can follow it from New to In Progress to Delivered.</li>
            </ol>
          ),
        };
      case "issues":
        return {
          kicker: "Step 3 of 4",
          title: "Help an issue along",
          body: (
            <>
              <p>These tabs show every issue and where it&apos;s at. Open one to:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong className="text-zk-text">Confirm it</strong> when you can see the problem too, with what you saw.</li>
                <li><strong className="text-zk-text">Comment</strong> with anything that helps: where it happens, a screenshot, a question.</li>
                <li><strong className="text-zk-text">Mark it important</strong> when it matters to you, so it&apos;s picked up sooner.</li>
              </ul>
            </>
          ),
        };
      case "inbox":
        return {
          kicker: "Step 4 of 4",
          title: "We'll message you here",
          body: (
            <>
              <p>When someone answers you, asks you something, or work you asked for moves on, it lands in your inbox.</p>
              <p className="mt-2">Stuck at any point? Press the round help button at the bottom right.</p>
            </>
          ),
        };
    }
  }, [step.id, firstName, organisationName, sent]);

  if (!open) return null;

  const spot = step.target && rect ? rect : null;

  // Card placement: under the spotlight, else over it, else centred.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  let cardStyle: React.CSSProperties;
  if (spot) {
    const below = spot.top + spot.height + PAD + GAP;
    const above = spot.top - PAD - GAP - cardSize.height;
    let top: number;
    if (below + cardSize.height <= vh - EDGE) top = below;
    else if (above >= EDGE) top = above;
    else top = Math.max(EDGE, vh - cardSize.height - EDGE);
    const centre = spot.left + spot.width / 2 - cardSize.width / 2;
    const left = Math.min(Math.max(EDGE, centre), vw - cardSize.width - EDGE);
    cardStyle = { top, left };
  } else {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  // The hole the request box shows through: everything around it still catches clicks.
  const hole = spot ? { top: spot.top - PAD, left: spot.left - PAD, right: spot.left + spot.width + PAD, bottom: spot.top + spot.height + PAD } : null;
  const isLast = index === STEPS.length - 1;

  return (
    <div
      className={`fixed inset-0 z-[100] ${step.interactive ? "pointer-events-none" : ""}`}
      data-welcome-tour=""
      // The request box closes on a press outside it while empty; a press on the tour isn't one.
      // React listens on the document itself, so only stopImmediatePropagation keeps the box's own listener from firing.
      onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}
    >
      {step.interactive && hole ? (
        <>
          <div aria-hidden="true" className="pointer-events-auto absolute inset-x-0 top-0" style={{ height: Math.max(0, hole.top) }} />
          <div aria-hidden="true" className="pointer-events-auto absolute inset-x-0 bottom-0" style={{ top: hole.bottom }} />
          <div aria-hidden="true" className="pointer-events-auto absolute left-0" style={{ top: hole.top, height: hole.bottom - hole.top, width: Math.max(0, hole.left) }} />
          <div aria-hidden="true" className="pointer-events-auto absolute right-0" style={{ top: hole.top, height: hole.bottom - hole.top, left: hole.right }} />
        </>
      ) : (
        // Catches clicks so the page under the tour stays as it is.
        <div aria-hidden="true" className="absolute inset-0" />
      )}
      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-panel motion-safe:transition-all motion-safe:duration-300"
          style={{
            top: spot.top - PAD,
            left: spot.left - PAD,
            width: spot.width + PAD * 2,
            height: spot.height + PAD * 2,
            // A blue ring round the lit part, then the dimmed page around it.
            boxShadow: `0 0 0 3px var(--color-electric-blue), 0 0 0 9999px ${DIM}`,
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0" style={{ background: DIM }} />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal={step.interactive ? undefined : true}
        aria-labelledby="welcome-tour-title"
        aria-describedby="welcome-tour-body"
        className="pointer-events-auto absolute w-[min(400px,calc(100vw-2rem))] rounded-panel border border-zk-border bg-zk-surface p-5 text-zk-text shadow-xl motion-safe:transition-[top,left] motion-safe:duration-300"
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zk-muted">{content.kicker}</p>
          {index > 0 && !isLast ? (
            <button type="button" onClick={close} className="rounded-lg px-2 py-1 text-xs font-semibold text-zk-text2 hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue">
              Skip tour
            </button>
          ) : null}
        </div>
        <h2 id="welcome-tour-title" ref={headingRef} tabIndex={-1} className="mt-2 text-lg font-extrabold tracking-tight text-zk-text outline-none">
          {content.title}
        </h2>
        <div id="welcome-tour-body" className="mt-2 text-sm leading-relaxed text-zk-text2">
          {content.body}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {step.id === "welcome" ? (
            <>
              <button type="button" onClick={close} className={quiet}>
                Not now
              </button>
              <button type="button" onClick={() => go(index, 1)} className={primary}>
                Let&apos;s start
              </button>
            </>
          ) : step.id === "request" ? (
            <button type="button" onClick={() => go(index, 1)} className={quiet}>
              I&apos;ll do this later
            </button>
          ) : isLast ? (
            <button type="button" onClick={close} className={primary}>
              Got it
            </button>
          ) : (
            <button type="button" onClick={() => go(index, 1)} className={primary}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
