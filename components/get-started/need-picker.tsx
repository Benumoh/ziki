"use client";

import type { ReactNode } from "react";
import type { ProductKind } from "@/lib/product-kinds";

/**
 * "What do you need help with?": tap tiles, pick as many as you like. The
 * category step of First questions (first-questions.tsx), on its own so other
 * onboarding screens can reuse it. The parent holds what is picked, so it
 * survives going Back and can steer the next step, and passes the tiles for
 * what the person builds (`needsFor`). It sits in a flex column: its buttons
 * go to the foot of it, as on First questions' card.
 */

export type Need = { id: string; icon: string; label: string; text: string };

/** How to speak of it: "my app", "in my app", and what a part of it is called. */
function wordsFor(kinds: readonly ProductKind[]) {
  const only = kinds.length === 1 ? kinds[0] : null;
  if (only === "website") return { thing: "my website", on: "on my website", part: "page" };
  if (only === "mobile" || only === "desktop") return { thing: "my app", on: "in my app", part: "screen" };
  if (kinds.length === 2 && kinds.includes("website") && kinds.includes("mobile")) {
    return { thing: "my product", on: "in my website or app", part: "page" };
  }
  return { thing: "my product", on: "in my product", part: "part" };
}

/**
 * The tiles for what someone builds (#product-kinds). `text` is the starter
 * sentence for the request box; the ___ is the blank to fill. Everyone gets the
 * common ones, worded for what they build; each kind adds its own (a mobile app's
 * crashes and ratings, a desktop app's installs).
 * Something not built yet starts from planning it.
 */
export function needsFor(kinds: readonly ProductKind[]): Need[] {
  if (kinds.includes("idea")) {
    return [
      { id: "build", icon: "🚀", label: "Build my first version", text: "I want to build a ___ that helps people ___." },
      { id: "plan", icon: "🗺️", label: "Plan the features", text: "The most important things it should do first are ___." },
      { id: "look", icon: "🎨", label: "Design how it looks", text: "I'd like it to look and feel like ___." },
      { id: "customers", icon: "📣", label: "Find my first customers", text: "The people I want to reach are ___." },
    ];
  }
  const { thing, on, part } = wordsFor(kinds);
  const On = on[0].toUpperCase() + on.slice(1);
  const only = kinds.length === 1 ? kinds[0] : null;
  const has = (kind: ProductKind) => kinds.includes(kind);

  const needs: Need[] = [
    { id: "fix", icon: "🔧", label: "Fix something broken", text: `${On}, the ___ doesn't work.` },
    {
      id: "new",
      icon: "✨",
      label: "Add something new",
      text: "I'd like my customers to be able to ___.",
    },
    { id: "look", icon: "🎨", label: "Change how it looks", text: `Please change how the ___ looks ${on}.` },
    only === "mobile"
        ? { id: "customers", icon: "📈", label: "Get more downloads", text: "Help more people find my app in the store when they search for ___." }
        : { id: "customers", icon: "📣", label: "Get more customers", text: `Help more people find ${thing} when they search for ___.` },
    { id: "safe", icon: "🔒", label: "Keep it safe", text: `Please check ${thing} is safe, especially the ___.` },
  ];
  needs.push({
    id: "fast",
    icon: "⚡",
    label: "Make it faster",
    text: only === "website" ? "The ___ page on my website is slow to load." : `The ___ ${part} ${on} is slow to open.`,
  });
  if (has("mobile") || has("desktop")) {
    needs.push({
      id: "crashes",
      icon: "📉",
      label: "Stop crashes",
      text: has("desktop") && !has("mobile") ? "My app crashes on ___ (Windows, Mac or Linux) when people ___." : "My app crashes when people ___.",
    });
  }
  if (has("desktop")) {
    needs.push({ id: "install", icon: "💾", label: "Fix install problems", text: "People can't install or update my app on ___ (Windows, Mac or Linux)." });
  }
  if (has("mobile")) {
    needs.push({ id: "ratings", icon: "⭐", label: "Get better ratings", text: "People give my app low ratings because ___." });
  }
  return needs;
}

/** The card's main button: full width and tall, as Pinterest's Continue. */
export const PRIMARY_BUTTON =
  "inline-flex min-h-12 w-full items-center justify-center rounded-control bg-electric-blue-strong px-6 text-base font-bold text-white transition hover:bg-zk-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
/** The quiet way out under it. */
export const SECONDARY_BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-control px-6 text-sm font-semibold text-zk-text2 transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

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
                className={`relative flex h-32 w-full flex-col items-center justify-center gap-2.5 rounded-panel border-2 px-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
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
