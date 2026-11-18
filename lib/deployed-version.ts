import { cleanEnv } from "@/lib/env-clean";
import packageJson from "../package.json";

/** The deployed commit when the platform exposes one (#539). */
export function deployedCommit(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    cleanEnv(env.SOURCE_COMMIT) ??
    cleanEnv(env.VERCEL_GIT_COMMIT_SHA) ??
    cleanEnv(env.GIT_COMMIT) ??
    undefined
  );
}

/**
 * The version shown in the app's footer: prefers build-time `NEXT_PUBLIC_APP_VERSION`
 * / `APP_VERSION` (derived from Git history in `next.config.ts`), or appends the short
 * deployed commit SHA to `package.json`'s base version so pull requests do not need
 * to edit `package.json` and conflict with each other on merge.
 */
export function appVersionLabel(
  env: NodeJS.ProcessEnv = process.env,
  baseVersion: string = packageJson.version,
): string {
  const explicit = cleanEnv(env.NEXT_PUBLIC_APP_VERSION) ?? cleanEnv(env.APP_VERSION);
  if (explicit) {
    return explicit.startsWith("v") ? explicit : `v${explicit}`;
  }
  const commit = deployedCommit(env);
  if (commit) {
    return `v${baseVersion}+${commit.slice(0, 7)}`;
  }
  return `v${baseVersion}`;
}
