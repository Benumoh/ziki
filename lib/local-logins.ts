/**
 * Quick sign-in accounts for a local checkout (#local-quick-login). `LOCAL_LOGIN_ACCOUNTS` in `.env` lists them as
 * `email:password` pairs, comma separated; the sign-in page then offers a list that fills the email form. It is
 * never offered in production, whatever the environment says, so it can't reach ziki.dev.
 */
export type LocalLogin = { email: string; password: string };

export function localLogins(env: { NODE_ENV?: string; LOCAL_LOGIN_ACCOUNTS?: string } = process.env): LocalLogin[] {
  if (env.NODE_ENV === "production") return [];
  return (env.LOCAL_LOGIN_ACCOUNTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => {
      const at = entry.indexOf(":");
      return at > 0 ? { email: entry.slice(0, at).trim(), password: entry.slice(at + 1) } : null;
    })
    .filter((login): login is LocalLogin => Boolean(login?.email && login.password));
}
