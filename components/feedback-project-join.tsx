import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { optionalUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { canContributeToProject } from "@/lib/project-permissions";
import { issuesPath, projectRef } from "@/lib/project-paths";
import { FeedbackPageHeader } from "@/components/feedback-page-header";
import { ProjectJoinRequestButton } from "@/components/project-join-request-button";
import { FeedbackOpenProjectJoin } from "@/components/feedback-open-project-join";
import { feedbackTextLink } from "@/components/feedback-portal-styles";
export async function FeedbackProjectJoin({ orgSlug, projectSlug }: { orgSlug: string; projectSlug: string }) {
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, visibility: "public", archivedAt: null, organisation: { slug: orgSlug, archivedAt: null } },
    select: { id: true, name: true, organisationId: true, isOpenForContributors: true, contributorGuidelines: true },
  });
  if (!project) notFound();
  const feedbackHref = `/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/feedback`;
  const user = await optionalUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(feedbackHref + "?view=join")}`);
  const member = await canContributeToProject(user, project.id, project.organisationId);
  const request = member ? null : await prisma.projectJoinRequest.findUnique({ where: { projectId_userId: { projectId: project.id, userId: user.id } }, select: { status: true } });
  return <div className="space-y-3 pb-6"><FeedbackPageHeader title={`Contribute to ${project.name}`} identity={project.name} description="Join the project you shared feedback about." /><section className="space-y-4 rounded-panel border border-zk-border bg-zk-surface p-5">
    {member ? <><p className="text-sm text-zk-text2">You already have access to this project.</p><Link href={issuesPath(projectRef(orgSlug, projectSlug), "your_work")} className={feedbackTextLink}>Open project →</Link></> : project.isOpenForContributors ? <><p className="text-sm text-zk-text2">This public project is open for contributors. You can join immediately.</p><FeedbackOpenProjectJoin projectId={project.id} /></> : <><p className="text-sm text-zk-text2">Send a request to this project&apos;s owners and admins. They will approve or decline it.</p><div className="flex justify-start"><ProjectJoinRequestButton project={project} state={request?.status === "pending" ? "pending" : request?.status === "rejected" ? "rejected" : "none"} size="md" /></div></>}
    <Link href={feedbackHref} className={feedbackTextLink}>Back to product</Link>
  </section></div>;
}
