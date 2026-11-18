import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrgFeedbackPortal } from "@/components/org-feedback-portal";
import { listOrgFeedbackProjects } from "@/lib/public-projects";
import { NOINDEX } from "@/lib/seo/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share feedback", robots: NOINDEX };

export default async function OrganisationFeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ org }, query] = await Promise.all([params, searchParams]);
  const data = await listOrgFeedbackProjects(org);
  if (!data) notFound();

  return (
    <OrgFeedbackPortal
      orgSlug={data.organisation.slug}
      orgName={data.organisation.name}
      projects={data.projects}
      initialQuery={(query.q ?? "").trim()}
    />
  );
}
