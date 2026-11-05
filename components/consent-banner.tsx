"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

/** Google Tag Manager's container for the site. */
const GTM_ID = "GTM-5TNDKX33";
const STORAGE_KEY = "ziki-cookie-consent";
/** Ask again after this long, so a choice doesn't last forever. */
const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
/** Other parts of the page (the "Cookie settings" link) reopen the banner with this event. */
export const OPEN_CONSENT_EVENT = "ziki:open-cookie-consent";

type Choice = "granted" | "denied";

function readChoice(): Choice | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { choice?: string; at?: number };
    if (saved.choice !== "granted" && saved.choice !== "denied") return null;
    if (typeof saved.at !== "number" || Date.now() - saved.at > CONSENT_MAX_AGE_MS) return null;
    return saved.choice;
  } catch {
    return null;
  }
}

function saveChoice(choice: Choice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    // Storage blocked: the choice lasts for this page only, and the banner asks again next time.
  }
}

/**
 * The cookie banner and the Google tag behind it. Nothing from Google loads
 * until the visitor accepts: declining (or not answering) keeps the site free
 * of analytics. The choice is kept in this browser for six months; "Cookie
 * settings" in the footer opens the banner again to change it.
 */
export function ConsentBanner() {
  // null until mounted: the choice lives in this browser, so the server can't know it.
  const [choice, setChoice] = useState<Choice | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = readChoice();
      setChoice(saved);
      setOpen(saved === null);
    });
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
    };
  }, []);

  function decide(next: Choice) {
    saveChoice(next);
    setOpen(false);
    // Withdrawing consent after the tag loaded: reload so it is gone from this page too.
    if (choice === "granted" && next === "denied") {
      window.location.reload();
      return;
    }
    setChoice(next);
  }

  return (
    <>
      {choice === "granted" ? (
        <>
          <Script id="gtm-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });`}
          </Script>
          <Script id="gtm" src={`https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`} strategy="afterInteractive" />
        </>
      ) : null}

      {open ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="consent-heading"
          aria-describedby="consent-text"
          className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-2xl rounded-[20px] border border-zk-border bg-zk-surface p-5 text-zk-text shadow-[0_12px_40px_rgba(21,18,31,0.18)] sm:p-6"
        >
          <h2 id="consent-heading" className="text-base font-extrabold">
            Cookies on Ziki
          </h2>
          <p id="consent-text" className="mt-1 text-sm text-zk-text2">
            We&apos;d like to use Google analytics cookies to see how Ziki is used and make it better. They&apos;re off unless you
            accept. Ziki works the same either way.
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => decide("denied")}
              className="inline-flex min-h-10 items-center rounded-full border border-zk-border px-5 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => decide("granted")}
              className="inline-flex min-h-10 items-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
            >
              Accept
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

/** "Cookie settings": opens the consent banner again so the visitor can change their choice. */
export function CookieSettingsLink({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))} className={className}>
      Cookie settings
    </button>
  );
}
