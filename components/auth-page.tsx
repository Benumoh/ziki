import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ZikiMark } from "@/components/ziki-mark";
import { REPORT_FORM_URL } from "@/lib/report-form";

/** Shared auth chrome using the app's colour, panel and typography tokens. */
export function AuthPage({ children, story, panelLabel }: {
  children: ReactNode;
  story?: ReactNode;
  panelLabel?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-zk-bg font-sans text-zk-text">
      <header className="flex items-center justify-between gap-4 border-b border-zk-border bg-zk-surface px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Ziki homepage" className="inline-flex items-center gap-2 rounded-control text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2">
          <ZikiMark className="size-8 text-zk-blue" />
          Ziki
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-zk-accent hover:underline">Back to homepage</Link>
          <ThemeToggle />
        </div>
      </header>
      <div className={`mx-auto flex w-full flex-1 items-center px-4 py-10 sm:px-8 sm:py-16 ${story ? "max-w-6xl" : "max-w-lg"}`}>
        <div className={`grid w-full min-w-0 gap-8 ${story ? "lg:grid-cols-2 lg:items-center lg:gap-16" : ""}`}>
          {story}
          <section aria-label={panelLabel} className="flex min-w-0 flex-col gap-5 rounded-panel border border-zk-border bg-zk-surface p-5 sm:p-8">
            {children}
          </section>
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 pb-6 text-[13px] text-zk-muted">
        <span>© {new Date().getFullYear()} Ziki</span>
        <Link href="/docs" className="text-zk-accent hover:underline">Help</Link>
        {REPORT_FORM_URL ? (
          <a href={REPORT_FORM_URL} target="_blank" rel="noopener noreferrer" className="text-zk-accent hover:underline">Report an issue</a>
        ) : null}
      </footer>
    </div>
  );
}
