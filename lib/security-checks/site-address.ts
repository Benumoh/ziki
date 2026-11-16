import "server-only";
import { promises as dns } from "node:dns";
import type { PreviewSummary } from "@/lib/security-checks/preview-summary";

/**
 * The site's IP address, for the result's heading (SecurityHeaders, Sucuri and SSL Labs all show it). IPv4 first,
 * like they do. Null when it can't be found in time: the result never waits on it for long.
 */
export async function siteAddress(target: string): Promise<string | null> {
  const host = target.replace(/^https?:\/\//i, "").split(/[/:?#]/)[0];
  if (!host) return null;
  try {
    const found = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 2000)),
    ]);
    return (found.find((entry) => entry.family === 4) ?? found[0])?.address ?? null;
  } catch {
    return null;
  }
}

/** A website's summary with its IP address added; anything else as it is. Every quick scan goes through this, public or inside. */
export async function withSiteAddress(summary: PreviewSummary): Promise<PreviewSummary> {
  return summary.kind === "website" ? { ...summary, ip: await siteAddress(summary.target) } : summary;
}
