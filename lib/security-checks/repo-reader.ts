import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GitHubError, githubApiUrl, githubClientFor, installationIdForRepo } from "@/lib/github/client";
import { privateRepoAccess } from "./repo-access";
import type { DependabotAlert, RepoFile } from "./repo-scan";

/**
 * Reading a repo for security checks (#security-repo-scan, 18 Nov). Two ways in, and only these two:
 *
 * - **Public:** what any visitor to github.com can open. Ziki's App or token is used for the higher rate limit, but a
 *   repo is only read once GitHub says it is public.
 * - **Private:** only through the Ziki GitHub App installed on that repo, and only for a workspace that connected it
 *   (`privateRepoAccess`: one of its projects has this repo and the App). The App's token stays on Ziki's server:
 *   agents read private files through Ziki's job API (`/api/v1/security-checks/jobs/{id}/code`), every read logged.
 */

export type RepoMeta =
  | { status: "ok"; private: boolean; pushedAt: string | null; defaultBranch: string }
  | { status: "not_found" }
  | { status: "unavailable"; detail?: string };

export type RepoReader = {
  meta(): Promise<RepoMeta>;
  /** Every file in the default branch with its size; null when GitHub can't list it. */
  tree(): Promise<{ files: RepoFile[]; truncated: boolean } | null>;
  /** One file's text (at most 1 MB, which is GitHub's own limit here); null when missing or not text. */
  file(path: string): Promise<string | null>;
  /** GitHub's open Dependabot alerts; null when the App may not read them (or they are switched off). */
  dependabotAlerts(): Promise<DependabotAlert[] | null>;
};

const USER_AGENT = "ZikiSecurity/1.0 (+https://ziki.dev/security)";
const TIMEOUT_MS = 8_000;

/** A reader for one repo. `installationId`: the App installation the workspace connected, for private repos. */
export async function repoReader(owner: string, name: string, access: { installationId: string | null }): Promise<RepoReader> {
  const installationId = access.installationId ?? (await installationIdForRepo(owner, name).catch(() => null));
  const github = await githubClientFor({ githubInstallationId: installationId });
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const mayReadPrivate = access.installationId !== null;
  let isPublic: boolean | null = null;

  const anonymously = async <T>(path: string): Promise<T | null> => {
    const response = await fetch(`${githubApiUrl()}${path}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new GitHubError(response.status, `GitHub answered ${response.status}`);
    return (await response.json()) as T;
  };
  const read = async <T>(path: string): Promise<T | null> => {
    try {
      return await github.getOrNull<T>(path);
    } catch (error) {
      // A token GitHub rejects, or a spent limit on it, shouldn't stop a look at a public repo.
      if (github.auth !== "none" && isPublic) return anonymously<T>(path);
      throw error;
    }
  };
  /** Nothing is read from a repo that isn't public unless the workspace connected it through the App. */
  const allowed = () => isPublic === true || mayReadPrivate;

  return {
    async meta() {
      try {
        const repo = await read<{ private?: boolean; pushed_at?: string; default_branch?: string }>(base);
        if (!repo) return { status: "not_found" };
        isPublic = repo.private === false;
        if (!allowed()) return { status: "not_found" };
        return { status: "ok", private: !isPublic, pushedAt: repo.pushed_at ?? null, defaultBranch: repo.default_branch ?? "HEAD" };
      } catch (error) {
        const detail = error instanceof GitHubError && error.status ? `GitHub answered ${error.status}` : "Ziki couldn't reach GitHub";
        logger.warn(`[security-repo] couldn't read ${owner}/${name}: ${detail}`);
        return { status: "unavailable", detail };
      }
    },
    async tree() {
      if (!allowed()) return null;
      try {
        const body = await read<{ tree?: { path?: string; type?: string; size?: number }[]; truncated?: boolean }>(`${base}/git/trees/HEAD?recursive=1`);
        if (!body) return null;
        const files = (body.tree ?? []).flatMap((entry) => (entry.type === "blob" && typeof entry.path === "string" ? [{ path: entry.path, size: entry.size ?? 0 }] : []));
        return { files, truncated: Boolean(body.truncated) };
      } catch {
        return null;
      }
    },
    async file(path) {
      if (!allowed()) return null;
      try {
        const body = await read<{ content?: string; encoding?: string; type?: string }>(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
        if (!body || body.type !== "file" || body.encoding !== "base64" || typeof body.content !== "string") return null;
        const bytes = Buffer.from(body.content, "base64");
        // Binary files (a NUL byte early on) aren't text: skip them.
        if (bytes.subarray(0, 8000).includes(0)) return null;
        return bytes.toString("utf8");
      } catch {
        return null;
      }
    },
    async dependabotAlerts() {
      // Only through the App: public visitors can't see a repo's alerts either.
      if (!mayReadPrivate) return null;
      try {
        const alerts = await read<
          {
            dependency?: { package?: { name?: string; ecosystem?: string }; manifest_path?: string };
            security_advisory?: { summary?: string; severity?: string };
            security_vulnerability?: { first_patched_version?: { identifier?: string } | null };
          }[]
        >(`${base}/dependabot/alerts?state=open&per_page=100`);
        if (!alerts) return null;
        return alerts.map((alert) => ({
          package: alert.dependency?.package?.name ?? "a package",
          ecosystem: alert.dependency?.package?.ecosystem ?? "",
          severity: (alert.security_advisory?.severity ?? "medium").toLowerCase(),
          summary: (alert.security_advisory?.summary ?? "a published security advisory").replace(/\.$/, ""),
          manifest: alert.dependency?.manifest_path ?? "the repo",
          fixed: alert.security_vulnerability?.first_patched_version?.identifier ?? null,
        }));
      } catch {
        // 403 (the App wasn't given "Dependabot alerts: read") or alerts switched off: just not shown.
        return null;
      }
    },
  };
}

/** What a signed-in scan of this target may read: a repo the workspace connected through the App, else public only. */
export async function repoAccessFor(organisationId: string, target: { kind: string; value: string }): Promise<{ installationId: string } | null> {
  return target.kind === "repo" ? privateRepoAccess(prisma, organisationId, target.value) : null;
}
