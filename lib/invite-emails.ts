/**
 * Several email invites at once (#team-page). The Invite people window turns what is typed or pasted
 * into one tile per address; the server action reads the same list. Safe to import on the client.
 */

/** The most addresses one invite can go to at a time. The hourly invite limit still applies to each. */
export const INVITE_BATCH_MAX = 20;

/** What separates addresses: a comma, a semicolon, a space or a new line (as pasted from a list). */
export const INVITE_SEPARATORS = /[\s,;]+/;

/** A quick shape check for the tiles. The server checks each address properly before inviting. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value);
}

/** Every address in some text, trimmed, lower-cased and without repeats, in the order written. */
export function splitEmails(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(INVITE_SEPARATORS)) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

/**
 * Splits what's in the field into finished addresses and the one still being typed. An address is
 * finished once a separator follows it; the last piece stays in the field until then.
 */
export function takeFinishedEmails(text: string): { finished: string[]; typing: string } {
  const endsWithSeparator = /[\s,;]$/.test(text);
  const parts = text.split(INVITE_SEPARATORS);
  const typing = endsWithSeparator ? "" : (parts.pop() ?? "");
  return { finished: splitEmails(parts.join(" ")), typing };
}
