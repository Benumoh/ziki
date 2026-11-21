"use client";

import type { ReactNode } from "react";

/**
 * "What do you need help with?": tap tiles, pick as many as you like. The
 * category step of First questions (first-questions.tsx), on its own so other
 * onboarding screens can reuse it. The parent holds what is picked, so it
 * survives going Back and can steer the next step, and passes the tiles for
 * what the person builds (`needsFor`). It sits in a flex column: its buttons
 * go to the foot of it, as on First questions' card.
 */

export type Need = { id: string; icon: string; label: string; text: string };

/** What the person is building (#app-links), asked first; it words the tiles and their starters. */
export type ProductKind = "website" | "app" | "both" | "idea";

/**
 * The tiles for what someone builds. `text` is the starter sentence for the
 * request box; the ___ is the blank to fill. A mobile app gets its own
 * (crashes, store ratings, downloads); something not built yet starts from
 * planning it.
 */
export function needsFor(kind: ProductKind): Need[] {
  if (kind === "idea") {
    return [
      { id: "build", icon: "🚀", label: "Build my first version", text: "I want to build a ___ that helps people ___." },
      { id: "plan", icon: "🗺️", label: "Plan the features", text: "The most important things it should do first are ___." },
      { id: "look", icon: "🎨", label: "Design how it looks", text: "I'd like it to look and feel like ___." },
      { id: "customers", icon: "📣", label: "Find my first customers", text: "The people I want to reach are ___." },
    ];
  }
  const on = kind === "website" ? "on my website" : kind === "app" ? "in my app" : "in my website or app";
  const thing = kind === "website" ? "my website" : kind === "app" ? "my app" : "my product";
  const needs: Need[] = [
    { id: "fix", icon: "🔧", label: "Fix something broken", text: kind === "website" ? "On my website, the ___ doesn't work." : `${on[0].toUpperCase()}${on.slice(1)}, the ___ doesn't work.` },
    { id: "new", icon: "✨", label: "Add something new", text: "I'd like my customers to be able to ___." },
    { id: "look", icon: "🎨", label: "Change how it looks", text: `Please change how the ___ looks ${on}.` },
    kind === "app"
      ? { id: "customers", icon: "📈", label: "Get more downloads", text: "Help more people find my app in the store when they search for ___." }
      : { id: "customers", icon: "📣", label: "Get more customers", text: `Help more people find ${thing} when they search for ___.` },
    { id: "safe", icon: "🔒", label: "Keep it safe", text: `Please check ${thing} is safe, especially the ___.` },
    { id: "fast", icon: "⚡", label: "Make it faster", text: kind === "website" ? "The ___ page on my website is slow to load." : `The ___ ${kind === "app" ? "screen" : "page"} ${on} is slow to open.` },
  ];
  if (kind === "app" || kind === "both") {
    needs.push(
      { id: "crashes", icon: "📉", label: "Stop crashes", text: "My app crashes when people ___." },
      { id: "ratings", icon: "⭐", label: "Get better ratings", text: "People give my app low ratings because ___." },
    );
  }
  return needs;
}

/** The card's main button: full width and tall, as Pinterest's Continue. */
export const PRIMARY_BUTTON =
  "inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-electric-blue px-6 text-lg font-bold text-white transition hover:bg-electric-blue-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
/** The quiet way out under it. */
export const SECONDARY_BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-2xl px-6 text-sm font-semibold text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

type Props = {
  /** The question, rendered by the parent (it may own focus on it). */
  heading: ReactNode;
  /** The tiles, usually `needsFor(kind)`. */
  needs: Need[];
  /** Ids of the picked tiles. */
  picked: string[];
  onPickedChange: (picked: string[]) => void;
  /** Continue, enabled once at least one tile is picked. */
  onNext: () => void;
  /** "Not sure yet". */
  onSkip: () => void;
};

export function NeedPicker({ heading, needs, picked, onPickedChange, onNext, onSkip }: Props) {
  return (
    <>
      {heading}
      <p className="m-0 mt-3 text-base leading-relaxed text-zk-text2 sm:text-[17px]">Pick as many as you like.</p>
      <ul className="mt-8 grid w-full list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
        {needs.map((need) => {
          const on = picked.includes(need.id);
          return (
            <li key={need.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPickedChange(on ? picked.filter((id) => id !== need.id) : [...picked, need.id])}
                className={`relative flex h-32 w-full flex-col items-center justify-center gap-2.5 rounded-3xl border-2 px-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
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
      <div className="mt-auto flex w-full flex-col gap-2 pt-8">
        <button type="button" onClick={onNext} disabled={picked.length === 0} className={PRIMARY_BUTTON}>
          {picked.length === 0 ? "Pick at least one" : `Continue (${picked.length} picked)`}
        </button>
        <button type="button" onClick={onSkip} className={SECONDARY_BUTTON}>
          Not sure yet
        </button>
      </div>
    </>
  );
}
