"use client";

import { useEffect, useState } from "react";

/**
 * Ziki's newest reply, typed out a few characters at a time with a caret, like a typewriter (#project-chat). Screen
 * readers get the whole text at once; people who ask for reduced motion see it whole.
 */
export function Typed({ text }: { text: string }) {
  // Whole at once for people who ask for reduced motion.
  const [still] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const [typed, setShown] = useState(0);
  const shown = still ? text.length : typed;
  useEffect(() => {
    if (still) return;
    let count = 0;
    const timer = setInterval(() => {
      count = Math.min(text.length, count + 3);
      setShown(count);
      if (count >= text.length) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [text, still]);
  const done = shown >= text.length;
  return (
    <span className="whitespace-pre-wrap">
      <span aria-hidden="true">{text.slice(0, shown)}</span>
      {done ? null : <span aria-hidden="true" className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] bg-zk-text" style={{ animation: "zk-caret 0.8s step-end infinite" }} />}
      <span className="sr-only">{text}</span>
    </span>
  );
}
