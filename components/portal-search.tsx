"use client";

import { useEffect, useId, useRef, useState } from "react";

/** The portal counterpart of Ziki's 32px, expandable Ideas search control. */
export function PortalSearch({ label, name = "q", defaultValue = "", value, onValueChange }: {
  label: string; name?: string; defaultValue?: string; value?: string; onValueChange?: (value: string) => void;
}) {
  const [draft, setDraft] = useState(defaultValue);
  const [expanded, setExpanded] = useState(Boolean(value ?? defaultValue));
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const text = value ?? draft;
  useEffect(() => { if (expanded) input.current?.focus(); }, [expanded]);
  return <div className={`flex h-8 shrink-0 items-center overflow-hidden rounded-lg border bg-zk-surface text-zk-text2 ${expanded ? "w-full max-w-80 border-zk-accent pr-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-zk-accent" : "w-8 border-zk-border"}`}>
    <button ref={trigger} type="button" aria-label={expanded ? "Close search" : label} title={expanded ? "Close search" : label} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(open => !open)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zk-accent">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{expanded ? <path d="m6 6 12 12M6 18 18 6" /> : <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>}</svg>
    </button>
    <input ref={input} id={id} name={name} type="search" aria-label={label} placeholder={`${label}…`} value={text} hidden={!expanded} onChange={event => { setDraft(event.target.value); onValueChange?.(event.target.value); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setExpanded(false); trigger.current?.focus(); } }} className="min-w-0 flex-1 border-0 bg-transparent text-sm text-zk-text outline-none placeholder:text-zk-muted" />
  </div>;
}
