import type { SecuritySeverity } from "@prisma/client";
import type { PreviewFinding } from "./preview";

/**
 * The repo quick scan's rules (#security-repo-scan, 18 Nov): what Ziki itself reads in seconds, with no agents. For a
 * public repo it reads what any visitor to github.com can open; for a private repo only through the workspace's
 * GitHub App (repo-reader.ts). It reads a few kinds of file, never runs anything, and never repeats a secret it sees.
 *
 * - **Dependencies:** the versions in lockfiles and manifests, looked up in OSV.dev (osv.ts).
 * - **Workflows:** risky patterns in `.github/workflows/*.yml`.
 * - **Secrets:** files that usually hold secrets, anywhere in the repo, and the shapes of real keys in config files.
 * - **Hygiene:** a security policy, an update bot, a lockfile, recent activity.
 * - **GitHub's own alerts:** open Dependabot alerts, when the App may read them (private repos).
 */

export type RepoFile = { path: string; size: number };

/** One package at one version, as OSV.dev names its ecosystems. */
export type RepoPackage = { ecosystem: "npm" | "PyPI" | "Go" | "crates.io" | "RubyGems" | "Packagist"; name: string; version: string; from: string };

// ---------------------------------------------------------------------------
// Which files are read

/** Files that usually hold real secrets: a repo should never publish them. Examples and templates are fine. */
export const SECRET_FILE = /(^|\/)(\.env(\.(local|production|prod|development|staging))?|id_(rsa|dsa|ecdsa|ed25519)|credentials\.json|service-?account[\w-]*\.json|\.htpasswd|\.netrc|[^/]+\.(pem|key|p12|pfx|jks|keystore))$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|requirements[\w.-]*\.txt|go\.mod|Cargo\.lock|Gemfile\.lock|composer\.lock)$/;
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|Pipfile|Gemfile|Cargo\.toml|composer\.json|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml)$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
/** Config files worth reading for keys: small text files with settings in them. */
const CONFIG_FILE = /(^|\/)([^/]*\.(env\.[\w.-]+|json|ya?ml|toml|ini|cfg|conf|properties|xml)|[^/]*(config|settings|secrets?|credentials)[^/]*\.(js|mjs|cjs|ts|py|rb|php|go))$/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|\.next|coverage|fixtures?|__tests__|tests?|testdata|examples?|docs?)\//i;
const EXAMPLE_FILE = /(example|sample|template|dist|mock|fake|dummy|test)/i;
const SECURITY_POLICY = /(^|\/)security\.(md|markdown|txt)$/i;
const UPDATE_BOT = /^(\.github\/dependabot\.ya?ml|renovate\.json5?|\.renovaterc(\.json5?)?|\.github\/renovate\.json5?)$/i;

/** At most this many files are opened in one quick scan, and none bigger than this. */
export const MAX_FILES_READ = 40;
export const MAX_FILE_BYTES = 512 * 1024;

/** The files the quick scan opens, most useful first, within the limits. */
export function filesToRead(tree: readonly RepoFile[]): { lockfiles: string[]; workflows: string[]; configs: string[] } {
  const small = tree.filter((file) => file.size <= MAX_FILE_BYTES);
  // Lockfiles at the top of the repo or one folder down; a monorepo's packages each have their own.
  const lockfiles = small.filter((file) => LOCKFILE.test(file.path) && !SKIP_DIR.test(file.path) && file.path.split("/").length <= 3).map((file) => file.path);
  // A package.json is read only where there is no lockfile beside it, for its exact versions.
  const lockDirs = new Set(lockfiles.map((path) => path.replace(/[^/]*$/, "")));
  const manifests = small.filter((file) => /(^|\/)package\.json$/.test(file.path) && !SKIP_DIR.test(file.path) && !lockDirs.has(file.path.replace(/[^/]*$/, "")) && file.path.split("/").length <= 3).map((file) => file.path);
  const workflows = small.filter((file) => WORKFLOW.test(file.path)).map((file) => file.path);
  const configs = small
    .filter((file) => CONFIG_FILE.test(file.path) && !WORKFLOW.test(file.path) && !SKIP_DIR.test(file.path) && !EXAMPLE_FILE.test(file.path) && !LOCKFILE.test(file.path) && !MANIFEST.test(file.path) && file.size > 0 && file.size <= 128 * 1024)
    .map((file) => file.path)
    .sort((a, b) => a.split("/").length - b.split("/").length);
  let left = MAX_FILES_READ;
  const take = (list: string[]) => {
    const picked = list.slice(0, Math.max(0, left));
    left -= picked.length;
    return picked;
  };
  return { lockfiles: take([...lockfiles, ...manifests]), workflows: take(workflows), configs: take(configs) };
}

