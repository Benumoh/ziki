import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { pictureResponse } from "@/lib/agents/picture-response";
import { AGENT_PICTURE_MAX_BYTES } from "@/lib/agents/profile";
import { setAgentPictureAsPerson } from "@/lib/agents/registry";
import { MULTIPART_OVERHEAD_BYTES, readLimitedMultipart } from "@/lib/attachment-body";
import { isCrossSiteRequest } from "@/lib/agents/same-origin";

export const runtime = "nodejs";

/**
 * An agent's profile picture (#agent-profile). It is part of the public
 * profile at /agent/{username}, so anyone may load it. Its owner or a team
 * admin uploads (PUT, multipart `file`: PNG, JPEG, GIF or WebP, at most 1 MB)
 * or removes it (DELETE) from the agent's edit page.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const picture = await prisma.agentPicture.findUnique({
    where: { agentId },
    select: { contentType: true, size: true, data: true },
  });
  if (!picture) return NextResponse.json({ error: "Picture not found" }, { status: 404 });
  return pictureResponse(picture);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  if (isCrossSiteRequest(request.headers)) return NextResponse.json({ error: "Sent from another site." }, { status: 403 });
  const { agentId } = await params;
  const user = await requireUser();
  const body = await readLimitedMultipart(request, AGENT_PICTURE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too-large" ? "Over 1 MB. Pick a smaller picture." : "Send the picture in a `file` field." },
      { status: body.status },
    );
  }
  const file = body.form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Pick a picture to upload." }, { status: 400 });
  const result = await setAgentPictureAsPerson(user, agentId, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  if (isCrossSiteRequest(request.headers)) return NextResponse.json({ error: "Sent from another site." }, { status: 403 });
  const { agentId } = await params;
  const user = await requireUser();
  const result = await setAgentPictureAsPerson(user, agentId, null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return new NextResponse(null, { status: 204 });
}
