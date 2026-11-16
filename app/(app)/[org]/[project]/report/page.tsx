import { notFound, redirect } from "next/navigation";
import { findPublicProject } from "@/lib/public-projects";
import { publicContributePath } from "@/lib/public-project-paths";
export const dynamic = "force-dynamic";
/** Existing shared report links lead to the standalone portal. */
export default async function PublicReportPage({ params, searchParams }: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ org, project: projectSlug }, query] = await Promise.all([params, searchParams]);
  const ref = { orgSlug: org, projectSlug };
  if (!(await findPublicProject(ref, { requireGuestIntake: true }))) notFound();
  const kind = query.type === "problem" || query.type === "improvement" ? query.type : undefined;
  redirect(publicContributePath(ref, kind));
}
