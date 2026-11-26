"use client";

import { useId, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { INVITE_BATCH_MAX, looksLikeEmail, splitEmails, takeFinishedEmails } from "@/lib/invite-emails";
import { createInvitesAction, type CreateInvitesActionResult } from "@/app/(app)/organisations/actions";

type Results = Extract<CreateInvitesActionResult, { ok: true }>["results"];
type Sent = Extract<Results[number], { ok: true }>;

function deliveryNote(sent: Sent): string {
  switch (sent.delivery) {
    case "notified":
      return "Already has an account, so we told them in Ziki.";
    case "emailed":
      return "We emailed them the link.";
    case "manual":
      return "Email isn't set up here: send them the link yourself.";
  }
}

/**
 * An owner or admin invites people by email (#444, #team-page): one or several at once. Each finished
 * address becomes a tile in the field (a comma, a space or Enter finishes one; a pasted list is split),
 * and each gets its own single-use link, shown here once since only its hash is stored.
 */
export function InviteForm({ organisationId }: { organisationId: string }) {
  const inputId = useId();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [emails, setEmails] = useState<string[]>([]);
  const [typing, setTyping] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [pending, startTransition] = useTransition();

  function add(more: string[]) {
    if (more.length === 0) return;
    setError(null);
    setEmails((current) => {
      const next = [...current];
      for (const email of more) if (!next.includes(email)) next.push(email);
      return next;
    });
  }

  function remove(email: string) {
    setEmails((current) => current.filter((item) => item !== email));
    inputRef.current?.focus();
  }

  /** Turns what is still being typed into a tile. */
  function finishTyping() {
    const more = splitEmails(typing);
    setTyping("");
    add(more);
    return more;
  }

  function onChange(value: string) {
    const { finished, typing: rest } = takeFinishedEmails(value);
    add(finished);
    setTyping(rest);
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!/[\s,;]/.test(text)) return;
    // A pasted list: every address in it becomes a tile at once.
    event.preventDefault();
    add(splitEmails(`${typing} ${text}`));
    setTyping("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && typing.trim()) {
      event.preventDefault();
      finishTyping();
    } else if (event.key === "Backspace" && !typing && emails.length > 0) {
      event.preventDefault();
      setEmails((current) => current.slice(0, -1));
    }
  }

  const all = [...emails];
  for (const email of splitEmails(typing)) if (!all.includes(email)) all.push(email);
  const invalid = all.filter((email) => !looksLikeEmail(email));
  const tooMany = all.length > INVITE_BATCH_MAX;
  const suggestion = typing.trim() && looksLikeEmail(typing.trim().toLowerCase()) ? typing.trim().toLowerCase() : null;

  function send() {
    const list = [...emails, ...finishTyping()].filter((email, index, items) => items.indexOf(email) === index);
    if (list.length === 0) {
      setError("Add at least one email address.");
      inputRef.current?.focus();
      return;
    }
    if (list.some((email) => !looksLikeEmail(email))) {
      setError("Fix or remove the addresses in red first.");
      return;
    }
    if (list.length > INVITE_BATCH_MAX) {
      setError(`Invite up to ${INVITE_BATCH_MAX} people at a time.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await createInvitesAction(organisationId, list);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setResults(result.results);
        // Those that went out are done; any that didn't stay as tiles to fix and send again.
        setEmails(result.results.filter((item) => !item.ok).map((item) => item.email));
      } catch {
        setError("Couldn't send the invites. Try again.");
      }
    });
  }

  async function copy(link: string) {
    toast((await copyText(link)) ? "Invite link copied." : "Couldn't copy. Select the link and copy it.");
  }

  if (results) {
    const sent = results.filter((item): item is Sent => item.ok);
    const failed = results.filter((item) => !item.ok);
    return (
      <div role="status" className="mt-4 space-y-3">
        <p className="text-sm font-medium text-zk-text">
          {sent.length > 0
            ? `${sent.length === 1 ? "1 invite" : `${sent.length} invites`} sent. Copy a link now if you want to send it yourself: it won't be shown again.`
            : "No invites went out."}
        </p>
        <ul className="divide-y divide-zk-divider overflow-hidden rounded-control border border-zk-border">
          {results.map((item) => (
            <li key={item.email} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zk-text">{item.email}</p>
                <p className={`text-xs ${item.ok ? "text-zk-muted" : "text-zk-bad-fg"}`}>
                  {item.ok ? deliveryNote(item) : item.error}
                </p>
              </div>
              {item.ok ? (
                <Button type="button" variant="secondary" className="shrink-0" onClick={() => copy(item.link)}>
                  Copy link
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setResults(null);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          {failed.length > 0 ? "Fix the ones that didn't go out" : "Invite more people"}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mt-4 space-y-1.5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor={inputId} className="block text-sm font-medium text-zk-text">
        Email addresses
      </label>
      {/* The field and its tiles look like one input; a click anywhere in it puts the cursor in. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex min-h-11 w-full cursor-text flex-wrap items-center gap-1.5 rounded-control border bg-zk-surface px-2 py-1.5 focus-within:ring-2 focus-within:ring-electric-blue ${
          invalid.length > 0 || tooMany ? "border-zk-bad-bd" : "border-zk-border"
        }`}
      >
        {emails.map((email) => {
          const ok = looksLikeEmail(email);
          return (
            <span
              key={email}
              className={`inline-flex max-w-full items-center gap-1 rounded-chip py-1 pl-2 pr-1 text-sm ${
                ok ? "bg-zk-tint text-zk-text" : "bg-zk-bad-bg text-zk-bad-fg"
              }`}
              title={ok ? undefined : "This doesn't look like an email address"}
            >
              <span className="truncate">{email}</span>
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(email);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-zk-muted hover:bg-zk-chip hover:text-zk-text"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={typing}
          onChange={(event) => onChange(event.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onBlur={() => finishTyping()}
          placeholder={emails.length === 0 ? "name@example.com, another@example.com" : ""}
          aria-describedby={helpId}
          disabled={pending}
          className="h-8 min-w-[12rem] flex-1 border-0 bg-transparent px-1 text-sm text-zk-text outline-none placeholder:text-zk-muted"
        />
      </div>
      {suggestion ? (
        <button
          type="button"
          // mousedown, not click: the field's blur would otherwise move the address before the click lands.
          onMouseDown={(event) => {
            event.preventDefault();
            finishTyping();
            inputRef.current?.focus();
          }}
          className="flex w-full items-center gap-2 rounded-control border border-zk-border bg-zk-surface px-3 py-2 text-left text-sm text-zk-text hover:bg-zk-chip"
        >
          <span className="text-zk-muted">Add</span>
          <span className="truncate font-medium">{suggestion}</span>
        </button>
      ) : null}
      <p id={helpId} className="text-xs text-zk-muted">
        Separate addresses with a comma, a space or Enter, or paste a list. Each one becomes a tile; select × to remove it.
        Up to {INVITE_BATCH_MAX} at a time.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-xs text-zk-muted" aria-live="polite">
          {all.length === 0 ? "" : all.length === 1 ? "1 person" : `${all.length} people`}
          {invalid.length > 0 ? ` · ${invalid.length} to fix` : ""}
        </p>
        <Button type="submit" disabled={pending || all.length === 0} className="shrink-0 whitespace-nowrap">
          {pending ? "Sending…" : all.length > 1 ? `Send ${all.length} invites` : "Send invite"}
        </Button>
      </div>
    </form>
  );
}
