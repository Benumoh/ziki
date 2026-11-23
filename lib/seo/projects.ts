import { absoluteUrl } from "@/lib/site-url";
import { projectPath, projectRef } from "@/lib/project-paths";
import { breadcrumbs } from "@/lib/seo/agents";
import { clip, DESCRIPTION_MAX, fittedTitle } from "@/lib/seo/site";

/**
 * Search metadata for a public project's page, /<org>/<project> (#seo-pages):
 * its description and its structured data. Nothing here describes a private
 * project: a guest must not learn that one exists.
 */

type DescribedProject = { name: string; goal: string | null };

/**
 * The page's title (#seo-ctr): what the project is and who runs it, with the
 * promise of paid agent work. A long name drops the extra words first, so the
 * title fits a phone's search result without losing the project's name.
 */
export function projectTitle(project: { name: string; organisation: { name: string } }): string {
  return fittedTitle([
    `${project.name} by ${project.organisation.name} | AI agents on Ziki`,
    `${project.name} | AI agents on Ziki`,
    `${project.name} | Ziki`,
  ]);
}

/**
 * What every project snippet promises (#seo-ctr): paid agent tasks that a
 * person has checked. The goal goes in front of it, trimmed to make room.
 */
const PROJECT_PROMISE = "Paid agent tasks, checked by people before they ship.";

/** The project's goal with its Markdown marks removed, or a line saying what a project page is. */
export function projectDescription(project: DescribedProject): string {
  const goal = project.goal?.replace(/[#*_`>[\]()]/g, " ").replace(/\s+/g, " ").trim();
  if (!goal) {
    return clip(`${project.name} on Ziki: paid AI agent tasks with real outcomes, checked by people before anything ships.`);
  }
  return `${clip(goal, DESCRIPTION_MAX - PROJECT_PROMISE.length - 1)} ${PROJECT_PROMISE}`;
}

/** The page's structured data: the project, who runs it and where its code and site are. Null unless it is public. */
export function projectJsonLd(
  project: DescribedProject & {
    slug: string;
    visibility: "public" | "private";
    repoUrl: string | null;
    siteUrl: string | null;
    organisation: { name: string; slug: string };
  },
): object[] | null {
  if (project.visibility !== "public") return null;
  const path = projectPath(projectRef(project.organisation.slug, project.slug));
  const url = absoluteUrl(path);
  const sameAs = [project.repoUrl, project.siteUrl].filter((link): link is string => Boolean(link));
  return [
    {
      "@context": "https://schema.org",
      "@type": "Project",
      "@id": `${url}#project`,
      name: project.name,
      description: projectDescription(project),
      url,
      parentOrganization: { "@type": "Organization", name: project.organisation.name },
      ...(sameAs.length ? { sameAs } : {}),
    },
    breadcrumbs([
      { name: "Discover", path: "/discover" },
      { name: project.name, path },
    ]),
  ];
}
