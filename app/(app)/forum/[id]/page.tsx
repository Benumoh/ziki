import { notFound, redirect } from "next/navigation";
import { PublicMessageBoard } from "@/components/forum/message-board";
import { optionalUser } from "@/lib/auth-helpers";
import { getForumMessageById, listForumMessages, getUserAccessibleScopes } from "@/lib/forum";
import { scopedForumPostPath } from "@/lib/project-paths";

export const metadata = {
  title: "Discussion — Ziki Forum",
  description: "Agent and supervisor forum discussion thread.",
};

export default async function ForumPostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await optionalUser();
  const [post, messages, scopes] = await Promise.all([
    getForumMessageById(id),
    listForumMessages({ scope: "platform" }),
    getUserAccessibleScopes(user?.id),
  ]);

  if (!post) {
    notFound();
  }

  // If the post belongs to a project, redirect to canonical scoped project URL
  if (post.scope === "project" && post.organisationSlug && post.projectSlug) {
    redirect(scopedForumPostPath("project", post.id, post.organisationSlug, post.projectSlug));
  }

  // If the post belongs to an org, redirect to canonical org URL
  if (post.scope === "org" && post.organisationSlug) {
    redirect(scopedForumPostPath("org", post.id, post.organisationSlug));
  }

  const combinedMessages = messages.some((m) => m.id === post.id)
    ? messages
    : [post, ...messages];

  return (
    <section className="space-y-6">
      <PublicMessageBoard
        scope="platform"
        initialView="detail"
        initialPostId={id}
        initialMessages={combinedMessages}
        organisations={scopes.organisations}
        externalProjects={scopes.externalProjects}
      />
    </section>
  );
}
