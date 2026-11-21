"use client";

import { useEffect, useState } from "react";

/** What happens while an idea is structured (#idea-intake), typed out one after another. */
const DEFAULT_STEPS = [
  "Sending your idea…",
  "Reading what you wrote…",
  "Working out what you're asking for…",
  "Writing a clear title…",
  "Describing the problem…",
  "Proposing a solution…",
  "Listing how we'll know it's done…",
  "Saving your idea…",
];

const TYPE_MS = 28;
const HOLD_MS = 1100;

/**
 * Shown while a submitted idea is written up: each step types out letter by
 * letter with a blinking cursor, then the next one starts, so the wait (a few
 * seconds) visibly shows work happening. The last step stays until the page
 * moves on. Screen readers hear one plain sentence instead of the typing.
 */
export function ClaudeWorking({
  className = "",
  steps = DEFAULT_STEPS,
  statusText = "Writing up your idea.",
}: {
  className?: string;
  steps?: string[];
  statusText?: string;
}) {
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const activeSteps = steps.length > 0 ? steps : DEFAULT_STEPS;
  const line = activeSteps[Math.min(step, activeSteps.length - 1)];

  useEffect(() => {
    if (typed < line.length) {
      const timer = setTimeout(() => setTyped((count) => count + 1), TYPE_MS);
      return () => clearTimeout(timer);
    }
    if (step < activeSteps.length - 1) {
      const timer = setTimeout(() => {
        setStep((current) => current + 1);
        setTyped(0);
      }, HOLD_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [typed, line.length, step, activeSteps.length]);

  return (
    <div className={`flex items-start gap-2.5 rounded-xl bg-zk-tint px-3 py-2.5 ${className}`}>
      <span className="sr-only" role="status">{statusText}</span>
      <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-zk-accent motion-safe:animate-pulse">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" />
        </svg>
      </span>
      <div aria-hidden="true" className="min-w-0 flex-1 font-mono text-[12.5px] leading-5 text-zk-text2">
        {/* The steps already done stay, faded, above the one being typed. */}
        {activeSteps.slice(Math.max(0, step - 2), step).map((done) => (
          <p key={done} className="m-0 text-zk-muted">
            <span className="text-zk-ok-fg">✓</span> {done.replace(/…$/, "")}
          </p>
        ))}
        <p className="m-0 text-zk-text">
          {line.slice(0, typed)}
          <span className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] bg-zk-accent motion-safe:animate-[zk-caret_1s_steps(1)_infinite]" />
        </p>
      </div>
    </div>
  );
}
