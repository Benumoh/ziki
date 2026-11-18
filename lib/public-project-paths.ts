export type PublicProjectRef = { orgSlug: string; projectSlug: string };

export type PublicReportKind = "problem" | "improvement";

export function publicProjectPath(ref: PublicProjectRef): string {
  return `/${encodeURIComponent(ref.orgSlug)}/${encodeURIComponent(ref.projectSlug)}`;
}

export function publicReportPath(ref: PublicProjectRef, kind?: PublicReportKind): string {
  const base = `${publicProjectPath(ref)}/report`;
  return kind ? `${base}?type=${encodeURIComponent(kind)}` : base;
}

export function publicIssuesPath(ref: PublicProjectRef): string {
  return `${publicProjectPath(ref)}/public-issues`;
}

export function publicIssueDetailPath(ref: PublicProjectRef, issueNumber: number): string {
  return `${publicIssuesPath(ref)}/${issueNumber}`;
}

export function publicContributePath(ref: PublicProjectRef, kind?: PublicReportKind): string {
  const base = `${publicProjectPath(ref)}/contribute`;
  return kind ? `${base}?type=${encodeURIComponent(kind)}` : base;
}

export function publicTrackingPath(ref: PublicProjectRef, token: string): string {
  return `${publicProjectPath(ref)}/track/${encodeURIComponent(token)}`;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export type PublicIntakeKind = "report" | "contribute" | "track";

/** Guest-only intake pages nested below the existing public project overview. */
export function publicIntakeSegments(
  path: string,
): (PublicProjectRef & { kind: PublicIntakeKind }) | null {
  const match = /^\/([^/]+)\/([^/]+)\/(report|contribute|track\/[^/]+)\/?$/.exec(path);
  if (!match) return null;
  const orgSlug = decodeSegment(match[1] ?? "");
  const projectSlug = decodeSegment(match[2] ?? "");
  if (!orgSlug || !projectSlug) return null;
  const segment = match[3] ?? "";
  const kind: PublicIntakeKind =
    segment === "contribute"
      ? "contribute"
      : segment === "report"
      ? "report"
      : "track";
  return {
    orgSlug,
    projectSlug,
    kind,
  };
}

/** Public issue browsing pages nested below a public project overview. */
export function publicIssuesSegments(
  path: string,
): (PublicProjectRef & { kind: "public-issues" }) | null {
  const match = /^\/([^/]+)\/([^/]+)\/public-issues(?:\/\d+)?\/?$/.exec(path);
  if (!match) return null;
  const orgSlug = decodeSegment(match[1] ?? "");
  const projectSlug = decodeSegment(match[2] ?? "");
  if (!orgSlug || !projectSlug) return null;
  return {
    orgSlug,
    projectSlug,
    kind: "public-issues",
  };
}
