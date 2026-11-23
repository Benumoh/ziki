import fs from "fs";
import path from "path";
import crypto from "crypto";

export const LLMS_TOPICS = [
  "onboarding",
  "work-feed",
  "ideas-and-triage",
  "bidding-and-claims",
  "delivery-and-merge",
  "rewards",
  "forum",
  "marketing",
  "security",
  "operations",
] as const;

export type LlmsTopic = (typeof LLMS_TOPICS)[number];

const TOPIC_SET = new Set<string>(LLMS_TOPICS);

export interface CachedLlmsDoc {
  content: string;
  etag: string;
}

const cache = new Map<string, CachedLlmsDoc>();

function llmsDir(): string {
  return path.join(process.cwd(), "docs", "llms");
}

function makeCached(content: string): CachedLlmsDoc {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  return { content, etag: `"${hash}"` };
}

function readCached(key: string, loader: () => string): CachedLlmsDoc {
  const existing = cache.get(key);
  if (existing) return existing;
  const doc = makeCached(loader());
  cache.set(key, doc);
  return doc;
}

/** Resolve a route param like "onboarding.md" to a valid LlmsTopic, or null. */
export function resolveLlmsTopic(rawTopic: string): LlmsTopic | null {
  if (!rawTopic.endsWith(".md")) return null;
  const slug = rawTopic.slice(0, -3);
  return TOPIC_SET.has(slug) ? (slug as LlmsTopic) : null;
}

export function loadLlmsIndex(): CachedLlmsDoc {
  return readCached("index", () => {
    const filePath = path.join(llmsDir(), "index.md");
    return fs.readFileSync(filePath, "utf8");
  });
}

export function loadLlmsTopic(rawTopic: string): CachedLlmsDoc | null {
  const slug = resolveLlmsTopic(rawTopic);
  if (!slug) return null;
  return readCached(`topic:${slug}`, () => {
    const filePath = path.join(llmsDir(), `${slug}.md`);
    return fs.readFileSync(filePath, "utf8");
  });
}

export function loadLlmsFull(): CachedLlmsDoc {
  return readCached("full", () => {
    const parts = [loadLlmsIndex().content.trimEnd()];
    for (const slug of LLMS_TOPICS) {
      const topicDoc = loadLlmsTopic(`${slug}.md`);
      if (topicDoc) {
        parts.push(topicDoc.content.trimEnd());
      }
    }
    return `${parts.join("\n\n---\n\n")}\n`;
  });
}

export function clearLlmsCache(): void {
  cache.clear();
}

export function buildLlmsResponse(
  request: Request,
  doc: CachedLlmsDoc,
  contentType: "text/plain; charset=utf-8" | "text/markdown; charset=utf-8",
): Response {
  const ifNoneMatch = request.headers?.get("if-none-match");
  if (ifNoneMatch && (ifNoneMatch === doc.etag || ifNoneMatch === `W/${doc.etag}`)) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: doc.etag,
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  return new Response(doc.content, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
      ETag: doc.etag,
    },
  });
}
