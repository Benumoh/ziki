"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IdeaChat } from "@/components/idea-chat";
import { NeedPicker, needsFor, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/get-started/need-picker";
import { saveProductKindsAction, saveProjectLinksAction } from "@/app/(app)/projects/actions";
import { asksFor, PRODUCT_OTHER_MAX, readProductKinds, type ProductKind } from "@/lib/product-kinds";

/**
 * First questions (#first-questions): a few questions, one at a time, for the
 * organisation owner or an admin the first time they open a project that has
 * no ideas yet, such as right after creating an organisation. Shaped like
 * Pinterest's sign-up questions: one card over the dimmed app, a small progress
 * bar on top, one big question, and the button at the card's foot.
 *
 * 1. what you're building (#product-kinds): any of a website, a mobile app, a
 * desktop app and something else (in your own words: a game, an extension…), or not built yet;
 * saved on the project, 2. where it is: the site address, the App Store and
 * Google Play links (#app-links), a download or store page, and the code, as
 * fits what you build, 3. what you need help with (tap tiles, worded for what
 * you build), 4. your first request, sent through the normal Ideas box. Skip or ×
 * closes it for this project on this device; sending the request ends it
 * because the project then has an idea.
 */

const DONE_KEY = "ziki.first-questions.v1.done";

type Props = {
  projectId: string;
  projectSlug: string;
  siteUrl: string | null;
  repoUrl: string | null;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
  downloadUrl: string | null;
  productKinds: readonly string[];
  productOther: string | null;
  canEditLinks: boolean;
  firstName: string | null;
};

type Step = "kind" | "links" | "needs" | "request";

/** Pick all that apply; "Not built yet" stands alone. */
const KINDS: { id: ProductKind; icon: string; label: string; hint: string }[] = [
  { id: "website", icon: "🌐", label: "A website", hint: "People visit it in a browser" },
  { id: "mobile", icon: "📱", label: "A mobile app", hint: "iPhone or Android" },
  { id: "desktop", icon: "💻", label: "A desktop app", hint: "Windows, Mac or Linux" },
  { id: "other", icon: "🧩", label: "Something else", hint: "A game, an extension, a bot…" },
  { id: "idea", icon: "💡", label: "Not built yet", hint: "I have an idea to start" },
];

const REQUEST_EXAMPLE: Record<ProductKind, string> = {
  website: "For example: The contact form on my website doesn't send me an email.",
  mobile: "For example: The sign-up screen in my app freezes after I tap Continue.",
  desktop: "For example: My app won't open on a Mac after the latest update.",
  other: "For example: Players fall through the floor on level 3.",
  idea: "For example: I want an app where neighbours can lend each other tools.",
};

/** The example in the request box: the one kind's, or a general one for several. */
function requestExample(kinds: readonly ProductKind[]): string {
  if (kinds.length === 1) return REQUEST_EXAMPLE[kinds[0]];
  if (kinds.length === 0) return REQUEST_EXAMPLE.website;
  return "For example: Customers can't reset their password.";
}

/** The links question, worded for what you build. */
function linksHeading(kinds: readonly ProductKind[]): string {
  const only = kinds.length === 1 ? kinds[0] : null;
  if (only === "website") return "Nice! What's your\nwebsite?";
  if (only === "mobile" || only === "desktop") return "Nice! Where can we\nfind your app?";
  return "Nice! Where can we\nfind it?";
}

/** The download page's label: a desktop app's download, or wherever people get something else (a game's Steam page…). */
function downloadLabel(kinds: readonly ProductKind[]): { label: string; placeholder: string } {
  if (kinds.includes("desktop")) return { label: "Download or store page", placeholder: "https://yourapp.com/download" };
  return { label: "Where people get it (a store or download page)", placeholder: "https://store.steampowered.com/app/123456" };
}

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

const ICON_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-full text-zk-muted transition hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue";

export function FirstQuestions({
  projectId,
  projectSlug,
  siteUrl,
  repoUrl,
  appStoreUrl,
  playStoreUrl,
  downloadUrl,
  productKinds,
  productOther,
  canEditLinks,
  firstName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // What the project already says it is, if it was asked before.
  const [kinds, setKinds] = useState<ProductKind[]>(() => readProductKinds(productKinds));
  const [other, setOther] = useState(productOther ?? "");
  const [kindError, setKindError] = useState<string | null>(null);
  const [site, setSite] = useState(siteUrl ?? "");
  const [appStore, setAppStore] = useState(appStoreUrl ?? "");
  const [play, setPlay] = useState(playStoreUrl ?? "");
  const [download, setDownload] = useState(downloadUrl ?? "");
  const [code, setCode] = useState(repoUrl ?? "");
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<HTMLDivElement>(null);
  const isIdea = kinds.includes("idea");
  // Nothing to link for a product not built yet, and only owners and admins can set the links.
  const steps: Step[] = ["kind", ...(canEditLinks && !isIdea ? (["links"] as const) : []), "needs", "request"];
  const step = steps[index];
  const greeting = firstName ? `Welcome, ${firstName}!` : "Welcome!";
  const asks = asksFor(kinds);

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

  // Pick all that apply. "Not built yet" can't go with anything built, so each clears the other.
  function toggleKind(choice: ProductKind) {
    setKindError(null);
    setPicked([]); // The help tiles differ, so earlier picks no longer apply.
    setKinds((current) => {
      if (current.includes(choice)) return current.filter((kind) => kind !== choice);
      if (choice === "idea") return ["idea"];
      return [...current.filter((kind) => kind !== "idea"), choice];
    });
  }

  // Saved on the project (#product-kinds), which also renames an untouched "Web" project to fit.
  async function saveKinds() {
    if (kinds.length === 0) return;
    if (canEditLinks) {
      setSaving(true);
      const result = await saveProductKindsAction(projectSlug, kinds, other);
      setSaving(false);
      if (result?.error) {
        setKindError(result.fieldErrors?.other ?? result.error);
        return;
      }
      if (result?.message) router.refresh();
    }
    next();
  }

  const linksFilled =
    (asks.site && site.trim()) ||
    (asks.stores && (appStore.trim() || play.trim())) ||
    (asks.download && download.trim()) ||
    code.trim();

  async function saveLinks() {
    if (!linksFilled) return next();
    setSaving(true);
    setLinkError(null);
    setLinkErrors({});
    const form = new FormData();
    form.set("slug", projectSlug);
    // A box this screen doesn't show keeps the project's saved value.
    form.set("siteUrl", asks.site ? site.trim() : (siteUrl ?? ""));
    form.set("repoUrl", code.trim());
    if (asks.stores) {
      form.set("appStoreUrl", appStore.trim());
      form.set("playStoreUrl", play.trim());
    }
    if (asks.download) form.set("downloadUrl", download.trim());
    const result = await saveProjectLinksAction(undefined, form);
    setSaving(false);
    if (result?.error) {
      if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) setLinkErrors(result.fieldErrors);
      else setLinkError(result.error);
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

  const needs = needsFor(kinds.length > 0 ? kinds : ["website"]);
  const pickedNeeds = needs.filter((need) => picked.includes(need.id));
  const starters = pickedNeeds.length > 0 ? pickedNeeds : needs.slice(0, 3);

  // A big question, left-aligned; a line break in the text starts its second line.
  const heading = (text: string) => (
    <h2
      id="first-questions-heading"
      ref={headingRef}
      tabIndex={-1}
      className="m-0 whitespace-pre-line text-[30px] font-extrabold leading-[1.12] tracking-tight text-zk-text outline-none sm:text-[38px]"
    >
      {text}
    </h2>
  );
  const lead = (text: string) => <p className="m-0 mt-3 text-base leading-relaxed text-zk-text2 sm:text-[17px]">{text}</p>;

  // A box with its label inside, as Pinterest's are.
  const linkField = (props: {
    id: string;
    name: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }) => {
    const error = linkErrors[props.name];
    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={props.id}
          className={`flex cursor-text flex-col gap-1 rounded-2xl border-2 bg-zk-surface px-5 py-3 transition focus-within:border-electric-blue ${error ? "border-zk-bad-fg" : "border-zk-border"}`}
        >
          <span className="text-sm font-semibold text-zk-text">{props.label}</span>
          <input
            id={props.id}
            type="url"
            inputMode="url"
            autoComplete={props.name === "siteUrl" ? "url" : "off"}
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            placeholder={props.placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${props.id}-error` : undefined}
            className="w-full bg-transparent text-lg text-zk-text outline-none placeholder:text-zk-muted"
          />
        </label>
        {error ? <p id={`${props.id}-error`} role="alert" className="m-0 px-1 text-sm text-zk-bad-fg">{error}</p> : null}
      </div>
    );
  };

  // On <body>, so nothing on the page (a transformed parent, a sticky bar) can clip or cover it.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:p-0"
      // The Ideas box closes itself on a click outside it; clicks in here are inside this screen.
      onPointerDown={(event) => event.nativeEvent.stopImmediatePropagation()}
    >
      {/* The app stays in sight behind the card, dimmed. A click on it does nothing. */}
      <div aria-hidden="true" className="absolute inset-0 bg-[rgba(11,23,51,0.55)] backdrop-blur-[2px]" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-questions-heading"
        className="relative flex max-h-[calc(100dvh-2rem)] min-h-[min(720px,calc(100dvh-2rem))] w-full max-w-[610px] flex-col overflow-hidden rounded-[28px] bg-zk-surface shadow-[0_24px_64px_rgba(11,23,51,0.35)] max-sm:h-[100dvh] max-sm:max-h-none max-sm:min-h-0 max-sm:max-w-none max-sm:rounded-none"
      >
        <div className="relative flex h-16 shrink-0 items-center justify-center px-4">
          {index > 0 ? (
            <button type="button" onClick={() => setIndex(index - 1)} aria-label="Back" className={`${ICON_BUTTON} absolute left-3`}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          ) : null}
          <div
            className="h-1.5 w-36 overflow-hidden rounded-full bg-zk-chip"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
            aria-valuetext={`Step ${index + 1} of ${steps.length}`}
          >
            <div className="h-full rounded-full bg-electric-blue transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
          <button type="button" onClick={close} aria-label="Close" className={`${ICON_BUTTON} absolute right-3`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-8 pt-8 sm:px-14 sm:pb-10 sm:pt-10">
          {step === "kind" ? (
            <>
              {heading(`${greeting}\nWhat are you building?`)}
              {lead("Pick all that apply. Your answers help us ask the right things and find the right people to help.")}
              <ul className="mt-7 grid w-full list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
                {KINDS.map((option) => {
                  const on = kinds.includes(option.id);
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleKind(option.id)}
                        className={`relative flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-3xl border-2 px-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
                          on ? "border-electric-blue bg-zk-tint" : "border-zk-border bg-zk-surface hover:border-zk-muted"
                        }`}
                      >
                        <span aria-hidden="true" className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full transition ${on ? "bg-electric-blue text-white" : "border-2 border-zk-border"}`}>
                          {on ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : null}
                        </span>
                        <span aria-hidden="true" className="text-3xl leading-none">{option.icon}</span>
                        <span className="text-[15px] font-bold leading-tight text-zk-text">{option.label}</span>
                        <span className="text-xs leading-snug text-zk-muted">{option.hint}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {kinds.includes("other") ? (
                <label htmlFor="first-questions-other" className="mt-4 flex cursor-text flex-col gap-1 rounded-2xl border-2 border-zk-border bg-zk-surface px-5 py-3 transition focus-within:border-electric-blue">
                  <span className="text-sm font-semibold text-zk-text">What is it?</span>
                  <input
                    id="first-questions-other"
                    value={other}
                    onChange={(event) => setOther(event.target.value)}
                    maxLength={PRODUCT_OTHER_MAX}
                    placeholder="e.g. a game, a Chrome extension, a Discord bot"
                    className="w-full bg-transparent text-lg text-zk-text outline-none placeholder:text-zk-muted"
                  />
                </label>
              ) : null}
              {kindError ? <p role="alert" className="m-0 mt-3 px-1 text-sm text-zk-bad-fg">{kindError}</p> : null}
              <div className="mt-auto flex w-full flex-col gap-2 pt-8">
                <button type="button" onClick={() => void saveKinds()} disabled={saving || kinds.length === 0} className={PRIMARY_BUTTON}>
                  {saving ? "Saving…" : kinds.length === 0 ? "Pick at least one" : "Continue"}
                </button>
                <button type="button" onClick={close} className={SECONDARY_BUTTON}>
                  I&apos;ll set this up later
                </button>
              </div>
            </>
          ) : null}

          {step === "links" ? (
            <>
              {heading(linksHeading(kinds))}
              {lead("Add the links you have, so the people who help you can see it and understand what you mean. Your code helps them most.")}
              <form
                className="mt-8 flex flex-1 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveLinks();
                }}
              >
                {asks.site
                  ? linkField({ id: "first-questions-site", name: "siteUrl", label: "Website address", value: site, onChange: setSite, placeholder: "https://yourwebsite.com" })
                  : null}
                {asks.stores
                  ? linkField({ id: "first-questions-app-store", name: "appStoreUrl", label: "App Store link (iPhone)", value: appStore, onChange: setAppStore, placeholder: "https://apps.apple.com/app/id123456789" })
                  : null}
                {asks.stores
                  ? linkField({ id: "first-questions-play", name: "playStoreUrl", label: "Google Play link (Android)", value: play, onChange: setPlay, placeholder: "https://play.google.com/store/apps/details?id=…" })
                  : null}
                {asks.download
                  ? linkField({ id: "first-questions-download", name: "downloadUrl", ...downloadLabel(kinds), value: download, onChange: setDownload })
                  : null}
                {/* Every kind of product has code, and it's what helpers need most. */}
                {linkField({ id: "first-questions-code", name: "repoUrl", label: "Code on GitHub", value: code, onChange: setCode, placeholder: "https://github.com/you/your-project" })}
                {linkError ? <p role="alert" className="m-0 px-1 text-sm text-zk-bad-fg">{linkError}</p> : null}
                <div className="mt-auto flex flex-col gap-2 pt-8">
                  <button type="submit" disabled={saving || !linksFilled} className={PRIMARY_BUTTON}>
                    {saving ? "Saving…" : "Continue"}
                  </button>
                  <button type="button" onClick={next} className={SECONDARY_BUTTON}>
                    I don&apos;t have these yet
                  </button>
                </div>
              </form>
            </>
          ) : null}

          {step === "needs" ? (
            <NeedPicker
              heading={heading("What do you need\nhelp with?")}
              needs={needs}
              picked={picked}
              onPickedChange={setPicked}
              onNext={next}
              onSkip={next}
            />
          ) : null}

          {step === "request" ? (
            <>
              {heading("Tell us one thing\nyou want")}
              {lead("Use your own words. Tap a start below, then fill in the blank.")}
              <div className="mt-6 flex flex-wrap gap-2">
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
              <div ref={requestRef} className="mt-4 w-full">
                <IdeaChat projectId={projectId} alwaysOpen placeholder={requestExample(kinds)} />
              </div>
              <p className="m-0 mt-3 text-sm text-zk-muted">Press Enter or the round arrow to send it. Nothing changes without your OK.</p>
              <div className="mt-auto flex w-full flex-col pt-8">
                <button type="button" onClick={close} className={SECONDARY_BUTTON}>
                  I&apos;ll do this later
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
