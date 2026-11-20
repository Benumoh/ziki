import { z } from "zod";
import { unreservedProjectSlug } from "@/lib/project-slug";

/** Project names are shown in the header, so keep them short and readable. */
export const PROJECT_NAME_MIN = 2;
export const PROJECT_NAME_MAX = 60;
export const PROJECT_SLUG_MAX = 48;

export const projectNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(PROJECT_NAME_MIN, `Project name must be at least ${PROJECT_NAME_MIN} characters.`)
    .max(PROJECT_NAME_MAX, `Project name must be ${PROJECT_NAME_MAX} characters or fewer.`),
});

const optionalUrl = (check: (url: URL) => boolean, message: string) =>
  z.string().trim().transform((value) => value || null).pipe(
    z.string().nullable().refine((value) => {
      if (value === null) return true;
      try { return check(new URL(value)); } catch { return false; }
    }, message),
  );

/** A GitHub repository's address. The form's example (github.com/owner/repository) is not a real one. */
const isGitHubRepoUrl = (url: URL) =>
  url.protocol === "https:" && url.hostname === "github.com" && !url.port && !url.username && !url.password &&
  /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname) && !url.search && !url.hash &&
  !/^\/owner\/repository(?:\.git)?\/?$/i.test(url.pathname);
const GITHUB_REPO_URL_MESSAGE = "Enter your GitHub repository's URL, such as https://github.com/your-org/your-repo.";
const repoUrlSchema = optionalUrl(isGitHubRepoUrl, GITHUB_REPO_URL_MESSAGE);

/** How many repositories a project can list besides its main one (#2). */
export const PROJECT_EXTRA_REPOSITORIES_MAX = 10;

/** `https://github.com/owner/repo`, lower-cased: GitHub names are case-insensitive. */
export function canonicalGitHubRepoUrl(value: string): string {
  const [owner, repo] = new URL(value).pathname.replace(/\/$/, "").replace(/\.git$/i, "").split("/").filter(Boolean);
  return `https://github.com/${owner}/${repo}`.toLowerCase();
}

/** Another repository for a project (#2): its URL, a short label and the branch fixes go into. */
export const projectRepositorySchema = z.object({
  url: z.string().trim().refine((value) => {
    try { return isGitHubRepoUrl(new URL(value)); } catch { return false; }
  }, GITHUB_REPO_URL_MESSAGE).transform(canonicalGitHubRepoUrl),
  label: z.string().trim().max(40, "The label must be 40 characters or fewer.").transform((value) => value || null),
  branch: z.string().trim().max(100, "The branch must be 100 characters or fewer.")
    .refine((value) => value === "" || /^(?!\/|.*\.\.|.*\/$)[A-Za-z0-9._/-]+$/.test(value), "Enter a branch name, such as dev or main.")
    .transform((value) => value || null),
});

/** The product's live site (#project-links). The example domains (example.com and the like) are not real sites. */
const siteUrlSchema = optionalUrl((url) => url.protocol === "https:" && !url.username && !url.password &&
  !/(^|\.)example\.(com|org|net)$/i.test(url.hostname),
  "Enter your site's HTTPS address, such as https://yourproduct.com.");

/** The site and GitHub repository, set from the panel above the list (#project-links). */
export const projectLinksSchema = z.object({ siteUrl: siteUrlSchema, repoUrl: repoUrlSchema });

export const projectSettingsSchema = z.object({
  name: z.string().trim().min(PROJECT_NAME_MIN, `Project name must be at least ${PROJECT_NAME_MIN} characters.`).max(PROJECT_NAME_MAX, `Project name must be ${PROJECT_NAME_MAX} characters or fewer.`),
  goal: z.string().trim().max(4000, "The project goal must be 4,000 characters or fewer.").transform((value) => value || null),
  repoUrl: repoUrlSchema,
  stagingUrl: optionalUrl((url) => url.protocol === "https:",
    "Enter a valid HTTPS staging URL."),
  siteUrl: siteUrlSchema,
  visibility: z.enum(["public", "private"]).optional().default("private"),
  isOpenForContributors: z.boolean().optional().default(false),
  acceptsGuestIdeas: z.boolean().optional().default(false),
  contributorGuidelines: z.string().trim().max(4000, "The guidelines must be 4,000 characters or fewer.").transform((value) => value || null).optional(),
  humanApprovalGuidelines: z.string().trim().max(8000, "Human approval guidelines must be 8,000 characters or fewer.").transform((value) => value || null).optional(),
});

const areaPathPattern = z.string().trim().min(1).max(256).refine(
  (path) => !path.startsWith("/") && !path.split(/[\\/]/).includes(".."),
  "Use a project-relative path pattern without parent-directory segments.",
);

export const projectAreaSchema = z.object({
  name: z.string().trim().min(2, "Area name must be at least 2 characters.").max(60, "Area name must be 60 characters or fewer."),
  description: z.string().trim().max(1000, "The area description must be 1,000 characters or fewer.").transform((value) => value || null),
  paths: z.string().trim().max(5000, "Area paths must be 5,000 characters or fewer.").transform((value) => [...new Set(value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean))]).pipe(z.array(areaPathPattern).max(25, "An area can have at most 25 path patterns.")),
});

/**
 * A URL-safe slug from a display name. Kept deterministic so the same name
 * gets the same base; collisions are resolved by `nextProjectSlug`. Project
 * areas use it as is; projects go through `projectSlugBase`.
 */
export function urlSlugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROJECT_SLUG_MAX);
  return slug || "project";
}

/**
 * A project's slug base. Never a top-level route name: an issue's URL is
 * `/<org>/<project>/<number>`, so a project called "Issues" gets `issues-project`.
 */
export function projectSlugBase(name: string): string {
  return unreservedProjectSlug(urlSlugBase(name));
}

/** `base`, or `base-2`, `base-3`, ... when another project already uses it. */
export function nextProjectSlug(
  base: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, PROJECT_SLUG_MAX - tail.length).replace(/-+$/g, "")}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error(`Could not find a free slug for "${base}".`);
}

export function parseRewardConfigFromFormData(formData: FormData) {
  const hasCustomRewards =
    formData.has("reporterPoints") ||
    formData.has("reviewerPoints") ||
    formData.has("rewardGuidelines");

  if (!hasCustomRewards) return null;

  const reporter = formData.get("reporterPoints");
  const reviewer = formData.get("reviewerPoints");
  const guidelines = String(formData.get("rewardGuidelines") ?? "").trim();

  return {
    reporter: reporter ? Number(reporter) : undefined,
    reviewer: reviewer ? Number(reviewer) : undefined,
    guidelines: guidelines || null,
  };
}
