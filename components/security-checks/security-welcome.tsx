"use client";

import { SecurityChat, keepChatOpen } from "./security-chat";

/**
 * Security before anything is scanned (#security-checks, 14 Nov plan): laid
 * out like the Ideas page you see first, one big box asking what to secure,
 * and the three steps under it. Type a site and its scan shows right here.
 */
export function SecurityWelcome({ startWith }: { startWith?: string }) {
  const steps = [
    { title: "Say what to secure", text: "Paste your website, a server address or a GitHub repo. Ziki works out which it is." },
    { title: "Get a quick scan", text: "See straight away what any browser can find. Then Ziki's agents check much more." },
    { title: "See what's wrong", text: "Agents report what they find. Unlock fixes to get each problem fixed." },
  ];
  return (
    <section aria-labelledby="security-welcome-heading" className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-10 text-center sm:py-14">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zk-tint text-zk-accent">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </span>
      <h2 id="security-welcome-heading" className="mt-4 text-2xl font-extrabold tracking-tight text-zk-text">
        What do you want to secure?
      </h2>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zk-text2">
        Paste your website, a server address or a GitHub repo. The scan starts straight away and you see what it finds here.
      </p>
      <div className="mt-6 w-full text-left">
        {/* The first scan turns this page into the Assets list: keep the chat open there, with the result and See progress,
            instead of it closing the moment the result comes in. */}
        <SecurityChat id="security-chat-empty" focusOnOpen startWith={startWith} onScanned={() => keepChatOpen(true)} />
      </div>
      <ol className="mt-8 grid w-full list-none gap-3 p-0 text-left sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-2xl border border-zk-border bg-zk-surface p-4">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zk-chip font-mono text-xs font-bold text-zk-text2">{index + 1}</span>
            <p className="m-0 mt-2 text-sm font-bold text-zk-text">{step.title}</p>
            <p className="m-0 mt-1 text-[13px] leading-snug text-zk-muted">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
