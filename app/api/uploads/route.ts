import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSessionUserId } from "@/lib/session-user";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { ATTACHMENT_SIZE_LABEL, MAX_ATTACHMENT_BYTES, UPLOAD_RATE_LIMIT, checkAttachment } from "@/lib/attachments";
import { MULTIPART_OVERHEAD_BYTES, readLimitedMultipart } from "@/lib/attachment-body";
import { pruneUnlinkedUploads } from "@/lib/attachment-retention";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { checkPostForSecrets } from "@/lib/security/secret-guard";

const FILE_TOO_LARGE_MESSAGE = `File is too large (max ${ATTACHMENT_SIZE_LABEL}).`;

/**
 * Upload one attachment (#215). It's stored unlinked; creating the issue or
 * comment links it. Until then only the uploader can see it.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) {
    return NextResponse.json({ error: "Sign in to upload files." }, { status: 401 });
  }
  const userId = resolved.userId;

  if (!(await consumeRateLimit(`upload:${userId}`, UPLOAD_RATE_LIMIT)).allowed) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  // Bound the body while reading it: a chunked request declares no length, so
  // the cap has to be enforced on the stream (#485).
  const body = await readLimitedMultipart(req, MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!body.ok) {
    const error =
      body.reason === "invalid-content-length"
        ? "Send a valid Content-Length header."
        : body.reason === "too-large"
          ? FILE_TOO_LARGE_MESSAGE
          : "Couldn't read the upload. Try again.";
    return NextResponse.json({ error }, { status: body.status });
  }

  const file = body.form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkAttachment(bytes, file.name);
  if (!check.ok) {
    const status = bytes.byteLength > MAX_ATTACHMENT_BYTES ? 413 : 400;
    return NextResponse.json({ error: status === 413 ? FILE_TOO_LARGE_MESSAGE : check.error }, { status });
  }

  // #secret-protection: a log or text file is a post too; it is stopped before it is stored.
  if (check.kind === "text") {
    const secrets = await checkPostForSecrets({
      organisationId: await currentOrganisationIdFor(userId),
      actor: { kind: "user", userId },
      source: "upload",
      url: null,
      fields: [{ field: check.filename, text: new TextDecoder().decode(bytes) }],
      noun: "this file",
    });
    if (!secrets.ok) {
      return NextResponse.json({ error: secrets.message, code: "secret_detected", secrets: secrets.secrets }, { status: 422 });
    }
  }

  const saved = await prisma.attachment.create({
    data: {
      uploaderId: userId,
      filename: check.filename,
      contentType: check.contentType,
      size: bytes.byteLength,
      data: Buffer.from(bytes),
    },
    select: { id: true, filename: true, contentType: true, size: true },
  });
  // #543: uploads that were never attached expire. Best effort: a failed
  // cleanup must not fail the upload that just succeeded.
  await pruneUnlinkedUploads(prisma, { uploaderId: userId }).catch((error: unknown) =>
    console.error("[uploads] cleanup of unlinked uploads failed", error),
  );
  return NextResponse.json(saved, { status: 201 });
}
