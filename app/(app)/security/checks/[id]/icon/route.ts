import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { prisma } from "@/lib/prisma";
import { siteIcon } from "@/lib/security-checks/site-icon";

/**
 * A website target's own icon for the Targets list (#security-checks). Only for a target in the
 * person's own workspace: the server finds the icon the site declares (lib/security-checks/
 * site-icon.ts) and serves it from ziki.dev. 404 when there's none, so the list shows the globe.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) return new Response(null, { status: 404 });
  const check = await prisma.securityCheck.findFirst({
    where: { id, organisationId: access.organisationId },
    select: { target: { select: { kind: true, value: true } } },
  });
  if (!check || check.target.kind !== "website") return new Response(null, { status: 404 });
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//i.test(check.target.value) ? check.target.value : `https://${check.target.value}`).hostname;
  } catch {
    return new Response(null, { status: 404 });
  }
  const icon = await siteIcon(host);
  if (!icon) return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
  return new Response(new Uint8Array(icon.body), {
    headers: {
      "Content-Type": icon.type,
      "Cache-Control": "private, max-age=86400",
      // Someone else's file, shown only as a picture: never run as a page.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
