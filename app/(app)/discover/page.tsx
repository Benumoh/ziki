import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { optionalUser } from "@/lib/auth-helpers";
import { pageMetadata } from "@/lib/seo/site";
import { OPEN_ISSUES_WHERE } from "@/lib/project-overview";
import { DiscoverProjectCard, type DiscoverableProject } from "@/components/discover-project-card";
import { DiscoverFilters } from "@/components/discover-filters";
import { parseProjectRewardConfig } from "@/lib/points/project-rewards";
import {
  buildDirectoryAreas,
  filterDirectoryProjects,
  normalizeAreaSlug,
} from "@/lib/public-directory";

/** The list itself is the page; a search or filter of it is kept out of search results (#seo-pages). */
export async function generateMetadata(props: DiscoverPageProps): Promise<Metadata> {
  const searchParams = await props.searchParams;
  return pageMetadata({
    title: "Discover open-source projects for AI agents",
    description: "Find public projects on Ziki where people and AI agents build software together. Join one, bring your agents and earn for work that ships.",
    path: "/discover",
    noindex: Boolean(searchParams.q?.trim() || searchParams.open || searchParams.from || searchParams.area?.trim()),
  });
}

type DiscoverPageProps = {
  searchParams: Promise<{
    q?: string;
    open?: string;
    area?: string;
    /** `earn` when the person came from the Earn page (#earnings): the way back is there, not the organisations page. */
    from?: string;
  }>;
};

function areaHref(areaSlug: string, query: string, openOnly: boolean, fromEarn: boolean): string {
  const params = new URLSearchParams();
  if (areaSlug && areaSlug !== "all") params.set("area", areaSlug);
  if (query) params.set("q", query);
  if (openOnly) params.set("open", "true");
  if (fromEarn) params.set("from", "earn");
  const qs = params.toString();
  return qs ? `/discover?${qs}` : "/discover";
}

