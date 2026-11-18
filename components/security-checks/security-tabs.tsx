import Link from "next/link";
import { PipelineSteps } from "@/components/pipeline-steps";

/**
 * The top of Security once someone has something there (#security-checks):
 * the same stage bar as a project's Your Work and Ideas. The findings dashboard has no link
 * here any more (15 Nov call); it still opens at /security?view=findings.
 */
export function SecurityTabs({ selected, checks, jobs, canAdd = true }: { selected: "checks" | "work"; checks: number; jobs: number; canAdd?: boolean }) {
  // Only owners and admins own assets (13 Nov); everyone else sees just Your work.
  const stages = [
    ...(canAdd ? [{ label: "Assets", count: checks, href: "/security", selected: selected === "checks" }] : []),
    { label: "Your work", count: jobs, href: "/security/work", selected: selected === "work" },
  ];
  return (
    <>
    {/* Like a project's page: where you are, on a thin line above the tabs. */}
    <nav aria-label="Breadcrumb" className="mx-auto mb-3 flex w-full max-w-6xl items-center px-0.5 text-[13px] text-zk-text2 max-sm:mb-1">
      <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-0.5 p-0">
        <li>
          <Link href="/security" className={`${CRUMB} block font-bold text-zk-text`}>Security</Link>
        </li>
        <li aria-hidden="true" className="text-zk-muted">/</li>
        <li>
          <span aria-current="page" className={`${CRUMB} block font-medium text-zk-text2`}>{selected === "checks" ? "Assets" : "Your work"}</span>
        </li>
      </ol>
    </nav>
    {/* The tabs, centred, as wide as the panel below. */}
    <div className="relative mx-auto mb-4 flex w-full max-w-6xl flex-wrap items-start justify-center gap-3 max-sm:mb-3">
      <PipelineSteps
        label="Security"
        stages={stages}
      />
    </div>
    </>
  );
}

const CRUMB = "rounded-md px-1.5 py-0.5 hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent";
