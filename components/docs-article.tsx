import Link from "next/link";
import { DOCS_SECTIONS, type DocsSection } from "@/lib/docs-nav";

/**
 * One docs page, laid out the same way every time: a back link to its section,
 * the title, an "In short" box, the body, related links, then Previous and Next
 * through the section's written pages. Built from the app's own tokens only.
 */
export function DocsArticle({
  href,
  inShort,
  related = [],
  children,
}: {
  /** This page's address in lib/docs-nav.ts: its title, section and neighbours come from there. */
  href: string;
  inShort: React.ReactNode;
  related?: { href: string; label: string }[];
  children: React.ReactNode;
}) {
  const section = DOCS_SECTIONS.find((item) => item.pages.some((page) => page.href === href)) as DocsSection;
  const ready = section.pages.filter((page) => page.ready);
  const index = ready.findIndex((page) => page.href === href);
  const page = ready[index];
  const previous = index > 0 ? ready[index - 1] : null;
  const next = index >= 0 && index < ready.length - 1 ? ready[index + 1] : null;

  return (
    <article className="max-w-3xl space-y-8">
      <div className="space-y-3">
        <Link href={section.href} className="text-sm font-semibold text-zk-accent hover:underline">
          ← {section.label}
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">{page.title}</h1>
        <div className="rounded-panel border border-zk-border bg-zk-info-bg/70 p-4 sm:p-5">
          <p className="text-sm font-extrabold text-zk-info-fg">In short</p>
          <div className="mt-1 text-sm text-zk-text2">{inShort}</div>
        </div>
      </div>

      {children}

      {related.length > 0 ? (
        <section className="space-y-3 rounded-panel border border-zk-border bg-zk-chip/50 p-6">
          <h2 className="text-sm font-semibold text-zk-text">Related</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {related.map((link) => (
              <Link key={link.href} href={link.href} className="font-semibold text-zk-accent hover:underline">
                {link.label} &rarr;
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {previous || next ? (
        <nav aria-label="More in this section" className="grid gap-4 sm:grid-cols-2">
          {previous ? (
            <Link href={previous.href} className="rounded-panel border border-zk-border bg-zk-surface p-4 transition hover:bg-zk-chip">
              <span className="block text-xs text-zk-muted">Previous</span>
              <span className="block text-sm font-semibold text-zk-accent">&larr; {previous.title}</span>
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {next ? (
            <Link href={next.href} className="rounded-panel border border-zk-border bg-zk-surface p-4 text-right transition hover:bg-zk-chip">
              <span className="block text-xs text-zk-muted">Next</span>
              <span className="block text-sm font-semibold text-zk-accent">{next.title} &rarr;</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </article>
  );
}

/** A section heading inside a docs page. */
export function DocsH2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 border-b border-zk-divider pb-2 text-xl font-extrabold text-zk-text">
      {children}
    </h2>
  );
}

/** A block of docs content: a heading and what sits under it. */
export function DocsBlock({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <DocsH2 id={id}>{title}</DocsH2>
      {children}
    </section>
  );
}

export function DocsP({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-6 text-zk-text2">{children}</p>;
}

/** Numbered steps, one action each. */
export function DocsSteps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-zk-text2 marker:font-semibold marker:text-zk-muted">{children}</ol>;
}

export function DocsList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-zk-text2 marker:text-zk-muted">{children}</ul>;
}

/** The name of a button, tab or menu item, as it reads on screen. */
export function UiLabel({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-zk-text">{children}</strong>;
}

/** A route, field or value inside a sentence. */
export function DocsInlineCode({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-zk-chip px-1.5 py-0.5 font-mono text-xs text-zk-text">{children}</code>;
}

/** A command or payload to copy, in the same dark block as the API examples. */
export function DocsCode({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      {label ? <div className="border-b border-slate-800 px-4 py-2 text-xs font-medium text-slate-300">{label}</div> : null}
      <pre className="overflow-x-auto p-4 text-xs font-mono text-slate-200">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** A link inside docs text. */
export function DocsLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-zk-accent hover:underline">
      {children}
    </Link>
  );
}

/** A tip or warning set apart from the text. */
export function DocsNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-panel border border-zk-border bg-zk-surface p-4">
      <p className="text-sm font-semibold text-zk-text">{title}</p>
      <div className="mt-1 text-xs leading-5 text-zk-muted">{children}</div>
    </div>
  );
}

/** Question-and-answer pairs. */
export function DocsQA({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  return (
    <dl className="space-y-4">
      {items.map((item) => (
        <div key={item.q} className="rounded-panel border border-zk-border bg-zk-surface p-4">
          <dt className="text-sm font-semibold text-zk-text">{item.q}</dt>
          <dd className="mt-1 text-sm leading-6 text-zk-text2">{item.a}</dd>
        </div>
      ))}
    </dl>
  );
}
