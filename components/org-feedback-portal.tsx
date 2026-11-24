"use client";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import Link from "next/link";
import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { FeedbackPortalSidebar } from "@/components/feedback-portal-sidebar";
import { FeedbackPortalSearch } from "@/components/feedback-portal-search";
import { publicFeedbackPath } from "@/lib/public-project-paths";
import { TILE_TONES, toneForName } from "@/lib/pill-tones";
export type OrgFeedbackProjectCardItem = { id: string; slug: string; name: string; description: string; platforms?: string[] };
export function OrgFeedbackPortal({ orgSlug, orgName, projects, initialQuery = "" }: { orgSlug: string; orgName: string; projects: OrgFeedbackProjectCardItem[]; initialQuery?: string; returnHref?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [visibleCount, setVisibleCount] = useState(7);
  const needle = query.trim().toLowerCase();
  const filtered = projects.filter(project => [project.name, project.description, project.slug].some(value => value.toLowerCase().includes(needle)));
  return <div className="space-y-4 pb-6"><FeedbackPageHeader title="Feedback portal" identity={orgName} description="Explore products, share feedback, and follow progress." />
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-label="Products" className="overflow-hidden rounded-panel border border-zk-border bg-zk-surface p-4">
        <FeedbackPortalSearch label="Search projects" placeholder="Search projects" value={query} onValueChange={value => { setQuery(value); setVisibleCount(7); }} muted alwaysExpanded />
        {filtered.length ? <ul className="mt-3 divide-y divide-zk-divider">{filtered.slice(0, visibleCount).map(project => <li key={project.id}><Link href={publicFeedbackPath({ orgSlug, projectSlug: project.slug })} aria-label={`Open ${project.name}`} className="group flex items-center gap-3 rounded-lg px-2 py-5 transition hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-zk-accent"><span aria-hidden="true" style={TILE_TONES[toneForName(project.name)]} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-medium">{project.name.charAt(0).toUpperCase()}</span><div className="min-w-0 flex-1"><h2 className="text-[15px] font-medium group-hover:text-zk-accent">{project.name}</h2><p className="mt-1 line-clamp-2 text-sm leading-5 text-zk-muted">{project.description}</p></div><span aria-hidden="true" className="text-lg text-zk-muted">›</span></Link></li>)}</ul> : <div className="px-2 py-8"><h2 className="text-sm font-medium">No projects found</h2><p className="mt-1 text-sm text-zk-muted">{needle ? "Try another project name." : "No projects are available for feedback right now."}</p></div>}
        {visibleCount < filtered.length ? <div className="mt-3 flex justify-center"><Button variant="secondary" onClick={() => setVisibleCount(count => count + 7)}>Show more</Button></div> : null}
      </section><FeedbackPortalSidebar orgSlug={orgSlug} guide />
    </div></div>;
}
