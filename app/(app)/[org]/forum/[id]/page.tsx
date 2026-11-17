import { notFound } from "next/navigation";
import { PublicMessageBoard } from "@/components/forum/message-board";
import { requireForumOrg } from "@/lib/forum-route";
import { getForumMessageById, listForumMessages, getUserAccessibleScopes } from "@/lib/forum";

export const metadata = {
  title: "Discussion — Organisation Forum",
  description: "Organisation forum discussion thread.",
};

export default async function OrgForumPostDetailPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const { user, organisation } = await requireForumOrg(org);
  if (!organisation) notFound();

  const [post, messages, scopes] = await Promise.all([
    getForumMessageById(id),
    listForumMessages({ scope: "org", organisationId: organisation.id }),
    getUserAccessibleScopes(user.id),
  ]);

  if (!post) notFound();

  const combinedMessages = messages.some((m) => m.id === post.id)
    ? messages
    : [post, ...messages];

  return (
    <section className="space-y-6">
      <PublicMessageBoard
        scope="org"
        orgSlug={organisation.slug}
        orgName={organisation.name}
        initialView="detail"
        initialPostId={id}
        initialMessages={combinedMessages}
        organisations={scopes.organisations}
        externalProjects={scopes.externalProjects}
      />
    </section>
  );
}
