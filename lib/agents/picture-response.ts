import { NextResponse } from "next/server";
import { attachmentResponseHeaders } from "@/lib/attachments";

/** Serves an agent's picture with the same safe headers as attachments. The URL carries a version, so it caches. */
export function pictureResponse(picture: { contentType: string; size: number; data: Uint8Array }): NextResponse {
  const headers = attachmentResponseHeaders({ filename: "picture", contentType: picture.contentType, size: picture.size });
  return new NextResponse(new Uint8Array(picture.data), { status: 200, headers: { ...headers, "Cache-Control": "private, max-age=86400" } });
}
