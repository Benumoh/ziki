import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import { FeedbackPortalShell } from "@/components/feedback-portal-shell";
export default async function SubmissionsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  const organisation = organisationId ? await prisma.organisation.findUnique({ where: { id: organisationId }, select: { slug: true, name: true } }) : null;
  return <FeedbackPortalShell orgSlug={organisation?.slug ?? null} orgName={organisation?.name ?? null} name={user.name ?? "Account"}>{children}</FeedbackPortalShell>;
}
