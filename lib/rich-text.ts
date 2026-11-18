/**
 * Lightweight Markdown helpers for bug descriptions and comments.
 * Content is stored as Markdown (or plain text); rendering is sanitized.
 */

const MARKDOWN_HINT =
  /(\*\*|__|`|~~|https?:\/\/|^\s*[-*+] |^\s*[-*+] \[[ xX]\] |^\s*\d+\. |\[.+\]\((?:https?:\/\/|mailto:|\/api\/attachments\/)|^\s*> |^#{1,6}\s|^\s*(?:-\s*){3,}$|^\s*\|.*\|\s*$|\*[^*\s][^*]*\*|(?<![\w])_[^_\s][^_]*_(?![\w]))/m;

/** True when text likely contains Markdown we should render (vs plain wrap). */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINT.test(text);
}

/** Collapse Markdown/markup to plain text for snippets / previews. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s?/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prepare stored content for display (#116).
 *
 * Rendering never injects HTML: every text node is escaped by React, so text
 * such as `<Button>`, `List<String>` or even `<script>` is shown exactly as
 * typed. The only markup removed is the legacy `<u>…</u>` underline that an
 * older editor wrote, and only outside code, so its inner text still reads
 * normally. `&nbsp;` from old pastes becomes a space.
 */
export function stripLegacyMarkup(text: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let inFence: string | null = null;

  const cleanProse = (chunk: string) =>
    chunk
      .split(/(`+[\s\S]*?`+)/)
      .map((part, i) =>
        i % 2 === 1 ? part : part.replace(/<\/?u>/g, "").replace(/&nbsp;/g, " "),
      )
      .join("");

  for (const line of text.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (inFence) {
      out.push(line);
      if (fence && fence[0] === inFence[0] && fence.length >= inFence.length && line.trim() === fence) {
        inFence = null;
      }
      continue;
    }
    if (fence) {
      if (prose.length) out.push(cleanProse(prose.join("\n")));
      prose = [];
      inFence = fence;
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  if (prose.length) out.push(cleanProse(prose.join("\n")));
  return out.join("\n");
}

export type WrapKind =
  | "bold"
  | "italic"
  | "underline"
  | "code"
  | "codeBlock"
  | "link"
  | "ul"
  | "ol";

export type WrapResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function selectedOrPlaceholder(
  value: string,
  start: number,
  end: number,
  placeholder: string,
): { before: string; selected: string; after: string; usedPlaceholder: boolean } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);
  if (selected.length > 0) {
    return { before, selected, after, usedPlaceholder: false };
  }
  return { before, selected: placeholder, after, usedPlaceholder: true };
}

/** Wrap the current textarea selection with Markdown for the given format. */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  kind: WrapKind,
): WrapResult {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));

  if (kind === "ul" || kind === "ol") {
    const { before, selected, after, usedPlaceholder } = selectedOrPlaceholder(
      value,
      safeStart,
      safeEnd,
      "List item",
    );
    const lines = selected.split("\n");
    const prefixed = lines
      .map((line, index) =>
        kind === "ul" ? `- ${line || "List item"}` : `${index + 1}. ${line || "List item"}`,
      )
      .join("\n");
    const next = `${before}${prefixed}${after}`;
    const selStart = before.length;
    const selEnd = usedPlaceholder
      ? before.length + prefixed.length
      : before.length + prefixed.length;
    return { value: next, selectionStart: selStart, selectionEnd: selEnd };
  }

  if (kind === "link") {
    const { before, selected, after } = selectedOrPlaceholder(
      value,
      safeStart,
      safeEnd,
      "link text",
    );
    const label = selected;
    const url = "https://";
    const inserted = `[${label}](${url})`;
    const next = `${before}${inserted}${after}`;
    const urlStart = before.length + label.length + 3;
    return {
      value: next,
      selectionStart: urlStart,
      selectionEnd: urlStart + url.length,
    };
  }

  if (kind === "codeBlock") {
    const { before, selected, after } = selectedOrPlaceholder(
      value,
      safeStart,
      safeEnd,
      "code",
    );
    const block = `\`\`\`\n${selected}\n\`\`\``;
    const next = `${before}${block}${after}`;
    const innerStart = before.length + 4;
    return {
      value: next,
      selectionStart: innerStart,
      selectionEnd: innerStart + selected.length,
    };
  }

  const wrappers: Record<"bold" | "italic" | "underline" | "code", [string, string, string]> = {
    bold: ["**", "**", "bold text"],
    italic: ["*", "*", "italic text"],
    underline: ["<u>", "</u>", "underlined text"],
    code: ["`", "`", "code"],
  };

  const [open, close, placeholder] = wrappers[kind];
  const { before, selected, after, usedPlaceholder } = selectedOrPlaceholder(
    value,
    safeStart,
    safeEnd,
    placeholder,
  );
  const inserted = `${open}${selected}${close}`;
  const next = `${before}${inserted}${after}`;
  const innerStart = before.length + open.length;
  return {
    value: next,
    selectionStart: innerStart,
    selectionEnd: usedPlaceholder
      ? innerStart + selected.length
      : innerStart + selected.length,
  };
}

