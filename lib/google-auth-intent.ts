import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "@/lib/auth-secret";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

export const GOOGLE_INTENT_TTL_SECONDS = 10 * 60;
export type GoogleSecurityOperation = "setup" | "disable" | "regenerate" | "password";
export type GoogleSecurityIntent = {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  subject: string;
  operation: GoogleSecurityOperation;
};

export type GoogleAuthIntent = {
  callbackUrl: string;
  link?: { userId: string; email: string; sessionVersion: number };
  security?: GoogleSecurityIntent;
  expiresAt: number;
};

function signature(payload: string) {
  return createHmac("sha256", resolveAuthSecret()).update(`google-auth-intent:${payload}`).digest();
}

/** Server-only proof of password re-authentication before an OAuth linking round trip. */
export function sealGoogleIntent(input: Omit<GoogleAuthIntent, "expiresAt">, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    callbackUrl: safeCallbackUrl(input.callbackUrl),
    expiresAt: now + GOOGLE_INTENT_TTL_SECONDS * 1000,
  })).toString("base64url");
  return `${payload}.${signature(payload).toString("hex")}`;
}

export function readGoogleIntent(value: string | undefined, now = Date.now()): GoogleAuthIntent | null {
  if (!value) return null;
  const [payload, proof, extra] = value.split(".");
  if (!payload || !proof || extra || !/^[a-f0-9]{64}$/.test(proof)) return null;
  if (!timingSafeEqual(signature(payload), Buffer.from(proof, "hex"))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as GoogleAuthIntent;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now ||
        parsed.expiresAt > now + GOOGLE_INTENT_TTL_SECONDS * 1000) return null;
    if (typeof parsed.callbackUrl !== "string") return null;
    if (parsed.link && (typeof parsed.link.userId !== "string" || typeof parsed.link.email !== "string" ||
        !Number.isInteger(parsed.link.sessionVersion))) return null;
    if (parsed.security && (parsed.link || typeof parsed.security.userId !== "string" ||
        typeof parsed.security.sessionId !== "string" || typeof parsed.security.subject !== "string" ||
        !Number.isInteger(parsed.security.sessionVersion) ||
        !["setup", "disable", "regenerate", "password"].includes(parsed.security.operation))) return null;
    return { ...parsed, callbackUrl: safeCallbackUrl(parsed.callbackUrl) };
  } catch {
    return null;
  }
}
