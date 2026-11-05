"use client";

import { useState } from "react";

/** "About me": the first few lines, with Read more to open the rest. */
export function AboutText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split("\n").length > 4;
  return (
    <div>
      <p className={`whitespace-pre-wrap break-words text-base leading-relaxed text-zk-text2 ${open || !long ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="mt-1 text-sm font-bold text-zk-text underline underline-offset-2 hover:text-zk-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
        >
          {open ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
