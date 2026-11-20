"use client";

import { useRouter } from "next/navigation";

/**
 * The lists' project filter (#project-filter): All projects (the default, at `/<org>/…`: every ticket,
 * whatever its project) or one project (at `/<org>/<project>/…`). Each choice is the same list's address
 * there, with its other filters kept and back at its first page.
 */
export function ProjectFilter({
  allHref,
  projects,
  current,
}: {
  allHref: string;
  projects: Array<{ slug: string; name: string; href: string }>;
  current: string | null;
}) {
  const router = useRouter();

  function choose(slug: string) {
    router.push(projects.find((project) => project.slug === slug)?.href ?? allHref);
  }

  return (
    <label className="relative inline-flex h-8 items-center">
      <span className="sr-only">Project</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute left-2.5 text-zk-muted">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
      <select
        value={current ?? ""}
        onChange={(event) => choose(event.target.value)}
        className={`h-8 cursor-pointer appearance-none rounded-lg border bg-zk-surface pl-8 pr-8 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue ${
          current ? "border-electric-blue-strong/50 text-zk-text" : "border-zk-border text-zk-text2"
        }`}
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project.slug} value={project.slug}>
            {project.name}
          </option>
        ))}
      </select>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute right-2.5 text-zk-muted">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
