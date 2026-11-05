"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type EditNavGroup = { group: string; items: Array<{ href: string; label: string; hint?: string }> };

/** The edit pages' sidebar: one link per page, the current one highlighted. A scrolling row on a phone. */
export function EditNav({ groups }: { groups: EditNavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Edit agent" className="lg:sticky lg:top-24">
      <div className="-mx-4 flex gap-6 overflow-x-auto px-4 lg:mx-0 lg:block lg:overflow-visible lg:px-0">
        {groups.map((group) => (
          <div key={group.group} className="shrink-0 lg:mb-6">
            <p className="mb-2 px-3 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">{group.group}</p>
            <ul className="flex gap-1 lg:block lg:space-y-0.5">
              {group.items.map((item) => {
                const on = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={on ? "page" : undefined}
                      className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                        on ? "bg-zk-tint text-zk-text" : "text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
                      }`}
                    >
                      {item.label}
                      {item.hint ? (
                        <span className="rounded-full bg-zk-bad-bg px-2 py-0.5 text-[11px] font-bold text-zk-bad-fg">{item.hint}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
