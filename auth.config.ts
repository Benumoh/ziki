import type { NextAuthConfig } from "next-auth";
import { BASE_PATH } from "@/lib/base-path";
import { cleanEnv } from "@/lib/env-clean";
import { recordAuthError } from "@/lib/auth-diagnostics";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { resolveAuthSecret } from "@/lib/auth-secret";

const isProd = process.env.NODE_ENV === "production";
const authSecret = resolveAuthSecret();

const authUrl =
  cleanEnv(process.env.AUTH_URL) || cleanEnv(process.env.NEXTAUTH_URL);

/**
 * Edge-safe Auth.js config (no Prisma / bcrypt).
 * Middleware must import this file only — never `@/auth` — or the Edge
 * bundle exceeds Vercel's 1 MB middleware limit.
 */
export default {
  basePath: BASE_PATH ? `${BASE_PATH}/api/auth` : "/api/auth",
  providers: [],
  secret: authSecret,
  session: { strategy: "jwt" },
  pages: {
    signIn: BASE_PATH ? `${BASE_PATH}/login` : "/login",
    error: BASE_PATH ? `${BASE_PATH}/login` : "/login",
  },
  trustHost: true,
  useSecureCookies: isProd && !authUrl?.startsWith("http://localhost"),

  logger: {
    error(error) {
      recordAuthError(error);
    },
  },

  callbacks: {
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        if (!BASE_PATH) return `${baseUrl}${url}`;
        return url.startsWith(BASE_PATH)
          ? `${baseUrl}${url}`
          : `${baseUrl}${BASE_PATH}${url}`;
      }
      try {
        const parsed = new URL(url);
        if (parsed.origin === baseUrl) {
          if (BASE_PATH && !parsed.pathname.startsWith(BASE_PATH)) {
            parsed.pathname = `${BASE_PATH}${parsed.pathname}`;
          }
          return parsed.toString();
        }
      } catch {
        // Fallback to default bugs page below
      }
      return `${baseUrl}${BASE_PATH ? BASE_PATH : ""}/bugs`;
    },

    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.sub = user.id;
      }
      if (user?.role) {
        token.role = user.role;
      }
      if (typeof (user as unknown as { sessionVersion?: number })?.sessionVersion === "number") {
        token.sv = (user as unknown as { sessionVersion?: number }).sessionVersion;
      }
      if (typeof (user as unknown as { sessionId?: string })?.sessionId === "string") {
        token.sid = (user as unknown as { sessionId?: string }).sessionId;
      }
      if (isSuperAdminEmail(token.email as string | undefined)) {
        token.role = "super_admin";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const id = token.id ?? token.sub;
        if (typeof id === "string" && id.length > 0) {
          session.user.id = id;
        }
        session.user.sessionVersion = typeof token.sv === "number" ? token.sv : 0;
        session.user.authenticationMethod = token.authenticationMethod === "google" || token.authenticationMethod === "credentials"
          ? token.authenticationMethod : undefined;
        session.user.authenticatedAt = typeof token.authenticatedAt === "number" ? token.authenticatedAt : undefined;
        if (typeof token.sid === "string" && token.sid.length > 0) {
          session.user.sessionId = token.sid;
        }
        if (isSuperAdminEmail(session.user.email)) {
          session.user.role = "super_admin";
        } else if (
          token.role === "user" ||
          token.role === "admin" ||
          token.role === "super_admin"
        ) {
          session.user.role = token.role;
        } else {
          session.user.role = "user";
        }
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
