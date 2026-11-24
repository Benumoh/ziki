"use client";

import { useEffect, useId, useRef, useState } from "react";

/** The portal counterpart of Ziki's 32px, expandable Ideas search control. */
export function FeedbackPortalSearch({ label, name = "q", defaultValue = "", value, onValueChange, placeholder, muted = false, alwaysExpanded = false }: {
  label: string; name?: string; defaultValue?: string; value?: string; onValueChange?: (value: string) => void; placeholder?: string; muted?: boolean; alwaysExpanded?: boolean;
}) {
  const [draft, setDraft] = useState(defaultValue);
  const [open, setExpanded] = useState(Boolean(value ?? defaultValue));
  const expanded = alwaysExpanded || open;
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const text = value ?? draft;
  useEffect(() => { if (expanded && !alwaysExpanded) input.current?.focus(); }, [expanded, alwaysExpanded]);
  return <div className={`flex h-9 min-w-0 shrink-0 items-center justify-center overflow-hidden rounded-control text-zk-text2 ${expanded ? `w-full px-1 ${muted ? "bg-zk-text/[0.06]" : "bg-zk-surface"}` : `w-9 ${muted ? "bg-zk-text/[0.06]" : "bg-zk-surface"}`}`}>
    <button ref={trigger} type="button" aria-label={label} title={label} aria-expanded={expanded} aria-controls={id} onClick={() => { if (expanded) input.current?.focus(); else setExpanded(true); }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zk-accent">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
    </button>
    <input ref={input} id={id} name={name} type="search" aria-label={label} placeholder={placeholder ?? `${label}…`} value={text} hidden={!expanded} onChange={event => { setDraft(event.target.value); onValueChange?.(event.target.value); }} onKeyDown={event => { if (event.key === "Escape" && !alwaysExpanded) { event.preventDefault(); setExpanded(false); trigger.current?.focus(); } }} className="min-w-0 flex-1 border-0 bg-transparent text-sm text-zk-text outline-none placeholder:text-zk-muted" />
    {expanded && !alwaysExpanded ? <button type="button" aria-label="Close search" onClick={() => { setExpanded(false); trigger.current?.focus(); }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zk-muted hover:bg-zk-surface focus-visible:outline-2 focus-visible:outline-zk-accent"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button> : null}
  </div>;
}
