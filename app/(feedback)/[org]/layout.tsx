import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { FeedbackPortalShell } from "@/components/feedback-portal-shell";
export default async function OrganisationFeedbackLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [session, organisation] = await Promise.all([auth(), prisma.organisation.findFirst({ where: { slug: org, archivedAt: null }, select: { slug: true, name: true } })]);
  if (!organisation) notFound();
  return <FeedbackPortalShell orgSlug={organisation.slug} orgName={organisation.name} name={session?.user ? session.user.name ?? "Account" : null}>{children}</FeedbackPortalShell>;
}
