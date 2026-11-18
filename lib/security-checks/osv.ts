import type { SecuritySeverity } from "@prisma/client";
import { logger } from "@/lib/logger";
import type { KnownVuln, RepoPackage } from "./repo-scan";

/**
 * Known security holes in packages, from OSV.dev (https://osv.dev): Google's free, open database of advisories
 * (GitHub's, PyPA's, RustSec's and more). No key. `querybatch` says which of up to 1,000 packages have holes; each
 * hole is then read once for its summary, severity and fixed version. Never throws: a failure means "not checked".
 */

const OSV = "https://api.osv.dev/v1";
const TIMEOUT_MS = 8_000;
/** At most this many packages are asked about, and this many holes read in full, per scan. */
const MAX_PACKAGES = 1_000;
const MAX_VULNS_READ = 60;

export type OsvLookup = (packages: readonly RepoPackage[]) => Promise<{ pkg: RepoPackage; vulns: KnownVuln[] }[] | null>;

type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { events?: { fixed?: string }[] }[]; database_specific?: { severity?: string } }[];
};

function severityOf(vuln: OsvVuln): SecuritySeverity {
  const label = (vuln.database_specific?.severity ?? vuln.affected?.find((a) => a.database_specific?.severity)?.database_specific?.severity ?? "").toUpperCase();
  if (label === "CRITICAL") return "critical";
  if (label === "HIGH") return "high";
  if (label === "LOW") return "low";
  return "medium";
}

function fixedFor(vuln: OsvVuln, name: string): string | null {
  for (const affected of vuln.affected ?? []) {
    if (affected.package?.name && affected.package.name.toLowerCase() !== name.toLowerCase()) continue;
    for (const range of affected.ranges ?? []) for (const event of range.events ?? []) if (event.fixed) return event.fixed;
  }
  return null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${OSV}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OSV answered ${response.status}`);
  return (await response.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${OSV}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!response.ok) throw new Error(`OSV answered ${response.status}`);
  return (await response.json()) as T;
}

export const osvLookup: OsvLookup = async (packages) => {
  // The same package at the same version is asked about once.
  const unique = [...new Map(packages.map((pkg) => [`${pkg.ecosystem}:${pkg.name}@${pkg.version}`, pkg])).values()].slice(0, MAX_PACKAGES);
  if (!unique.length) return [];
  try {
    const batch = await post<{ results?: { vulns?: { id: string }[] }[] }>("/querybatch", {
      queries: unique.map((pkg) => ({ package: { name: pkg.name, ecosystem: pkg.ecosystem }, version: pkg.version })),
    });
    const hits = unique.map((pkg, i) => ({ pkg, ids: (batch.results?.[i]?.vulns ?? []).map((v) => v.id) })).filter((hit) => hit.ids.length);
    const ids = [...new Set(hits.flatMap((hit) => hit.ids))].slice(0, MAX_VULNS_READ);
    const details = new Map<string, OsvVuln>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          details.set(id, await get<OsvVuln>(`/vulns/${encodeURIComponent(id)}`));
        } catch {
          // One advisory that can't be read is left out, not guessed.
        }
      }),
    );
    return hits.map(({ pkg, ids: own }) => ({
      pkg,
      vulns: own.flatMap((id) => {
        const vuln = details.get(id);
        if (!vuln) return [];
        // GitHub's id reads better than a bare CVE number.
        const ghsa = [vuln.id, ...(vuln.aliases ?? [])].find((alias) => alias.startsWith("GHSA-"));
        return [{ id: ghsa ?? vuln.id, summary: (vuln.summary ?? "").trim().replace(/\.?$/, "."), severity: severityOf(vuln), fixed: fixedFor(vuln, pkg.name) }];
      }),
    }));
  } catch (error) {
    logger.warn("[security-repo-scan] OSV.dev couldn't be read", error instanceof Error ? error.message : error);
    return null;
  }
};
