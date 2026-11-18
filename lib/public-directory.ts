export type DirectoryAreaRef = {
  slug: string;
  name: string;
};

export type DirectoryProjectSummary = {
  id: string;
  slug: string;
  name: string;
  goal: string | null;
  isOpenForContributors: boolean;
  acceptsGuestIdeas: boolean;
  organisation: {
    name: string;
    slug: string;
  };
  areas: DirectoryAreaRef[];
};

export type DirectoryAreaOption = {
  slug: string;
  label: string;
  count: number;
};

export const PRIMARY_DIRECTORY_AREAS: readonly DirectoryAreaOption[] = [
  { slug: "desktop", label: "Desktop", count: 0 },
  { slug: "web", label: "Web", count: 0 },
  { slug: "mobile", label: "Mobile", count: 0 },
];

export function normalizeAreaSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function matchesDirectoryArea(
  project: Pick<DirectoryProjectSummary, "slug" | "name" | "areas">,
  areaParam?: string | null,
): boolean {
  const target = normalizeAreaSlug(areaParam ?? "");
  if (!target || target === "all") return true;

  if (
    project.areas.some(
      (area) =>
        normalizeAreaSlug(area.slug) === target ||
        normalizeAreaSlug(area.name) === target,
    )
  ) {
    return true;
  }

  const projectSlug = normalizeAreaSlug(project.slug);
  const projectName = normalizeAreaSlug(project.name);
  return (
    projectSlug === target ||
    projectName === target ||
    projectSlug.endsWith(`-${target}`) ||
    projectName.includes(target)
  );
}

export function buildDirectoryAreas(
  projects: readonly Pick<DirectoryProjectSummary, "slug" | "name" | "areas">[],
): DirectoryAreaOption[] {
  const bySlug = new Map<string, DirectoryAreaOption>();
  for (const primary of PRIMARY_DIRECTORY_AREAS) {
    bySlug.set(primary.slug, { ...primary, count: 0 });
  }

  for (const project of projects) {
    for (const area of project.areas) {
      const slug = normalizeAreaSlug(area.slug || area.name);
      if (!slug) continue;
      if (!bySlug.has(slug)) {
        bySlug.set(slug, { slug, label: area.name, count: 0 });
      }
    }
  }

  return Array.from(bySlug.values()).map((option) => ({
    ...option,
    count: projects.filter((project) => matchesDirectoryArea(project, option.slug)).length,
  }));
}

export function filterDirectoryProjects<T extends DirectoryProjectSummary>(
  projects: readonly T[],
  options: { area?: string | null; query?: string | null; openOnly?: boolean },
): T[] {
  const needle = (options.query ?? "").trim().toLowerCase();
  return projects.filter((project) => {
    if (options.openOnly && !project.isOpenForContributors) return false;
    if (!matchesDirectoryArea(project, options.area)) return false;
    if (!needle) return true;
    const haystack = [
      project.name,
      project.goal ?? "",
      project.organisation.name,
      ...project.areas.map((area) => area.name),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
