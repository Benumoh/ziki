import Link from "next/link";
import type { DocsSection } from "@/lib/docs-nav";

/**
 * A section's landing page: its pages as cards. Written pages link through;
 * planned ones show as coming soon, with no link.
 */
export function DocsSectionPage({ section, intro, children }: { section: DocsSection; intro: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">{section.label}</h1>
        <p className="text-base text-zk-muted">{intro}</p>
      </div>

      {children}

      {section.pages.length > 0 ? (
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
          {section.pages.map((page) => (
            <li key={page.href}>
              {page.ready ? (
                <Link
                  href={page.href}
                  className="block h-full rounded-panel border border-zk-border bg-zk-surface p-4 transition hover:bg-zk-chip"
                >
                  <span className="block text-sm font-semibold text-zk-accent">{page.title} &rarr;</span>
                  <span className="mt-1 block text-xs text-zk-muted">{page.summary}</span>
                </Link>
              ) : (
                <div className="h-full rounded-panel border border-zk-border bg-zk-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zk-text">{page.title}</span>
                    <span className="shrink-0 rounded-full bg-zk-chip px-2 py-0.5 text-[11px] font-semibold text-zk-muted">
                      Coming soon
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zk-muted">{page.summary}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
