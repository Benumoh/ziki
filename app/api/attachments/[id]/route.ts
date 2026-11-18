import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { attachmentResponseHeaders } from "@/lib/attachments";
import { organisationAccessFor } from "@/lib/organisation-access";
import { canViewFinding } from "@/lib/security-findings";

/**
 * Serve an attachment (#215) to signed-in users. Files on a deleted issue
 * are admin-only (like the issue); files not yet linked to anything are only
 * visible to the person who uploaded them.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      uploaderId: true,
      filename: true,
      contentType: true,
      size: true,
      data: true,
      bug: { select: { isDeleted: true, organisationId: true, projectId: true, project: { select: { visibility: true } } } },
      idea: { select: { isDeleted: true, organisationId: true, projectId: true, project: { select: { visibility: true } } } },
      comment: { select: { bug: { select: { organisationId: true, isDeleted: true, projectId: true, project: { select: { visibility: true } } } } } },
      redesignProposal: { select: { organisationId: true } },
      securityFinding: { select: { organisationId: true, reporterId: true, disclosedAt: true } },
    },
  });

  const notFound = () => NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!attachment) return notFound();
  // #security-findings: evidence on a private finding, only for who may see the finding.
  const finding = attachment.securityFinding;
  if (finding && !finding.disclosedAt) {
    const access = await organisationAccessFor(user.id, finding.organisationId, user.role);
    const member = access.membershipRole !== null;
    if (!canViewFinding(finding, { kind: "person", userId: user.id, organisationId: member ? finding.organisationId : null, organisationAdmin: access.admin })) {
      return notFound();
    }
    return new NextResponse(new Uint8Array(attachment.data), { status: 200, headers: attachmentResponseHeaders(attachment) });
  }
  const bug = attachment.bug ?? attachment.idea ?? attachment.comment?.bug;
  if (!bug && !attachment.redesignProposal && attachment.uploaderId !== user.id) return notFound();
  if (attachment.redesignProposal) {
    const membership = await prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId: attachment.redesignProposal.organisationId, userId: user.id } },
      select: { userId: true },
    });
    if (!membership) return notFound();
  }
  if (bug) {
    const isOrgMember = Boolean(
      await prisma.membership.findUnique({
        where: { organisationId_userId: { organisationId: bug.organisationId, userId: user.id } },
        select: { userId: true },
      }),
    );
    const isProjectMember = Boolean(
      bug.projectId
        ? await prisma.projectMembership.findUnique({
            where: { projectId_userId: { projectId: bug.projectId, userId: user.id } },
            select: { id: true },
          })
        : false,
    );
    const isPublicProject = bug.project?.visibility === "public" && !(!attachment.bug && attachment.idea);
    if (!isOrgMember && !isProjectMember && !isPublicProject && user.role !== "super_admin") {
      return notFound();
    }
  }
  if (bug?.isDeleted) {
    const access = await organisationAccessFor(user.id, bug.organisationId, user.role);
    if (!access.admin) return notFound();
  }

  return new NextResponse(new Uint8Array(attachment.data), {
    status: 200,
    headers: attachmentResponseHeaders(attachment),
  });
}

/**
 * Delete an attachment (#658).
 * Allowed for the uploader (e.g. form abandoned or user removed file),
 * or an admin of the organisation where the parent issue/comment/proposal lives.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      uploaderId: true,
      bugId: true,
      commentId: true,
      redesignProposalId: true,
      bug: { select: { organisationId: true } },
      idea: { select: { organisationId: true } },
      comment: { select: { bug: { select: { organisationId: true } } } },
      redesignProposal: { select: { organisationId: true } },
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  let allowed = attachment.uploaderId === user.id;

  if (!allowed) {
    const organisationId =
      attachment.bug?.organisationId ??
      attachment.idea?.organisationId ??
      attachment.comment?.bug?.organisationId ??
      attachment.redesignProposal?.organisationId;
    if (organisationId) {
      const access = await organisationAccessFor(user.id, organisationId, user.role);
      allowed = access.admin;
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  await prisma.attachment.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
