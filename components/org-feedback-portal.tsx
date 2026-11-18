"use client";

import { useState } from "react";
import Link from "next/link";
import { publicFeedbackPath } from "@/lib/public-project-paths";

export type OrgFeedbackProjectCardItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
};

function ProjectPlatformIcon({ slug, name }: { slug: string; name: string }) {
  const key = (slug || name).trim().toLowerCase();
  if (key === "web" || key.endsWith("-web")) {
    return (
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-zk-text2"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M3 9h18" />
        <circle cx="6.5" cy="6.5" r="0.6" fill="currentColor" />
        <circle cx="9" cy="6.5" r="0.6" fill="currentColor" />
        <circle cx="11.5" cy="6.5" r="0.6" fill="currentColor" />
      </svg>
    );
  }
  if (key === "mobile" || key.endsWith("-mobile")) {
    return (
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-zk-text2"
        aria-hidden="true"
      >
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M10.5 5.5h3" />
        <circle cx="12" cy="18.5" r="0.7" fill="currentColor" />
      </svg>
    );
  }
  if (key === "desktop" || key.endsWith("-desktop")) {
    return (
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-zk-text2"
        aria-hidden="true"
      >
        <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
        <path d="M8 20.5h8" />
        <path d="M12 16.5v4" />
      </svg>
    );
  }
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-zk-text2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}

export function OrgFeedbackPortal({
  orgSlug,
  orgName,
  projects,
  initialQuery = "",
}: {
  orgSlug: string;
  orgName: string;
  projects: OrgFeedbackProjectCardItem[];
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(needle) ||
          project.description.toLowerCase().includes(needle) ||
          project.slug.toLowerCase().includes(needle),
      )
    : projects;

  return (
    <div className="mx-auto flex min-h-[75vh] w-full max-w-5xl flex-col justify-between px-4 pb-8 pt-2">
      <div className="space-y-6">
        <div className="space-y-2">
          <Link
            href={`/${encodeURIComponent(orgSlug)}`}
            className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-electric-blue-strong hover:underline"
          >
            <span aria-hidden="true">←</span> {orgName}
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-zk-text sm:text-4xl">
            Share feedback with {orgName}
          </h1>
          <p className="text-base text-zk-text2">
            Choose a project to report a problem or suggest an improvement.
          </p>
        </div>

        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-zk-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className="w-full rounded-xl border border-zk-border bg-zk-surface py-2.5 pl-10 pr-4 text-sm text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-none focus:ring-1 focus:ring-zk-accent"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-zk-border bg-zk-surface p-10 text-center">
            <h2 className="text-base font-semibold text-zk-text">No projects found</h2>
            <p className="mt-1 text-sm text-zk-text2">
              {needle
                ? "Try searching with a different project name."
                : "No projects are available for feedback right now."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((project) => (
              <article
                key={project.id}
                className="flex flex-col justify-between rounded-2xl border border-zk-border bg-zk-surface p-6 transition hover:border-zk-border-hover"
              >
                <div className="space-y-3">
                  <ProjectPlatformIcon slug={project.slug} name={project.name} />
                  <h2 className="text-xl font-bold text-zk-text">{project.name}</h2>
                  <p className="line-clamp-2 text-sm text-zk-text2">{project.description}</p>
                </div>

                <div className="mt-5">
                  <Link
                    href={publicFeedbackPath({ orgSlug, projectSlug: project.slug })}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-electric-blue-strong/60 px-4 py-1.5 text-xs font-bold text-electric-blue-strong transition hover:bg-electric-blue-strong/10"
                  >
                    View feedback <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <footer className="mt-16 border-t border-zk-divider pt-6 text-center text-xs text-zk-muted">
        Powered by <span className="font-bold text-zk-text">Ziki</span>
      </footer>
    </div>
  );
}
