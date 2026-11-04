import Link from "next/link";

/**
 * The statuses in the picked stage, down the left of the Issues panel, each
 * with its count. Only the selected one is highlighted. On narrow screens the
 * list runs across the top of the panel instead.
 */
export type SidebarStep = {
  label: string;
  count: number;
  href: string;
  selected: boolean;
  /** warn: a step that asks for you (Your call, #your-call), drawn in amber so it catches the eye. */
  tone?: "warn";
};

export function StageSidebar({ steps }: { steps: SidebarStep[] }) {
  return (
    // relative: the labels' screen-reader-only (absolute) counts stay inside the
    // scrolling strip on phones instead of widening the page.
    <nav aria-label="Status" className="relative shrink-0 max-lg:w-full max-lg:overflow-x-auto max-lg:border-b max-lg:border-zk-divider max-lg:pb-3 lg:w-40 lg:py-1">
      <ol className="m-0 flex list-none p-0 max-lg:gap-5 lg:flex-col">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <li key={step.label} className="flex shrink-0">
              {/* The whole row, count box and name, is one link (#739). */}
              <Link
                href={step.href}
                aria-current={step.selected ? "page" : undefined}
                className="group flex min-w-0 flex-1 gap-3 rounded-md"
              >
                {/* The label lines up with its box (self-start), not the box and its connector together. */}
                <span className="flex flex-col items-center">
                  {/* The count sits in the box; the selected one is filled blue. */}
                  <span
                    aria-hidden="true"
                    data-testid="stage-count"
                    className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg px-1 font-mono text-[11px] font-semibold tabular-nums ${
                      step.tone === "warn"
                        ? step.selected
                          ? "bg-amber-500 text-white ring-4 ring-amber-500/25"
                          : "border-2 border-amber-400 bg-amber-50 text-amber-700 shadow-[0_0_8px_1px_rgba(245,158,11,0.35)]"
                        : step.selected
                          ? "bg-electric-blue-strong text-white ring-4 ring-electric-blue-strong/20"
                          : "border-2 border-zk-border bg-zk-surface text-zk-muted group-hover:border-electric-blue-strong group-hover:text-zk-accent"
                    }`}
                  >
                    {step.count}
                  </span>
                  {last ? null : <span aria-hidden="true" className="my-1 min-h-5 w-0.5 flex-1 rounded-full bg-zk-border max-lg:hidden" />}
                </span>
                <span
                  className={`flex min-h-7 min-w-0 flex-1 items-center self-start leading-tight max-lg:whitespace-nowrap text-sm ${
                    step.tone === "warn"
                      ? `text-amber-700 group-hover:text-amber-800 ${step.selected ? "font-bold" : "font-semibold"}`
                      : `group-hover:text-zk-accent ${step.selected ? "font-bold text-zk-text" : "font-medium text-zk-text2"}`
                  }`}
                >
                  {step.label}
                  <span className="sr-only">, {step.count}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
