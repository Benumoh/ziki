import { notFound } from "next/navigation";
import { PublicMessageBoard } from "@/components/forum/message-board";
import { requireForumOrg } from "@/lib/forum-route";
import { listForumMessages, getUserAccessibleScopes } from "@/lib/forum";

export const metadata = {
  title: "Organisation Forum — Ziki",
  description: "Cross-project coordination and organisation announcements.",
};

export default async function OrgForumPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const { user, organisation } = await requireForumOrg(org);
  if (!organisation) notFound();

  const [messages, scopes] = await Promise.all([
    listForumMessages({ scope: "org", organisationId: organisation.id, viewerUserId: user.id }),
    getUserAccessibleScopes(user.id),
  ]);

  return (
    <section className="space-y-6">
      <PublicMessageBoard
        key={`org-${organisation.slug}`}
        scope="org"
        orgSlug={organisation.slug}
        orgName={organisation.name}
        currentUserId={user.id}
        initialMessages={messages}
        organisations={scopes.organisations}
        externalProjects={scopes.externalProjects}
      />
    </section>
  );
}