/** A file uploaded to this tracker (#215), served from our own origin. */
const ATTACHMENT_PATH = /^\/api\/attachments\/[a-z0-9]{8,40}$/i;

/** Only allow http(s), mailto and our own attachment URLs in rendered links. */
export function safeHref(url: string): string | null {
  const trimmed = url.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (ATTACHMENT_PATH.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(trimmed)) return trimmed;
  return null;
}

/** Hosts whose images may load inline (GitHub attachments and avatars). */
const INLINE_IMAGE_HOSTS = new Set([
  "user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "avatars.githubusercontent.com",
]);

/**
 * `src` for an inline Markdown image, or null to show it as a plain link.
 * Images from arbitrary servers would let anyone log every reader's IP and
 * read time (tracking pixels, #119), so only https GitHub image hosts load.
 */
export function inlineImageSrc(url: string): string | null {
  const href = safeHref(url);
  if (!href) return null;
  // Our own uploads (#305): same origin, so nothing is leaked by loading them.
  if (ATTACHMENT_PATH.test(href)) return href;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "github.com") {
    return parsed.pathname.startsWith("/user-attachments/") ? href : null;
  }
  return INLINE_IMAGE_HOSTS.has(host) ? href : null;
}

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strikethrough"; value: string }
  | { type: "link"; label: string; href: string }
  | { type: "image"; alt: string; src: string }
  | { type: "autolink"; href: string };

/**
 * Strips trailing punctuation from autolinked URLs and preserves balanced parentheses.
 */
export function cleanTrailingUrl(rawUrl: string): { href: string; trailing: string } {
  let href = rawUrl;
  let trailing = "";

  while (/[.,;:!?]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }

  while (href.endsWith(")")) {
    const openCount = (href.match(/\(/g) || []).length;
    const closeCount = (href.match(/\)/g) || []).length;
    if (closeCount > openCount) {
      trailing = ")" + trailing;
      href = href.slice(0, -1);
    } else {
      break;
    }
  }

  while (/[.,;:!?]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }

  return { href, trailing };
}

/**
 * Links require an http(s) href (or tracker attachments, #305) so soft-mentions
 * `@[Name](userId)` stay text, and bare URLs are linked automatically.
 * Labels may contain backslash-escaped brackets, as uploads of `screen[1].png`
 * produce (#724).
 */
export const INLINE_RE =
  /(!?\[(?:[^\]\\]|\\.)*\]\((?:https?:\/\/|mailto:|\/api\/attachments\/)[^)\s]*\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|(?<![\w])_[^_\s][^_]*_(?![\w])|(?<![\w/.-])(https?:\/\/[^\s<>"]+))/g;

export const MARKDOWN_TARGET_RE = /^(!?)\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)$/;

/** Undoes the escaping `escapeLabel` applies to uploaded filenames. */
function unescapeLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, "$1");
}

/**
 * Appends a plain-text chunk or merges it into the trailing text token.
 */
function pushText(tokens: InlineToken[], value: string) {
  if (!value) return;
  const lastToken = tokens[tokens.length - 1];
  if (lastToken && lastToken.type === "text") {
    lastToken.value += value;
  } else {
    tokens.push({ type: "text", value });
  }
}

/**
 * Tokenizes an inline Markdown string into structured tokens (code, bold,
 * italic, strikethrough, links, autolinks, images, text).
 */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      pushText(tokens, text.slice(last, index));
    }
    const raw = match[0];

    const target = MARKDOWN_TARGET_RE.exec(raw);
    if (target) {
      if (target[1] === "!") {
        tokens.push({ type: "image", alt: unescapeLabel(target[2] ?? ""), src: target[3] ?? "" });
      } else {
        tokens.push({ type: "link", label: unescapeLabel(target[2] ?? raw), href: target[3] ?? "" });
      }
    } else if (raw.startsWith("`")) {
      tokens.push({ type: "code", value: raw.slice(1, -1) });
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      tokens.push({ type: "bold", value: raw.slice(2, -2) });
    } else if (raw.startsWith("~~")) {
      tokens.push({ type: "strikethrough", value: raw.slice(2, -2) });
    } else if (
      (raw.startsWith("*") && raw.endsWith("*")) ||
      (raw.startsWith("_") && raw.endsWith("_"))
    ) {
      tokens.push({ type: "italic", value: raw.slice(1, -1) });
    } else {
      const { href, trailing } = cleanTrailingUrl(raw);
      tokens.push({ type: "autolink", href });
      if (trailing) {
        pushText(tokens, trailing);
      }
    }

    last = index + raw.length;
  }

  if (last < text.length) {
    pushText(tokens, text.slice(last));
  }

  return tokens.length > 0 ? tokens : [{ type: "text", value: text }];
}