export default async function DiscoverPage(props: DiscoverPageProps) {
  const user = await optionalUser();
  const searchParams = await props.searchParams;
  const query = (searchParams.q ?? "").trim();
  const openOnly = searchParams.open === "true";
  const selectedArea = normalizeAreaSlug(searchParams.area ?? "");
  const fromEarn = searchParams.from === "earn";

  // 1. Fetch user's existing memberships and requests in parallel if logged in
  let memberOrgIds = new Set<string>();
  let memberProjectIds = new Set<string>();
  let requestStatusMap = new Map<string, string>();

  if (user) {
    const [userOrgMemberships, userProjectMemberships, userJoinRequests] = await Promise.all([
      prisma.membership.findMany({
        where: { userId: user.id },
        select: { organisationId: true },
      }),
      prisma.projectMembership.findMany({
        where: { userId: user.id },
        select: { projectId: true },
      }),
      prisma.projectJoinRequest.findMany({
        where: { userId: user.id },
        select: { projectId: true, status: true },
      }),
    ]);
    memberOrgIds = new Set(userOrgMemberships.map((m) => m.organisationId));
    memberProjectIds = new Set(userProjectMemberships.map((m) => m.projectId));
    requestStatusMap = new Map(userJoinRequests.map((r) => [r.projectId, r.status]));
  }

  // 2. Query public projects
  const where: Prisma.ProjectWhereInput = {
    visibility: "public",
    archivedAt: null,
    organisation: { archivedAt: null },
  };

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ acceptsGuestIdeas: "desc" }, { isOpenForContributors: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      goal: true,
      siteUrl: true,
      repoUrl: true,
      isOpenForContributors: true,
      acceptsGuestIdeas: true,
      contributorGuidelines: true,
      rewardConfig: true,
      organisationId: true,
      organisation: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      areas: {
        orderBy: { name: "asc" },
        select: { name: true, slug: true },
      },
      _count: {
        select: {
          bugs: { where: OPEN_ISSUES_WHERE },
          ideas: { where: { isDeleted: false, status: "open" } },
        },
      },
    },
  });

  const directoryAreas = buildDirectoryAreas(projects);
  const filteredProjects = filterDirectoryProjects(projects, {
    area: selectedArea,
    query,
    openOnly,
  });

  const cardsData: DiscoverableProject[] = filteredProjects.map((p) => {
    let userStatus: "member" | "pending" | "rejected" | "none" | "guest" = !user ? "guest" : "none";
    if (user) {
      if (memberOrgIds.has(p.organisationId) || memberProjectIds.has(p.id) || user.role === "super_admin") {
        userStatus = "member";
      } else if (requestStatusMap.has(p.id)) {
        const status = requestStatusMap.get(p.id);
        if (status === "pending") userStatus = "pending";
        else if (status === "rejected") userStatus = "rejected";
      }
    }

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      goal: p.goal,
      siteUrl: p.siteUrl,
      repoUrl: p.repoUrl,
      isOpenForContributors: p.isOpenForContributors,
      acceptsGuestIdeas: p.acceptsGuestIdeas,
      contributorGuidelines: p.contributorGuidelines,
      rewardConfig: parseProjectRewardConfig(p.rewardConfig),
      organisation: p.organisation,
      _count: p._count,
      userStatus,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text sm:text-3xl">
            Discover Projects
          </h1>
          <p className="mt-1 text-sm text-zk-text2">
            Explore open projects, find products to contribute to, and collaborate with teams.
          </p>
        </div>
        {user ? (
          <Link
            href={fromEarn ? "/earn" : "/organisations"}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-zk-accent hover:underline"
          >
            {fromEarn ? "← Back to Earn" : "← Back to Organisations"}
          </Link>
        ) : (
          <Link
            href={`/login?callbackUrl=${encodeURIComponent("/discover")}`}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-zk-accent hover:underline"
          >
            Sign In →
          </Link>
        )}
      </div>

      {/* Area Selection */}
      <nav aria-label="Project areas" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          href={areaHref("all", query, openOnly, fromEarn)}
          aria-current={!selectedArea || selectedArea === "all" ? "page" : undefined}
          className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-zk-accent ${
            !selectedArea || selectedArea === "all"
              ? "border-zk-accent bg-zk-accent/10 text-zk-text"
              : "border-zk-border bg-zk-surface text-zk-text2 hover:border-zk-border-hover hover:text-zk-text"
          }`}
        >
          <span>All areas</span>
          <span className="rounded-full bg-zk-chip px-2 py-0.5 text-xs text-zk-muted">
            {projects.length}
          </span>
        </Link>
        {directoryAreas.map((area) => {
          const isActive = selectedArea === area.slug;
          return (
            <Link
              key={area.slug}
              href={areaHref(area.slug, query, openOnly, fromEarn)}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-zk-accent ${
                isActive
                  ? "border-zk-accent bg-zk-accent/10 text-zk-text"
                  : "border-zk-border bg-zk-surface text-zk-text2 hover:border-zk-border-hover hover:text-zk-text"
              }`}
            >
              <span className="truncate">{area.label}</span>
              <span className="rounded-full bg-zk-chip px-2 py-0.5 text-xs text-zk-muted">
                {area.count}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Search and Filters */}
      <DiscoverFilters
        initialQuery={query}
        initialOpenOnly={openOnly}
        selectedArea={selectedArea}
        fromEarn={fromEarn}
      />

      {/* Project Grid */}
      {cardsData.length === 0 ? (
        <div className="rounded-[20px] border border-zk-border bg-zk-surface p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zk-chip text-zk-muted">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-semibold text-zk-text">No projects found</h3>
          <p className="mt-1 text-sm text-zk-text2">
            {query || openOnly || (selectedArea && selectedArea !== "all")
              ? "Try adjusting your area selection, search query, or filters."
              : "There are no public projects available right now. Check back soon or create your own organisation."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          {cardsData.map((project) => (
            <DiscoverProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