// ---------------------------------------------------------------------------
// Dependencies

const clean = (version: string) => version.trim().replace(/^[v=^~>< ]+/, "");
const exact = (version: string) => /^\d+(\.\d+){0,3}([-+][\w.-]+)?$/.test(version);

/** The packages and versions a lockfile or manifest names. Ranges that aren't one exact version are skipped. */
export function packagesIn(path: string, text: string): RepoPackage[] {
  const out: RepoPackage[] = [];
  const add = (ecosystem: RepoPackage["ecosystem"], name: string, version: string) => {
    const v = clean(version);
    if (name && exact(v)) out.push({ ecosystem, name, version: v, from: path });
  };
  const file = path.split("/").pop() ?? path;
  try {
    if (file === "package-lock.json") {
      const lock = JSON.parse(text) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
      for (const [key, value] of Object.entries(lock.packages ?? {})) {
        if (!key) continue;
        add("npm", key.replace(/^.*node_modules\//, ""), value.version ?? "");
      }
      if (!lock.packages) for (const [name, value] of Object.entries(lock.dependencies ?? {})) add("npm", name, value.version ?? "");
    } else if (file === "package.json") {
      const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) add("npm", name, version);
    } else if (/^requirements[\w.-]*\.txt$/.test(file)) {
      for (const line of text.split(/\r?\n/)) {
        const match = line.trim().match(/^([A-Za-z0-9_.\-[\]]+?)(\[[^\]]*\])?\s*==\s*([^\s;#]+)/);
        if (match) add("PyPI", match[1]!.toLowerCase(), match[3]!);
      }
    } else if (file === "go.mod") {
      for (const match of text.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+v([\d][^\s]*)/gm)) add("Go", match[1]!, match[2]!);
    } else if (file === "Cargo.lock") {
      for (const match of text.matchAll(/\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g)) add("crates.io", match[1]!, match[2]!);
    } else if (file === "Gemfile.lock") {
      for (const match of text.matchAll(/^ {4}([A-Za-z0-9_.-]+) \(([\d][^)]*)\)$/gm)) add("RubyGems", match[1]!, match[2]!);
    } else if (file === "composer.lock") {
      const lock = JSON.parse(text) as { packages?: { name?: string; version?: string }[]; "packages-dev"?: { name?: string; version?: string }[] };
      for (const item of [...(lock.packages ?? []), ...(lock["packages-dev"] ?? [])]) add("Packagist", item.name ?? "", item.version ?? "");
    }
  } catch {
    // A file that doesn't parse is skipped, never guessed at.
  }
  return out;
}

/** One known hole in one package, as OSV.dev describes it. */
export type KnownVuln = { id: string; summary: string; severity: SecuritySeverity; fixed: string | null };

/** "lodash 4.17.15 has 3 known security holes", one finding per package, at its worst hole's severity. */
export function dependencyFindings(vulnerable: ReadonlyArray<{ pkg: RepoPackage; vulns: KnownVuln[] }>): PreviewFinding[] {
  const order: SecuritySeverity[] = ["critical", "high", "medium", "low"];
  return vulnerable
    .filter(({ vulns }) => vulns.length > 0)
    .map(({ pkg, vulns }) => {
      const worst = [...vulns].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))[0]!;
      const fixed = vulns.map((v) => v.fixed).filter((v): v is string => Boolean(v)).sort(compareVersions).pop() ?? null;
      const ids = vulns.slice(0, 3).map((v) => v.id).join(", ");
      return {
        id: `dependency:${pkg.ecosystem}:${pkg.name.toLowerCase()}`,
        severity: worst.severity,
        area: "dependencies" as const,
        title: `${pkg.name} ${pkg.version} has ${vulns.length === 1 ? "a known security hole" : `${vulns.length} known security holes`}`,
        detail:
          `${pkg.from} uses ${pkg.name} ${pkg.version}. ${worst.summary || "A published security advisory covers this version."} ` +
          `(${ids}${vulns.length > 3 ? " and more" : ""}).${fixed ? ` Upgrading to ${fixed} or later fixes ${vulns.length === 1 ? "it" : "them"}.` : ""}`,
      };
    });
}

/** Loose version order, enough to pick the highest "fixed in". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  const pb = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number.isNaN(pa[i] ?? 0) ? 0 : (pa[i] ?? 0);
    const y = Number.isNaN(pb[i] ?? 0) ? 0 : (pb[i] ?? 0);
    if (x !== y) return x - y;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Workflows

/** Values anyone can set (a PR title, a branch name, a comment) that a `run:` step mustn't paste into a shell. */
const UNTRUSTED_INPUT = /\$\{\{\s*(github\.event\.(issue|pull_request|comment|review|review_comment|discussion|head_commit|commits|pages|workflow_run)\.[\w.[\]*]*(title|body|name|label|message|ref|email|head_ref|default_branch)|github\.head_ref)\s*\}\}/i;

