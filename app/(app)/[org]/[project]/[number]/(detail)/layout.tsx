import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { findProjectIssue, parseIssueNumber } from "@/lib/project-issue";
import { canDeleteTicket } from "@/lib/ticket-deletion";
import { organisationAccessFor } from "@/lib/organisation-access";

/**
 * Decides 404 before anything streams (#291).
 *
 * This route has a loading.tsx, and a loading boundary makes the route
 * stream: once its shell has been sent the status is fixed at 200, so a
 * notFound() thrown later from the page can no longer produce a 404 — it
 * would render "not found" with a success status. A layout renders outside
 * its own segment's loading boundary, so a check here still controls the
 * status. This route group lets the parent [number] boundary catch those
 * 404s. The page keeps its own checks; this only has to run first.
 *
 * An issue numbered here in another project, or in another of the viewer's
 * organisations, is not a 404: the page redirects or offers the switch.
 */
export default async function ProjectIssueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string; project: string; number: string }>;
}) {
  const { org, project, number: rawNumber } = await params;
  const number = parseIssueNumber(rawNumber);
  if (number === null) notFound();
  const lookup = await findProjectIssue(org, project, number);
  if (!lookup) notFound();

  if (lookup.kind === "found" && lookup.issue.isDeleted) {
    // Deleted issues are visible to those who can restore them, and a 404 to
    // everyone else — the same rule the page applies.
    const session = await auth();
    if (!session?.user) notFound();
    const user = await requireUser();
    const access = await organisationAccessFor(user.id, lookup.issue.organisationId, user.role);
    if (!canDeleteTicket(user.role, access.membershipRole)) notFound();
  }

  return children;
}
