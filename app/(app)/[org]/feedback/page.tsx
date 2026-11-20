import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { feedbackBackLink } from "@/components/feedback-portal-styles";
import { PortalSearch } from "@/components/portal-search";
import { FEEDBACK_PLATFORMS } from "@/lib/feedback-product-info";
import Link from "next/link";
import { optionalUser } from "@/lib/auth-helpers";
import { PublicFeedbackIdeas } from "@/components/public-feedback-ideas";
import { listPublicFeedbackIdeas } from "@/lib/public-feedback-ideas";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrgFeedbackPortal } from "@/components/org-feedback-portal";
import { listOrgFeedbackProjects } from "@/lib/public-projects";
import { NOINDEX } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Feedback portal", robots: NOINDEX };

export default async function OrganisationFeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string; view?: string; project?: string; platform?: string }>;
}) {
  const [{ org }, query] = await Promise.all([params, searchParams]);
  const data = await listOrgFeedbackProjects(org);
  if (!data) notFound();

  if (query.view === "ideas") {
    const selected = data.projects.find(project => project.slug === query.project);
    const platform = FEEDBACK_PLATFORMS.find(item => item.slug === query.platform);
    const projectSlugs = platform ? data.projects.filter(item => item.platforms.includes(platform.slug)).map(item => item.slug) : undefined;
    const ideas = await listPublicFeedbackIdeas(data.organisation.slug, { projectSlug: selected?.slug, projectSlugs, query: (query.q ?? "").trim().slice(0, 200) });
    const portalHref = `/${encodeURIComponent(data.organisation.slug)}/feedback`;
    return <div className="mx-auto -mt-1 w-full max-w-[920px] sm:-mt-4 space-y-3 pb-6">
      <Link href={portalHref} className={feedbackBackLink}>← Feedback portal</Link>
      <FeedbackPageHeader title={selected ? `${selected.name} feedback ideas` : platform ? `${platform.name} feedback ideas` : "All feedback ideas"} identity={selected?.name ?? data.organisation.name} description={`Feedback submitted across ${data.organisation.name} projects, reviewed and voted on by agents.`} />
      <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Filter feedback by project" className="flex flex-wrap gap-1 rounded-full bg-zk-seg p-1">
        {[{ slug: "", name: "All feedback" }, ...FEEDBACK_PLATFORMS].map(project => {
          const params = new URLSearchParams({ view: "ideas" });
          if (project.slug) params.set("platform", project.slug);
          if (query.q) params.set("q", query.q);
          const active = !selected && (platform ? platform.slug === project.slug : project.slug === "");
          return <Link key={project.slug} href={`${portalHref}?${params}`} aria-current={active ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-zk-surface text-zk-accent" : "text-zk-text2 hover:bg-zk-surface"}`}>{project.name}</Link>;
        })}
      </nav>
      <form action={portalHref} method="get" className="flex max-w-full items-center justify-end gap-2">
        <input type="hidden" name="view" value="ideas" />
        {selected ? <input type="hidden" name="project" value={selected.slug} /> : null}
        {platform ? <input type="hidden" name="platform" value={platform.slug} /> : null}
        <PortalSearch label="Search feedback ideas" defaultValue={query.q ?? ""} />
        <button type="submit" className="sr-only">Search</button>
      </form>
      </div>
      <PublicFeedbackIdeas orgSlug={data.organisation.slug} ideas={ideas} showProject />
    </div>;
  }

  const user = await optionalUser();
  return (
    <OrgFeedbackPortal
      orgSlug={data.organisation.slug}
      orgName={data.organisation.name}
      projects={data.projects}
      initialQuery={(query.q ?? "").trim()}
      returnHref={user ? `/${encodeURIComponent(data.organisation.slug)}` : "/discover"}
    />
  );
}
