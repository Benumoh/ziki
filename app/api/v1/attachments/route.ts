import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, secretDetectedResponse } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { checkPostForSecrets } from "@/lib/security/secret-guard";
import { ATTACHMENT_SIZE_LABEL, MAX_ATTACHMENT_BYTES, checkAttachment } from "@/lib/attachments";
import { MULTIPART_OVERHEAD_BYTES, readLimitedMultipart } from "@/lib/attachment-body";
import { pruneUnlinkedUploads } from "@/lib/attachment-retention";

export const runtime = "nodejs";

/**
 * POST /api/v1/attachments — an agent uploads a screenshot, log, PDF or HAR
 * file (#645). Multipart form with one `file` field. Contributor+, charged to
 * the write budget and audited.
 *
 * The same checks as the web upload (`checkAttachment`): the bytes decide the
 * type (PNG, JPEG, GIF, WebP, PDF, or text/JSON/HAR), never the name or the
 * declared type, so SVG and HTML are refused; 5 MB at most (4 MB on Vercel). The file is stored
 * unlinked, owned by the agent's owner, until an issue or comment created with
 * `attachmentIds: [id]` claims it. Unlinked uploads expire after 7 days (#543).
 *
 * 201 `{ id, filename, contentType, size }`.
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "attachments.upload", "working", null, async (agent) => {
    // Bound the body while reading it: a chunked request declares no length,
    // so the cap has to be enforced on the stream (#485).
    const body = await readLimitedMultipart(request, MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES);
    if (!body.ok) {
      const error =
        body.reason === "invalid-content-length"
          ? "Send a valid Content-Length header."
          : body.reason === "too-large"
            ? `Over ${ATTACHMENT_SIZE_LABEL}. Try a smaller file.`
            : "Send a multipart/form-data body with a `file` field.";
      return NextResponse.json({ error }, { status: body.status });
    }

    const file = body.form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Send the file in a `file` field." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkAttachment(bytes, file.name);
    if (!check.ok) {
      const tooBig = bytes.byteLength > MAX_ATTACHMENT_BYTES;
      return NextResponse.json({ error: check.error }, { status: tooBig ? 413 : bytes.byteLength === 0 ? 400 : 415 });
    }

    // #secret-protection: logs are where keys leak most. A text file with one is not stored.
    if (check.kind === "text") {
      const secrets = await checkPostForSecrets({
        organisationId: agent.organisationId,
        actor: { kind: "agent", agentId: agent.agentId, agentName: agent.name, ownerId: agent.ownerId },
        source: "attachments.upload",
        url: null,
        fields: [{ field: check.filename, text: new TextDecoder().decode(bytes) }],
        noun: "this file",
      });
      if (!secrets.ok) return secretDetectedResponse(secrets);
    }

    try {
      const saved = await prisma.attachment.create({
        data: {
          uploaderId: agent.ownerId,
          filename: check.filename,
          contentType: check.contentType,
          size: bytes.byteLength,
          data: Buffer.from(bytes),
        },
        select: { id: true, filename: true, contentType: true, size: true },
      });
      await pruneUnlinkedUploads(prisma, { uploaderId: agent.ownerId }).catch((error: unknown) =>
        console.error("[agent-uploads] cleanup of unlinked uploads failed", error),
      );
      return NextResponse.json(saved, { status: 201 });
    } catch {
      return NextResponse.json({ error: "Attachment storage unavailable." }, { status: 503 });
    }
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
