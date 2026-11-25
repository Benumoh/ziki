import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { cookies, headers } from "next/headers";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/issue";
import authConfig from "@/auth.config";
import { cleanEnv } from "@/lib/env-clean";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { upsertGoogleUser, GoogleLinkRequiredError, GoogleLinkMismatchError } from "@/lib/google-user";
import { isGoogleEmailAllowed, getGoogleAllowlist } from "@/lib/google-allowlist";
import { clientIpFrom, consumeAuthRateLimit } from "@/lib/rate-limit";
import { TwoFactorInvalidError, TwoFactorRequiredError } from "@/lib/auth-errors";
import { isTwoFactorEnabled, verifySecondFactor } from "@/lib/two-factor";
import { createGoogleChallenge, consumeGoogleChallenge, GOOGLE_CHALLENGE_TTL_SECONDS } from "@/lib/google-two-factor";
import { readGoogleIntent } from "@/lib/google-auth-intent";
import { GOOGLE_INTENT_COOKIE, GOOGLE_CHALLENGE_COOKIE, GOOGLE_SECURITY_COOKIE } from "@/lib/google-auth-cookies";
import { issueGoogleSecurityProof, GOOGLE_SECURITY_TTL_SECONDS } from "@/lib/google-security";
import { appCookieOptions } from "@/lib/cookie-options";
import { acceptedSessionRefresh } from "@/lib/session-refresh";
import { recordSignInFailure, recordSignInSuccess } from "@/lib/user-sessions";

const googleClientId = cleanEnv(
  process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID,
);
const googleClientSecret = cleanEnv(
  process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET,
);
const googleConfigured = Boolean(googleClientId) && Boolean(googleClientSecret);
// Both login methods are on by default; deployments can explicitly disable passwords.
const passwordAuthEnabled = isPasswordAuthEnabled();

if (process.env.NODE_ENV !== "test") {
  console.log("[auth:config] Initializing NextAuth with Google OAuth status:", {
    googleConfigured,
    passwordAuthEnabled,
    clientIdPresent: Boolean(googleClientId),
    clientSecretPresent: Boolean(googleClientSecret),
    clientIdPrefix: googleClientId ? `${googleClientId.slice(0, 12)}…` : "none",
  });
  if (googleConfigured && !getGoogleAllowlist().configured) {
    console.warn(
      "[auth:config] GOOGLE_ALLOWED_EMAILS / GOOGLE_ALLOWED_DOMAINS are not set — " +
        "any Google account can sign in and be auto-provisioned (#223). " +
        "Set an allowlist before exposing this deployment publicly.",
    );
  }
}

