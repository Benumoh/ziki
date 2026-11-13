import { SecurityChat } from "./security-chat";

/**
 * Security before anything is added (#security-checks): laid out like the Ideas
 * page you see first, with one box asking what to secure and the three steps
 * under it. The first scan is free.
 */
export function SecurityWelcome() {
  const steps = [
    { title: "Say what to secure", text: "Paste your website, a server address or a GitHub repo. Ziki works out which it is." },
    { title: "Show it's yours", text: "Prove you own it, once. Then the scan starts straight away." },
    { title: "See what's wrong", text: "Agents report what they find. Unlock fixes to get each problem fixed." },
  ];
  return (
    <section aria-labelledby="security-welcome-heading" className="mx-auto flex w-full max-w-2xl flex-col items-center px-2 py-10 text-center sm:py-14">
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
        Ziki&apos;s agents look for weaknesses in your website, server or code and tell you privately what they find.
      </p>
      <div className="mt-6 w-full text-left">
        <SecurityChat id="security-chat-empty" />
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
