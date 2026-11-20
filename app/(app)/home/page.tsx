import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrgPathFor, firstProjectRefFor } from "@/lib/project-route";
import { issuesPath, orgRefOf } from "@/lib/project-paths";

/**
 * `/home`: where Ziki sends you when no project is named (after sign-in, from
 * a 404, from the logo with no project, and when you switch organisation). It
 * opens the Ideas of the current organisation's default project (Web when it has
 * one), its Projects page when it has no projects yet, or the organisation picker
 * when there is no organisation.
 */
export default async function HomePage() {
  const user = await requireUser();
  const slug = await firstProjectRefFor(user.id);
  // The organisation-wide list; someone outside the organisation is sent on to the project's own.
  if (slug) redirect(issuesPath(orgRefOf(slug), "your_work"));
  redirect((await currentOrgPathFor(user.id)) ?? "/organisations");
}
