import { ProjectFeedbackPortal, type FeedbackSearch } from "@/components/project-feedback-portal";
import { findPublicProject } from "@/lib/public-projects";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata = { title: "Project feedback" };
export default async function PublicIssuesPage({ params, searchParams }: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<FeedbackSearch>;
}) {
  const [{ org, project }, search] = await Promise.all([params, searchParams]);
  const ref = { orgSlug: org, projectSlug: project };
  if (!await findPublicProject(ref)) notFound();
  return <ProjectFeedbackPortal projectRef={ref} search={search} />;
}
