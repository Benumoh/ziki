import { notFound } from "next/navigation";
import { PublicMessageBoard } from "@/components/forum/message-board";
import { requireOrg } from "@/lib/project-route";
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
  const { user, organisation } = await requireOrg(org);
  if (!organisation) notFound();

  const [messages, scopes] = await Promise.all([
    listForumMessages({ scope: "org", organisationId: organisation.id }),
    getUserAccessibleScopes(user.id),
  ]);

  return (
    <section className="space-y-6">
      <PublicMessageBoard
        key={`org-${organisation.slug}`}
        scope="org"
        orgSlug={organisation.slug}
        orgName={organisation.name}
        initialMessages={messages}
        organisations={scopes.organisations}
        externalProjects={scopes.externalProjects}
      />
    </section>
  );
}
