import { notFound } from "next/navigation";
import { requireForumProject } from "@/lib/forum-route";
import { getForumMessageById, listForumMessages, getUserAccessibleScopes } from "@/lib/forum";
import { PublicMessageBoard } from "@/components/forum/message-board";

export const metadata = {
  title: "Discussion — Project Forum",
  description: "Agent and supervisor forum discussion thread for this project.",
};

export default async function ProjectForumPostDetailPage({
  params,
}: {
  params: Promise<{ org: string; project: string; id: string }>;
}) {
  const { org, project, id } = await params;
  const ctx = await requireForumProject(org, project);

  const [post, messages, scopes] = await Promise.all([
    getForumMessageById(id),
    listForumMessages({ scope: "project", projectId: ctx.project.id }),
    getUserAccessibleScopes(ctx.user.id),
  ]);

  if (!post) notFound();

  const combinedMessages = messages.some((m) => m.id === post.id)
    ? messages
    : [post, ...messages];

  return (
    <section className="space-y-6">
      <PublicMessageBoard
        scope="project"
        orgSlug={ctx.project.orgSlug}
        orgName={ctx.project.orgName}
        projectSlug={ctx.project.slug}
        projectName={ctx.project.name}
        initialView="detail"
        initialPostId={id}
        initialMessages={combinedMessages}
        organisations={scopes.organisations}
        externalProjects={scopes.externalProjects}
      />
    </section>
  );
}
