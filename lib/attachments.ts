/**
 * File attachments on issues and comments (#215): screenshots, logs, PDFs
 * and HAR files, so people without a GitHub account can attach proof.
 *
 * Files are stored in Postgres (model Attachment), checked here before they
 * are saved, and only ever served to signed-in users.
 */

/**
 * 5 MB, or 4 MB on Vercel: Vercel refuses a function request body over 4.5 MB
 * before the app sees it, so next.config.ts sets ATTACHMENT_MAX_MB=4 there.
 */
const MAX_ATTACHMENT_MB = Number(process.env.ATTACHMENT_MAX_MB) || 5;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
/** The limit as people read it, e.g. "5 MB". */
export const ATTACHMENT_SIZE_LABEL = `${MAX_ATTACHMENT_MB} MB`;
export const MAX_ATTACHMENTS_PER_ITEM = 5;

/** Shown next to the file picker. */
export const ATTACHMENT_HELP = `PNG, JPG, GIF, WebP, PDF, or a text log / JSON / HAR file. Up to ${ATTACHMENT_SIZE_LABEL} each, 5 per issue or comment.`;

/** For the file input's `accept`; the real check is on the server. */
export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf,.txt,.log,.json,.har,.csv";

export type AttachmentKind = "image" | "pdf" | "text";

export type DetectedType = { contentType: string; kind: AttachmentKind };

const TEXT_TYPES: Record<string, string> = {
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  har: "application/json; charset=utf-8",
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((b, i) => bytes[offset + i] === b);
}

function extensionOf(filename: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

function isUtf8Text(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Works out what a file really is from its bytes, ignoring what the browser
 * claimed. Returns null for anything not allowed. Notably SVG and HTML are
 * never accepted: they can carry scripts.
 */
export function detectAttachmentType(bytes: Uint8Array, filename: string): DetectedType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", kind: "image" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { contentType: "image/jpeg", kind: "image" };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { contentType: "image/gif", kind: "image" };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { contentType: "image/webp", kind: "image" };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { contentType: "application/pdf", kind: "pdf" };
  }
  const textType = TEXT_TYPES[extensionOf(filename)];
  if (textType && isUtf8Text(bytes)) {
    return { contentType: textType, kind: "text" };
  }
  return null;
}

export type AttachmentCheck =
  | { ok: true; contentType: string; kind: AttachmentKind; filename: string }
  | { ok: false; error: string };

export function checkAttachment(bytes: Uint8Array, filename: string): AttachmentCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "That file is empty." };
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `Over ${ATTACHMENT_SIZE_LABEL}. Try a smaller file.` };
  }
  const type = detectAttachmentType(bytes, filename);
  if (!type) {
    return { ok: false, error: "File type not supported." };
  }
  return { ok: true, ...type, filename: sanitizeFilename(filename, type.contentType) };
}

/** A filename safe to store and to put in a Content-Disposition header. */
export function sanitizeFilename(name: string, contentType = ""): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f"<>:|?*;]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-120);
  if (clean && clean !== "." && clean !== "..") return clean;
  const ext = contentType.startsWith("image/") ? contentType.slice(6) : contentType.includes("pdf") ? "pdf" : "txt";
  return `attachment.${ext}`;
}

export function attachmentKind(contentType: string): AttachmentKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  return "text";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Ids posted with a form, as one comma-separated field; deduped and capped. */
export function parseAttachmentIds(raw: FormDataEntryValue | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[a-z0-9]{8,40}$/i.test(id));
  return [...new Set(ids)].slice(0, MAX_ATTACHMENTS_PER_ITEM);
}

/** Per-user upload limit (#215), checked with lib/rate-limit.ts. */
export const UPLOAD_RATE_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 };

/**
 * Headers for serving an attachment. Images and PDFs open in the browser;
 * text is downloaded. Everything is served with nosniff and a sandboxing CSP,
 * so even a file that slipped past the checks can't run script on our origin.
 */
export function attachmentResponseHeaders(a: {
  filename: string;
  contentType: string;
  size: number;
}): Record<string, string> {
  const inline = a.contentType.startsWith("image/") || a.contentType === "application/pdf";
  const ascii = a.filename.replace(/[^\x20-\x7e]/g, "_");
  return {
    "Content-Type": a.contentType,
    "Content-Length": String(a.size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=3600",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