export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "google-two-factor",
      name: "Google two-factor",
      credentials: { code: { type: "text" } },
      async authorize(credentials) {
        const jar = await cookies();
        const raw = jar.get(GOOGLE_CHALLENGE_COOKIE)?.value ?? "";
        const result = await consumeGoogleChallenge(raw, typeof credentials.code === "string" ? credentials.code : "");
        if (!result) return null;
        jar.delete(GOOGLE_CHALLENGE_COOKIE);
        const sessionId = await recordSignInSuccess({
          userId: result.user.id, sessionVersion: result.user.sessionVersion,
          headers: await headers().catch(() => null),
        });
        return {
          id: result.user.id, name: result.user.name, email: result.user.email,
          role: result.user.role, sessionVersion: result.user.sessionVersion,
          ...(sessionId ? { sessionId } : {}),
        };
      },
    }),
    ...(googleConfigured
      ? [
          Google({
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
          }),
        ]
      : []),

    ...(passwordAuthEnabled
      ? [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "Authenticator or backup code", type: "text" },
      },
      async authorize(credentials, request) {
        if (!isPasswordAuthEnabled()) {
          return null;
        }
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        // Per-email and per-IP limit on password attempts (#207). Every
        // password sign-in comes through here, whichever entry point it used.
        // Shared across instances (#296).
        const limit = await consumeAuthRateLimit("login", {
          email: parsed.data.email,
          ip: request ? clientIpFrom(request) : null,
        });
        if (!limit.allowed) {
          console.warn("[auth] password sign-in rate limited", { email: parsed.data.email });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });

        if (!user?.passwordHash) {
          return null;
        }

        const reqHeaders =
          request?.headers ?? (await headers().catch(() => null));

        const valid = await compare(
          parsed.data.password,
          user.passwordHash,
        );
        if (!valid) {
          await recordSignInFailure({
            userId: user.id,
            status: "failed_password",
            headers: reqHeaders,
          });
          return null;
        }

        // Second step (#648). Only reached with the right password, so these
        // errors say nothing to someone guessing passwords. The check lives
        // here, not in the form, so a direct POST to the credentials callback
        // cannot skip it.
        if (await isTwoFactorEnabled(user.id)) {
          const code = typeof credentials?.totp === "string" ? credentials.totp : "";
          if (!code.trim()) throw new TwoFactorRequiredError();
          if (!(await verifySecondFactor(user.id, code))) {
            await recordSignInFailure({
              userId: user.id,
              status: "failed_two_factor",
              headers: reqHeaders,
            });
            throw new TwoFactorInvalidError();
          }
        }

        const sessionId = await recordSignInSuccess({
          userId: user.id,
          sessionVersion: user.sessionVersion,
          headers: reqHeaders,
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          sessionVersion: user.sessionVersion,
          ...(sessionId ? { sessionId } : {}),
        };
      },
    }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : null;
      if (!email || profile?.email_verified !== true || !isGoogleEmailAllowed(email)) return false;
      const jar = await cookies();
      const rawIntent = jar.get(GOOGLE_INTENT_COOKIE)?.value;
      const intent = readGoogleIntent(rawIntent);
      jar.delete(GOOGLE_INTENT_COOKIE);
      if (rawIntent && !intent) return "/login?error=GoogleIntentExpired";
      try {
        if (intent?.security) {
          const session = await auth();
          const raw = await issueGoogleSecurityProof(intent.security, account.providerAccountId, session?.user);
          if (!raw) return "/settings/security?google=securityMismatch";
          jar.set(GOOGLE_SECURITY_COOKIE, raw, appCookieOptions(GOOGLE_SECURITY_TTL_SECONDS));
          return `/settings/security?googleSecurity=${intent.security.operation}`;
        }
        const dbUser = await upsertGoogleUser({
          email, subject: account.providerAccountId, emailVerified: true,
          name: user.name, image: user.image, link: intent?.link,
        });
        // Linking adds a method to the existing session; it never signs the
        // browser into a different Google account or bypasses the factor.
        if (intent?.link) return "/settings/security?google=linked";
        if (await isTwoFactorEnabled(dbUser.id)) {
          const raw = await createGoogleChallenge(dbUser, intent?.callbackUrl ?? "/home");
          jar.set(GOOGLE_CHALLENGE_COOKIE, raw, appCookieOptions(GOOGLE_CHALLENGE_TTL_SECONDS));
          return "/login?googleCode=1";
        }
        // Auth.js passes this same user to jwt() (no adapter is configured).
        Object.assign(user, { id: dbUser.id, name: dbUser.name, email: dbUser.email, role: dbUser.role, sessionVersion: dbUser.sessionVersion });
        return true;
      } catch (error) {
        if (intent?.security) return "/settings/security?google=securityMismatch";
        if (error instanceof GoogleLinkRequiredError) return "/login?error=GoogleLinkRequired";
        if (error instanceof GoogleLinkMismatchError) return intent?.link ? "/settings/security?google=mismatch" : "/login?error=GoogleAccountMismatch";
        console.error("[auth] Google sign-in failed", error);
        return "/login?error=OAuthCallbackError";
      }
    },
    async jwt({ token, user, account, trigger, session }) {
      if (user?.id && account) {
        token.authenticationMethod = account.provider === "google" || account.provider === "google-two-factor" ? "google" : "credentials";
        token.authenticatedAt = Date.now();
      }
      if (account?.provider === "google") {
        // Defence in depth: signIn must have resolved a real local account and
        // Google alone must never issue a session while Ziki's factor is on.
        if (!user?.id || typeof user.sessionVersion !== "number" || await isTwoFactorEnabled(user.id)) {
          throw new Error("Google sign-in needs a verified local account and its second factor.");
        }
        const sessionId = await recordSignInSuccess({
          userId: user.id, sessionVersion: user.sessionVersion,
          headers: await headers().catch(() => null),
        });
        if (sessionId) token.sid = sessionId;
        token.email = user.email;
        token.name = user.name;
      }

      if (user?.id) {
        token.id = user.id;
        token.sub = user.id;
      }
      if (user?.role) {
        token.role = user.role;
      }
      if (typeof user?.sessionVersion === "number") {
        token.sv = user.sessionVersion;
      }
      if (typeof user?.sessionId === "string" && user.sessionId) {
        token.sid = user.sessionId;
      }

      // The session that signed the others out keeps working (Ziki #389). Only a
      // server-signed refresh moves the version; see lib/session-refresh.ts.
      if (trigger === "update") {
        const refreshed = acceptedSessionRefresh(token, session);
        if (refreshed !== null) {
          token.sv = refreshed;
          const refreshedSid = (session as { sessionId?: unknown } | null | undefined)?.sessionId;
          if (!token.sid && typeof refreshedSid === "string" && refreshedSid) {
            token.sid = refreshedSid;
          }
        }
      }

      // Keep a stale token (#655). Edge middleware never reads the database, so
      // dropping the session here leaves the cookie in place and /login bounces
      // straight back to /home. requireUser compares sessionVersion and role,
      // then /session-expired is what actually clears the cookie.
      const userId = (token.id ?? token.sub) as string | undefined;
      if (userId && !user) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, sessionVersion: true },
          });
          if (dbUser) {
            const tokenVersion = typeof token.sv === "number" ? token.sv : 0;
            const roleMatches = !token.role || token.role === dbUser.role;
            if (tokenVersion === dbUser.sessionVersion && roleMatches) {
              token.role = dbUser.role;
              token.sv = dbUser.sessionVersion;
            }
          }
        } catch {
          // If database check errors, do not crash; token remains
        }
      }

      return token;
    },
  },
});