export function workflowFindings(path: string, text: string): PreviewFinding[] {
  const out: PreviewFinding[] = [];
  const name = path.split("/").pop() ?? path;
  const lines = text.split(/\r?\n/);

  // Untrusted text pasted into a shell command: anyone opening a PR or issue can run their own commands.
  let inRun = false;
  let runIndent = 0;
  let injected = false;
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (/^-?\s*run:/.test(trimmed)) {
      inRun = true;
      runIndent = indent;
      if (UNTRUSTED_INPUT.test(trimmed)) injected = true;
      continue;
    }
    if (inRun && trimmed && indent <= runIndent) inRun = false;
    if (inRun && UNTRUSTED_INPUT.test(trimmed)) injected = true;
  }
  if (injected) {
    out.push({
      id: `workflow-injection:${name.toLowerCase()}`,
      severity: "high",
      area: "workflows",
      title: `A workflow pastes text anyone can write into a shell command (${name})`,
      detail: `${path} puts a pull request's or issue's title, body or branch name straight into a "run:" command. Someone can name a PR so that it runs their own commands in your CI, with your workflow's access.`,
    });
  }

  // pull_request_target runs with the repo's secrets; checking out the stranger's code there hands it those secrets.
  if (/^\s*pull_request_target\s*:/m.test(text) && /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(sha|ref)/.test(text)) {
    out.push({
      id: `workflow-prt-checkout:${name.toLowerCase()}`,
      severity: "critical",
      area: "workflows",
      title: `A workflow runs strangers' pull request code with the repo's secrets (${name})`,
      detail: `${path} uses pull_request_target, which runs with your secrets and write access, and checks out the pull request's own code. Anyone opening a PR can run code that reads those secrets.`,
    });
  }

  // write-all hands every step every permission.
  if (/^\s*permissions\s*:\s*write-all\s*$/m.test(text)) {
    out.push({
      id: `workflow-write-all:${name.toLowerCase()}`,
      severity: "medium",
      area: "workflows",
      title: `A workflow gives every step full write access (${name})`,
      detail: `${path} sets "permissions: write-all", so any step or action it runs can push code, change releases and more. Give each job only what it needs.`,
    });
  }

  // Outside actions pinned to a tag or branch can change under you; a full commit SHA can't.
  const unpinned = [...text.matchAll(/^\s*-?\s*uses:\s*([\w.-]+)\/([\w.\-/]+)@([\w.\-/]+)/gm)]
    .filter(([, owner, , ref]) => !/^(actions|github)$/i.test(owner!) && !/^[0-9a-f]{40}$/i.test(ref!))
    .map(([, owner, repo, ref]) => `${owner}/${repo}@${ref}`);
  if (unpinned.length) {
    out.push({
      id: `workflow-unpinned:${name.toLowerCase()}`,
      severity: "low",
      area: "workflows",
      title: `A workflow uses outside actions that aren't pinned (${name})`,
      detail: `${path} runs ${[...new Set(unpinned)].slice(0, 3).join(", ")}${unpinned.length > 3 ? " and more" : ""} by tag, not by commit. If one of them is taken over, the new code runs in your CI. Pin each to a full commit SHA.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Secrets

/** The shapes of real keys. The match itself is never shown or stored: only what kind it is and where. */
const KEY_PATTERNS: { kind: string; pattern: RegExp; severity: SecuritySeverity }[] = [
  { kind: "a private key", pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/, severity: "critical" },
  { kind: "an AWS access key", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, severity: "critical" },
  { kind: "a GitHub token", pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/, severity: "critical" },
  { kind: "a Stripe live secret key", pattern: /\b(sk|rk)_live_[0-9A-Za-z]{20,}\b/, severity: "critical" },
  { kind: "a Slack token", pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/, severity: "high" },
  { kind: "a Slack webhook", pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/, severity: "medium" },
  { kind: "a SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, severity: "high" },
  { kind: "an OpenAI or Anthropic API key", pattern: /\bsk-(proj-|ant-api\d\d-)?[A-Za-z0-9_-]{32,}\b/, severity: "critical" },
  { kind: "a database address with a password in it", pattern: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^:\s/@]+:[^@\s/]{4,}@(?!localhost|127\.0\.0\.1|db\b|postgres\b|mysql\b|redis\b)/i, severity: "high" },
];

export function secretFindings(path: string, text: string): PreviewFinding[] {
  const seen = new Set<string>();
  const out: PreviewFinding[] = [];
  for (const { kind, pattern, severity } of KEY_PATTERNS) {
    if (seen.has(kind) || !pattern.test(text)) continue;
    seen.add(kind);
    out.push({
      id: `secret-key:${path.toLowerCase()}:${kind}`,
      severity,
      area: "secrets",
      title: `${kind[0]!.toUpperCase()}${kind.slice(1)} is written in ${path}`,
      detail: `${path} contains what looks like ${kind}. Anyone who can read the repo can use it. Change (rotate) it now, then remove it from the code and its history.`,
    });
  }
  return out;
}

export function secretFileFindings(value: string, tree: readonly RepoFile[]): PreviewFinding[] {
  return tree
    .filter((file) => SECRET_FILE.test(file.path) && !EXAMPLE_FILE.test(file.path.split("/").pop() ?? "") && !SKIP_DIR.test(file.path))
    .slice(0, 10)
    .map((file) => ({
      id: `secret-file:${file.path.toLowerCase()}`,
      severity: "high" as const,
      area: "secrets" as const,
      title: `A file that usually holds secrets is in the repo: ${file.path}`,
      detail: `${value} has a file named ${file.path}. If it holds real keys or passwords, anyone who can read the repo can use them, so remove it and change them.`,
    }));
}

// ---------------------------------------------------------------------------
// Hygiene

export function hygieneFindings(value: string, tree: readonly RepoFile[], pushedAt: string | null, now: number): PreviewFinding[] {
  const paths = tree.map((file) => file.path);
  const out: PreviewFinding[] = [];
  if (!paths.some((path) => SECURITY_POLICY.test(path) && path.split("/").length <= 2)) {
    out.push({ id: "no-security-policy", severity: "low", area: "policy", title: "The repo has no security policy", detail: `${value} has no SECURITY.md, so a person who finds a problem doesn't know how to report it privately.` });
  }
  const hasDependencies = paths.some((path) => MANIFEST.test(path) && path.split("/").length <= 2);
  if (hasDependencies && !paths.some((path) => UPDATE_BOT.test(path))) {
    out.push({ id: "no-dependency-updates", severity: "low", area: "updates", title: "Nothing keeps the repo's dependencies up to date", detail: `${value} has no Dependabot or Renovate setup, so known problems in its packages can sit there unnoticed.` });
  }
  if (paths.includes("package.json") && !paths.some((path) => /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(path))) {
    out.push({ id: "no-lockfile", severity: "low", area: "updates", title: "The repo doesn't lock its package versions", detail: `${value} has a package.json but no lockfile, so each install can pull different (and possibly bad) versions.` });
  }
  if (pushedAt && now - Date.parse(pushedAt) > 365 * 24 * 60 * 60 * 1000) {
    out.push({ id: "stale-repo", severity: "low", area: "updates", title: "The repo hasn't changed in over a year", detail: `${value} was last updated on ${pushedAt.slice(0, 10)}. Security fixes in its packages since then haven't been taken in.` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GitHub's own Dependabot alerts (private repos, through the App)

export type DependabotAlert = { package: string; ecosystem: string; severity: string; summary: string; manifest: string; fixed: string | null };

export function dependabotFindings(alerts: readonly DependabotAlert[]): PreviewFinding[] {
  const sev = (value: string): SecuritySeverity => (value === "critical" ? "critical" : value === "high" ? "high" : value === "low" ? "low" : "medium");
  const byPackage = new Map<string, DependabotAlert[]>();
  for (const alert of alerts) byPackage.set(`${alert.ecosystem}:${alert.package}`, [...(byPackage.get(`${alert.ecosystem}:${alert.package}`) ?? []), alert]);
  const order: SecuritySeverity[] = ["critical", "high", "medium", "low"];
  return [...byPackage.values()].map((list) => {
    const worst = [...list].sort((a, b) => order.indexOf(sev(a.severity)) - order.indexOf(sev(b.severity)))[0]!;
    return {
      id: `dependency:${worst.ecosystem}:${worst.package.toLowerCase()}`,
      severity: sev(worst.severity),
      area: "dependencies" as const,
      title: `GitHub flags ${worst.package}: ${list.length === 1 ? "a known security hole" : `${list.length} known security holes`}`,
      detail: `GitHub's Dependabot has an open alert for ${worst.package} in ${worst.manifest}: ${worst.summary}.${worst.fixed ? ` Upgrading to ${worst.fixed} or later fixes it.` : ""}`,
    };
  });
}
