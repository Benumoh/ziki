"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FeedbackPortalSearch } from "@/components/feedback-portal-search";
import { ProjectFilter } from "@/components/project-filter";
import { ToolbarFilterMenu } from "@/components/toolbar-filter-menu";
const statuses = [{ value: "", label: "All feedback" }, { value: "open", label: "Awaiting review" }, { value: "converted", label: "Converted to an issue" }, { value: "rejected", label: "Not proceeding" }, { value: "archived", label: "Archived" }];
export function FeedbackIdeasToolbar({ baseHref, query = "", status = "", project = "", projects }: { baseHref: string; query?: string; status?: string; project?: string; projects?: { slug: string; name: string }[] }) {
  const [text, setText] = useState(query);
  const router = useRouter();
  function href(nextProject = project, nextStatus = status) {
    const url = new URL(baseHref, "https://local.invalid");
    if (text.trim()) url.searchParams.set("q", text.trim()); else url.searchParams.delete("q");
    if (nextProject) url.searchParams.set("project", nextProject); else url.searchParams.delete("project");
    if (nextStatus) url.searchParams.set("status", nextStatus); else url.searchParams.delete("status");
    return url.pathname + url.search;
  }
  return <div className="mb-4 flex flex-wrap items-center gap-2"><form className="min-w-40 flex-1" onSubmit={event => { event.preventDefault(); router.push(href()); }}><FeedbackPortalSearch label="Search feedback ideas" placeholder="Search feedback" value={text} onValueChange={setText} muted alwaysExpanded /><button type="submit" className="sr-only">Search feedback</button></form>{projects ? <ProjectFilter current={project || null} allHref={href("")} projects={projects.map(item => ({ ...item, href: href(item.slug) }))} /> : null}<ToolbarFilterMenu summary={statuses.find(item => item.value === status && item.value)?.label} groups={[{ label: "Status", options: statuses.map(item => ({ label: item.label, href: href(project, item.value), selected: status === item.value })) }]} /></div>;
}
