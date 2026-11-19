import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/base-path";
import { resolveSessionUserId } from "@/lib/session-user";
import { setActiveOrganisationCookie } from "@/lib/organisations";
import { issuesPath, refOf } from "@/lib/project-paths";

/** A relative Location, so the browser stays on the host it asked (see notifications/[id]/route.ts, #416). */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: `${BASE_PATH}${path}` } });
}

/** Only an address inside the app: one path, no scheme or host. */
function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}

/**
 * Opens a project in another of the viewer's organisations (#project-urls): when
 * `/<org>/<project>/…` names a project outside the current organisation,
 * lib/project-route.ts sends the request here. It checks the viewer belongs to
 * that organisation, is a direct project member, or the project is public, makes that organisation current, and
 * goes back to `next`. The project itself always comes from the URL's slug.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  // A link prefetch or in-app navigation (an RSC request) followed a project
  // page's redirect here. It must not switch organisation: a prefetch would
  // switch it silently, and a navigation that switches mid-request renders a
  // blank page. Plain text tells the client router to load this address as a
  // full page instead, which switches and goes on to `next` cleanly.
  if (request.headers.get("rsc") === "1") {
    return new NextResponse("Opening project…", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const { slug } = await params;
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) return redirectTo("/login");

  const url = new URL(request.url);
  const organisationId = url.searchParams.get("organisation") ?? "";
  const user = await prisma.user.findUnique({ where: { id: resolved.userId }, select: { role: true } });
  const targetProject = await prisma.project.findFirst({
    where: { organisationId, slug, archivedAt: null, organisation: { archivedAt: null } },
    select: { id: true, slug: true, visibility: true, organisation: { select: { slug: true } } },
  });

  if (!targetProject) return redirectTo("/");

  const isSuper = user?.role === "super_admin";
  const isOrgMember = Boolean(
    await prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId, userId: resolved.userId } },
      select: { id: true },
    }),
  );
  const isProjectMember = Boolean(
    await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId: targetProject.id, userId: resolved.userId } },
      select: { id: true },
    }),
  );
  const isPublic = targetProject.visibility === "public";

  if (!isSuper && !isOrgMember && !isProjectMember && !isPublic) {
    return redirectTo("/");
  }

  if (isOrgMember || isSuper) {
    await setActiveOrganisationCookie(organisationId);
  }
  return redirectTo(safeNext(url.searchParams.get("next"), issuesPath(refOf(targetProject), "your_work")));
}
