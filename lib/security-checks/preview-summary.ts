import type { SecuritySeverity, SecurityTargetKind } from "@prisma/client";
import type { PreviewArea, PreviewResult } from "./preview";

/**
 * What a quick scan may show before a site is proven to be the client's
 * (#security-checks, 12 Nov plan): the areas looked at, how many problems each
 * has, the counts by severity and an overall risk. Never a finding's title or
 * detail: those stay on the server until ownership is proven, so they can't be
 * read from the page's HTML or network traffic.
 */

export type PreviewRisk = "minimal" | "low" | "medium" | "high" | "critical";

export const PREVIEW_AREA_ORDER: PreviewArea[] = ["https", "certificate", "headers", "cookies", "email", "secrets", "policy", "updates"];

export const PREVIEW_AREA_LABEL: Record<PreviewArea, string> = {
  https: "HTTPS",
  certificate: "Certificate",
  headers: "Security headers",
  cookies: "Cookies",
  email: "Email settings",
  secrets: "Secrets in files",
  policy: "Security policy",
  updates: "Dependency updates",
};

export const PREVIEW_RISK_LABEL: Record<PreviewRisk, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export type PreviewSummary = {
  kind: SecurityTargetKind;
  target: string;
  checkedAt: string;
  total: number;
  counts: Record<SecuritySeverity, number>;
  risk: PreviewRisk;
  /** Each area looked at, in a fixed order, with how many problems it has. */
  areas: { area: PreviewArea; label: string; problems: number }[];
};

export function previewRisk(counts: Record<SecuritySeverity, number>): PreviewRisk {
  if (counts.critical > 0) return "critical";
  if (counts.high > 0) return "high";
  if (counts.medium > 0) return "medium";
  if (counts.low > 0) return "low";
  return "minimal";
}

/** The shown part of a quick scan: counts only, never what was found. */
export function summarisePreview(result: Extract<PreviewResult, { ok: true }>): PreviewSummary {
  const problemsIn = (area: PreviewArea) => result.findings.filter((finding) => finding.area === area).length;
  const looked = new Set(result.checked);
  return {
    kind: result.kind,
    target: result.target,
    checkedAt: result.checkedAt,
    total: result.findings.length,
    counts: { ...result.counts },
    risk: previewRisk(result.counts),
    areas: PREVIEW_AREA_ORDER.filter((area) => looked.has(area)).map((area) => ({ area, label: PREVIEW_AREA_LABEL[area], problems: problemsIn(area) })),
  };
}
