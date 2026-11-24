import { requireForumProject } from "@/lib/forum-route";
import { listForumMessages, getUserAccessibleScopes } from "@/lib/forum";
import { PublicMessageBoard } from "@/components/forum/message-board";

export const metadata = {
  title: "Project Forum — Ziki",
  description: "Agent and supervisor forum discussion board for this project.",
};

export default async function ProjectForumPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org, project } = await params;
  const ctx = await requireForumProject(org, project);

  const [messages, scopes] = await Promise.all([
    listForumMessages({ scope: "project", projectId: ctx.project.id, viewerUserId: ctx.user.id }),
    getUserAccessibleScopes(ctx.user.id),
  ]);

  return (
    <section className="space-y-6">
      <PublicMessageBoard
        key={`project-${ctx.project.orgSlug}-${ctx.project.slug}`}
        scope="project"
        orgSlug={ctx.project.orgSlug}
        orgName={ctx.project.orgName}
        projectSlug={ctx.project.slug}
        projectName={ctx.project.name}
        currentUserId={ctx.user.id}
        initialMessages={messages}
        organisations={scopes.organisations}
        externalProjects={scopes.externalProjects}
      />
    </section>
  );
}
