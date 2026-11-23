"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_HOME_HREF, DOCS_HOME_ICON, DOCS_SECTIONS, docsSectionFor } from "@/lib/docs-nav";

const HOME = { href: DOCS_HOME_HREF, label: "Start here", hint: "Pick your path", icon: DOCS_HOME_ICON };

/**
 * The docs sidebar: the start page and one entry per reader, styled like the
 * Settings sidebar. The open section lists its written pages below it.
 */
export function DocsSidebar() {
  const pathname = (usePathname() ?? "").replace(/\/+$/, "") || "/";
  const openSection = docsSectionFor(pathname);
  const items = [HOME, ...DOCS_SECTIONS];

  return (
    <nav
      aria-label="Documentation sections"
      className="grid grid-cols-2 gap-1 rounded-panel border border-zk-border bg-zk-surface p-1.5 sm:p-2 min-[1100px]:flex min-[1100px]:flex-col"
    >
      {items.map((item) => {
        const on = item.href === DOCS_HOME_HREF ? pathname === DOCS_HOME_HREF : openSection?.href === item.href;
        const current = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-16 w-full items-center gap-2 rounded-xl p-2 text-left text-zk-text transition sm:min-h-[72px] sm:gap-3 sm:p-3 ${
              on ? "bg-zk-tint" : "bg-transparent hover:bg-zk-chip"
            }`}
          >
            <span
              className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control sm:h-9 sm:w-9 sm:rounded-xl ${
                on ? "bg-electric-blue-strong text-white" : "bg-zk-chip text-zk-text2"
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={item.icon} />
              </svg>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={`text-sm font-bold ${on ? "text-zk-accent" : ""}`}>{item.label}</span>
              <span className="hidden text-xs font-medium text-zk-muted sm:block">{item.hint}</span>
            </span>
          </Link>
        );
      })}

      {openSection && openSection.pages.some((page) => page.ready) ? (
        <div className="col-span-full mt-2 hidden border-t border-zk-divider px-1 pt-3 min-[1100px]:block">
          <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-zk-muted">
            {openSection.label}
          </p>
          <ul className="m-0 list-none p-0">
            {openSection.pages
              .filter((page) => page.ready)
              .map((page) => {
                const on = pathname === page.href;
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      aria-current={on ? "page" : undefined}
                      className={`flex min-h-9 items-center rounded-control px-2.5 text-sm transition ${
                        on ? "bg-zk-tint font-bold text-zk-accent" : "font-medium text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
                      }`}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
