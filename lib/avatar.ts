/**
 * Helpers behind the shared <Avatar> (#290, #576).
 */

/**
 * The initials fallback's tiles, from the agents design: a soft top-to-bottom gradient in one of its colours (orange,
 * violet, indigo, green, red, teal, pink, amber) with white bold initials on it. Written out in full so Tailwind sees
 * every class. The organisation mark and the people and agent avatars all use them, so a name keeps its colour.
 */
export const AVATAR_TONES = [
  "bg-[linear-gradient(180deg,#f8875c_0%,#e5521f_100%)] text-white",
  "bg-[linear-gradient(180deg,#a585fa_0%,#7148e8_100%)] text-white",
  "bg-[linear-gradient(180deg,#6f8cfa_0%,#3f5ae8_100%)] text-white",
  "bg-[linear-gradient(180deg,#45c47d_0%,#1f8f50_100%)] text-white",
  "bg-[linear-gradient(180deg,#f6637f_0%,#d92f4b_100%)] text-white",
  "bg-[linear-gradient(180deg,#44cfc2_0%,#138a7f_100%)] text-white",
  "bg-[linear-gradient(180deg,#f483a8_0%,#e04f80_100%)] text-white",
  "bg-[linear-gradient(180deg,#f8c457_0%,#dc8f0c_100%)] text-white",
] as const;

/**
 * The same name always gets the same tone, on the server and the client and
 * on every page, so a person is recognisable at a glance. FNV-1a over the
 * lower-cased, trimmed name: renaming "Ada" to "ada " doesn't recolour her.
 */
export function avatarTone(name?: string | null): string {
  const key = (name ?? "").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_TONES[(hash >>> 0) % AVATAR_TONES.length];
}

/**
 * Only https image URLs are used (#290, #576). `User.image` comes from the sign-in
 * provider or an uploaded avatar endpoint, but nothing else should ever put a
 * `javascript:`, `data:` or plain-http address in an <img>; those fall back to
 * initials instead.
 */
export function safeAvatarUrl(image?: string | null): string | null {
  if (!image) return null;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type AvatarSize = "xs" | "sm" | "md" | "lg";

/** Box and text size per size; the box is fixed, so nothing shifts when an image loads or fails. */
export const AVATAR_SIZES: Record<AvatarSize, string> = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};
