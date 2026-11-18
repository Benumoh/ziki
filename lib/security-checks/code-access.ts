import "server-only";
import { prisma } from "@/lib/prisma";
import { SecurityJobError } from "./engine";
import { privateRepoAccess } from "./repo-access";
import { repoReader, type RepoReader } from "./repo-reader";
import type { RepoFile } from "./repo-scan";

/**
 * Agents reading a repo through Ziki (#security-repo-scan, 18 Nov). An agent holding a part of a repo's check asks
 * Ziki for the file list or one file; Ziki reads it from GitHub (a private repo only through the workspace's GitHub
 * App) and keeps a record of every read (`SecurityCodeRead`). Agents never get a GitHub key, and access ends the
 * moment the part is reported, given back or timed out. A public repo nobody connected can also just be cloned.
 */

/** At most this many reads per part, and files bigger than this aren't served. */
export const MAX_CODE_READS_PER_PART = 1500;
export const MAX_CODE_FILE_BYTES = 512 * 1024;

export type CodeAnswer = { files: RepoFile[]; truncated: boolean } | { path: string; text: string };

/**
 * The file list (no `path`) or one file of the repo behind a part this agent holds now. Refuses with a
 * SecurityJobError (404 not held, 409 not a repo or not readable, 413 too big, 429 too many reads).
 */
export async function readCodeForPart(agentId: string, itemId: string, path: string | null, deps: { reader?: (owner: string, name: string, access: { installationId: string | null }) => Promise<RepoReader> } = {}): Promise<CodeAnswer> {
  const item = await prisma.securityCheckItem.findUnique({
    where: { id: itemId },
    select: { agentId: true, status: true, kind: true, check: { select: { status: true, organisationId: true, target: { select: { kind: true, value: true } } } } },
  });
  if (!item || item.agentId !== agentId || item.kind !== "check") throw new SecurityJobError(404, "not_found", "No such job is held by this agent.");
  if (item.status !== "checking" || item.check.status !== "checking") throw new SecurityJobError(409, "not_held", "This job is no longer yours: it was reported, given back or timed out.");
  if (item.check.target.kind !== "repo") throw new SecurityJobError(409, "not_a_repo", "This part's target isn't a code repository.");

  const reads = await prisma.securityCodeRead.count({ where: { itemId } });
  if (reads >= MAX_CODE_READS_PER_PART) throw new SecurityJobError(429, "too_many_reads", `A part may read at most ${MAX_CODE_READS_PER_PART} files.`);

  const repo = item.check.target.value;
  const [owner, name] = repo.split("/");
  const access = await privateRepoAccess(prisma, item.check.organisationId, repo);
  const reader = await (deps.reader ?? repoReader)(owner!, name!, { installationId: access?.installationId ?? null });
  const meta = await reader.meta();
  if (meta.status !== "ok") throw new SecurityJobError(409, "not_readable", "Ziki can't read this repo right now. It may be private and not connected through the GitHub App.");

  if (!path) {
    const tree = await reader.tree();
    if (!tree) throw new SecurityJobError(409, "not_readable", "Ziki couldn't list this repo's files just now. Try again.");
    await prisma.securityCodeRead.create({ data: { itemId, agentId, path: "", bytes: 0 } });
    return tree;
  }
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.split("/").some((segment) => segment === ".." || segment === "")) throw new SecurityJobError(400, "bad_path", "Name a file in the repo, like src/app.ts.");
  const text = await reader.file(clean);
  if (text === null) throw new SecurityJobError(404, "no_file", "That file isn't in the repo, or isn't text.");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_CODE_FILE_BYTES) throw new SecurityJobError(413, "too_big", `Files over ${MAX_CODE_FILE_BYTES / 1024} KB aren't served.`);
  await prisma.securityCodeRead.create({ data: { itemId, agentId, path: clean.slice(0, 500), bytes } });
  return { path: clean, text };
}
