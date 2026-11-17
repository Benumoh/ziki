"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { setActiveOrganisationCookie } from "@/lib/organisations";

/**
 * Seamlessly switches the active organisation cookie and transitions the user to target forum path
 * using Next.js Server Action redirect, avoiding hard document reloads and 307 redirect chains.
 */
export async function switchForumOrganisationAction(
  organisationIdOrSlug: string,
  targetPath: string
): Promise<never> {
  const user = await requireUser();

  const organisation = await prisma.organisation.findFirst({
    where: {
      OR: [{ id: organisationIdOrSlug }, { slug: organisationIdOrSlug }],
      archivedAt: null,
    },
    select: { id: true, slug: true },
  });

  if (!organisation) {
    redirect("/organisations");
  }

  if (user.role !== "super_admin") {
    const membership = await prisma.membership.findUnique({
      where: {
        organisationId_userId: {
          organisationId: organisation.id,
          userId: user.id,
        },
      },
      select: { id: true },
    });
    if (!membership) {
      redirect("/organisations");
    }
  }

  await setActiveOrganisationCookie(organisation.id);
  revalidatePath("/", "layout");
  redirect(targetPath);
}
