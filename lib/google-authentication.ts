/** These values come from the server-signed session, never form fields. */
export function isRecentGoogleAuthentication(session: {
  authenticationMethod?: string;
  authenticatedAt?: number;
} | undefined, now = Date.now()) {
  return session?.authenticationMethod === "google" &&
    typeof session.authenticatedAt === "number" &&
    session.authenticatedAt <= now && session.authenticatedAt > now - 5 * 60 * 1000;
}
