import Link from "next/link";

/**
 * A grouped list's section heading (#work-segments), as Airtable groups its records: the kind of work, as plain text.
 * It is a list item, so it sits in the list between the rows; in a grouped list
 * (`.issues-table--grouped`) it opens a card of its own.
 */
export function WorkSegmentHeading({ label, add }: { label: string; add?: { href: string; label: string } }) {
  return (
    <li className="work-segment-head flex items-center gap-2.5 border-b border-zk-divider px-4 py-2">
      <h3 className="m-0 text-[13px] font-semibold text-zk-text">{label}</h3>
      {/* On the right: report one more of this kind. */}
      {add ? (
        <Link
          href={add.href}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-zk-border bg-zk-surface px-2.5 text-[12px] font-semibold text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {add.label}
        </Link>
      ) : null}
    </li>
  );
}

/** The foot of a section's card: the link to all of that kind when it shows only a few. */
export function WorkSegmentFoot({ href, label, count, shown }: { href: string; label: string; count: number; shown: number }) {
  return (
    <li className="work-segment-end px-4 py-2 text-right">
      {count > shown ? (
        <Link href={href} className="text-[13px] font-semibold text-zk-accent hover:underline">
          Show all {count} {label.toLowerCase()} →
        </Link>
      ) : null}
    </li>
  );
}
