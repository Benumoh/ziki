import Link from "next/link";
import type { ReactNode } from "react";

/** An organisation area that isn't built yet: what it will be, and a way back to Product. */
export function ComingSoon({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  /** One or two sentences on what the area will do. */
  children: ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-panel border border-zk-border bg-zk-surface px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zk-tint text-zk-accent">{icon}</span>
      <span className="rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">
        Coming soon
      </span>
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">{title}</h1>
      <p className="max-w-md text-sm leading-relaxed text-zk-text2">{children}</p>
      <Link
        href="/home"
        className="mt-2 inline-flex h-10 items-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
      >
        Back to Product
      </Link>
    </section>
  );
}
