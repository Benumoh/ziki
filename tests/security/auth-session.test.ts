import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HeadersAdapter } from "next/dist/server/web/spec-extension/adapters/headers";
import { compare, hash } from "bcryptjs";

/**
 * Sessions: sign-up and reset don't leak accounts, a reset or role change
 * ends older sessions (#208, #347), a refresh can't be forged (#389), and the
 * expired-session route signs the person out.
 */
const { deleteCookieMock, setCookieMock, getCookieMock } = vi.hoisted(() => ({ deleteCookieMock: vi.fn(), setCookieMock: vi.fn(), getCookieMock: vi.fn() }));
const requestHeadersMock = vi.hoisted(() => vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })));
const middleware = vi.hoisted(() => ({ handler: null as null | ((request: NextRequest & { auth?: { user: { id: string } } }) => Response) }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: deleteCookieMock, get: getCookieMock, set: setCookieMock })),
  headers: requestHeadersMock,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
  default: () => ({ auth: (handler: NonNullable<typeof middleware.handler>) => { middleware.handler = handler; return handler; } }),
}));
vi.mock("@/auth.config", () => ({ default: {} }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), updateSession: vi.fn() }));
vi.mock("@/lib/mail", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/mail")>();
  return { ...real, sendMail: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    userSession: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    loginHistory: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    securityAuditEvent: { create: vi.fn(async () => ({})) },
    totpCredential: { findUnique: vi.fn() },
    googleSecurityProof: { findUnique: vi.fn(), updateMany: vi.fn() },
    agentApiKey: { updateMany: vi.fn() },
    passwordResetToken: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { auth, signIn, signOut, updateSession } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import { ACTIVE_ROLE_COOKIE_NAME } from "@/lib/roles";
import { SESSION_EXPIRED_MESSAGE, resolveSessionUserId } from "@/lib/session-user";
import { acceptedSessionRefresh, sessionRefreshFor } from "@/lib/session-refresh";
import { addPasswordAction, connectGoogleAction, resetPasswordAction, signupAction } from "@/app/actions/auth";
import { signOutOtherSessionsAction, signOutSessionAction } from "@/app/actions/settings";
import {
  buildLoginHistoryCsv,
  legacySessionKey,
  maskIpAddress,
  parseRequestClient,
} from "@/lib/user-sessions";
import { GET as sessionExpired } from "@/app/session-expired/route";
import { isPublicPath } from "@/middleware";
import { upsertGoogleUser, GoogleLinkRequiredError, GoogleLinkMismatchError } from "@/lib/google-user";
import { sealGoogleIntent, readGoogleIntent } from "@/lib/google-auth-intent";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { sendMail } from "@/lib/mail";
import { GOOGLE_CHALLENGE_COOKIE, GOOGLE_INTENT_COOKIE, GOOGLE_SECURITY_COOKIE } from "@/lib/google-auth-cookies";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  userSession: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  loginHistory: { create: ReturnType<typeof vi.fn> };
  securityAuditEvent: { create: ReturnType<typeof vi.fn> };
  totpCredential: { findUnique: ReturnType<typeof vi.fn> };
  googleSecurityProof: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  agentApiKey: { updateMany: ReturnType<typeof vi.fn> };
  passwordResetToken: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requestHeadersMock.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.7" }));
  resetRateLimits();
  vi.stubEnv("AUTH_PASSWORD_LOGIN", "true");
  vi.stubEnv("RATE_LIMIT_STORE", "memory");
});
afterEach(() => vi.unstubAllEnvs());

describe("session versions", () => {
  it("accepts a session issued at the current version", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@x.dev", sessionVersion: 3 } });
    db.user.findUnique.mockResolvedValue({ id: "u1", sessionVersion: 3 });
    await expect(resolveSessionUserId()).resolves.toEqual({ userId: "u1" });
  });

  it("rejects a session issued before a password reset or role change", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@x.dev", sessionVersion: 1 } });
    db.user.findUnique.mockResolvedValue({ id: "u1", sessionVersion: 2 });
    await expect(resolveSessionUserId()).resolves.toEqual({ error: SESSION_EXPIRED_MESSAGE });
  });

  it("fails closed when the lookup throws", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@x.dev", sessionVersion: 1 } });
    db.user.findUnique.mockRejectedValue(new Error("database connection error"));
    await expect(resolveSessionUserId()).resolves.toEqual({ error: SESSION_EXPIRED_MESSAGE });
  });
});

describe("session refresh after a two-factor change", () => {
  const NOW = 1_800_000_000_000;
  const token = { id: "u1", sv: 2 };

  it("moves the token at the old version to the new one, for a minute", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh(token, { sessionRefresh: refresh }, NOW)).toBe(3);
    expect(acceptedSessionRefresh(token, { sessionRefresh: refresh }, NOW + 61_000)).toBeNull();
  });

  it("won't revive a stale token, move another person's, or accept a forged refresh", () => {
    const refresh = sessionRefreshFor("u1", 3, NOW);
    expect(acceptedSessionRefresh({ id: "u1", sv: 1 }, { sessionRefresh: refresh }, NOW)).toBeNull();
    expect(acceptedSessionRefresh({ id: "u2", sv: 2 }, { sessionRefresh: refresh }, NOW)).toBeNull();
    const forged = { userId: "u1", from: 2, to: 3, expires: NOW + 1000, proof: "00".repeat(32) };
    expect(acceptedSessionRefresh(token, { sessionRefresh: forged }, NOW)).toBeNull();
    expect(acceptedSessionRefresh(token, { sessionRefresh: { ...refresh, expires: NOW + 10 ** 9 } }, NOW)).toBeNull();
  });
});

describe("password reset and sign-up", () => {
  const resetToken = "a".repeat(64);
  const input = () => form({ token: resetToken, password: "NewPassw0rd!", confirmPassword: "NewPassw0rd!" });
  const liveToken = { id: "t1", userId: "u1", usedAt: null, expiresAt: new Date(Date.now() + 60_000) };

  it("refuses a reset token another request already claimed", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(liveToken);
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn() }, user: { update: vi.fn() } }),
    );
    expect((await resetPasswordAction(undefined, input()))?.error).toEqual(expect.any(String));
  });

  it("ends every other session and revokes the person's agent keys on reset", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(liveToken);
    const userUpdate = vi.fn();
    const revokeKeys = vi.fn().mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn() },
        user: { update: userUpdate },
        agentApiKey: { updateMany: revokeKeys },
      }),
    );
    await expect(resetPasswordAction(undefined, input())).rejects.toMatchObject({ to: "/login" });
    expect(userUpdate.mock.calls[0][0].data.sessionVersion).toEqual({ increment: 1 });
    expect(revokeKeys).toHaveBeenCalledWith({ where: { revokedAt: null, agent: { ownerUserId: "u1" } }, data: { revokedAt: expect.any(Date) } });
  });

  it("doesn't confirm that an email already has an account", async () => {
    const { Prisma } = await import("@prisma/client");
    db.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "6" }));
    const result = await signupAction(undefined, form({ name: "Bob", email: "bob@zendor.dev", password: "Passw0rd!234", confirmPassword: "Passw0rd!234" }));
    expect(result?.error).toEqual(expect.any(String));
    expect(result?.error).not.toMatch(/already exists/);
  });
});

describe("logout of an expired session", () => {
  it("clears the active role and signs out to the login page", async () => {
    await sessionExpired();
    expect(deleteCookieMock).toHaveBeenCalledWith(ACTIVE_ROLE_COOKIE_NAME);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/login?expired=1" });
  });
});

describe("shared issue login destinations", () => {
  it("retains issue query parameters through login", () => {
    const response = middleware.handler!(new NextRequest("https://ziki.dev/ziki/app/482?comment=c42&view=all"));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("callbackUrl")).toBe("/ziki/app/482?comment=c42&view=all");
  });

  it.each(["https://evil.test", "//evil.test", "/login?callbackUrl=/login"])("rejects unsafe or looping callbacks for a signed-in person: %s", (value) => {
    const request = Object.assign(new NextRequest(`https://ziki.dev/login?callbackUrl=${encodeURIComponent(value)}`), { auth: { user: { id: "u" } } });
    expect(new URL(middleware.handler!(request).headers.get("location")!).pathname).toBe("/home");
  });

  it("returns a signed-in person to their original issue", () => {
    const request = Object.assign(new NextRequest("https://ziki.dev/login?callbackUrl=%2Fziki%2Fapp%2F482%3Fcomment%3Dc42"), { auth: { user: { id: "u" } } });
    expect(middleware.handler!(request).headers.get("location")).toBe("https://ziki.dev/ziki/app/482?comment=c42");
  });

  it("keeps the Google code step reachable with a pending challenge instead of bouncing to home", () => {
    const request = Object.assign(new NextRequest("https://ziki.dev/login?googleCode=1", {
      headers: { cookie: `${GOOGLE_CHALLENGE_COOKIE}=${"a".repeat(64)}` },
    }), { auth: { user: { id: "u" } } });
    expect(middleware.handler!(request).headers.get("location")).toBeNull();
    const noChallenge = Object.assign(new NextRequest("https://ziki.dev/login?googleCode=1"), { auth: { user: { id: "u" } } });
    expect(new URL(middleware.handler!(noChallenge).headers.get("location")!).pathname).toBe("/home");
  });
});

describe("signed-out public project routes (#859)", () => {
  it.each([
    "/zedu/web",
    "/zedu/web/report",
    "/zedu/web/track/private-token",
    "/api/public/projects/zedu/web/ideas",
  ])("allows %s through session middleware", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it("does not make similarly named private routes public", () => {
    expect(isPublicPath("/projects/zedu/web")).toBe(false);
    expect(isPublicPath("/zedu/web/reporter")).toBe(false);
    expect(isPublicPath("/api/projects/zedu/web/ideas")).toBe(false);
  });
});

describe("active sessions and login history", () => {
  it("accepts an unrevoked tracked session and rejects a revoked one", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "a@x.dev", sessionVersion: 2, sessionId: "s-live" },
    });
    db.user.findUnique.mockResolvedValue({ id: "u1", sessionVersion: 2 });
    db.userSession.findUnique.mockResolvedValueOnce({
      id: "s-live",
      userId: "u1",
      sessionVersion: 2,
      revokedAt: null,
      lastActiveAt: new Date(),
    });
    await expect(resolveSessionUserId()).resolves.toEqual({ userId: "u1" });

    db.userSession.findUnique.mockResolvedValueOnce({
      id: "s-live",
      userId: "u1",
      sessionVersion: 2,
      revokedAt: new Date(),
      lastActiveAt: new Date(),
    });
    await expect(resolveSessionUserId()).resolves.toEqual({ error: SESSION_EXPIRED_MESSAGE });
  });

  it("revokes another active session on the account and refuses to revoke the current device", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", name: "Ada", email: "a@x.dev", role: "user", sessionVersion: 1, sessionId: "s-current" },
    });
    db.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Ada",
      email: "a@x.dev",
      image: null,
      role: "user",
      sessionVersion: 1,
    });
    db.userSession.findUnique.mockResolvedValue({
      id: "s-current",
      userId: "u1",
      sessionVersion: 1,
      revokedAt: null,
      lastActiveAt: new Date(),
    });
    db.userSession.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(signOutSessionAction("s-current")).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/this device/i),
    });

    await expect(signOutSessionAction("s-other")).resolves.toEqual({ ok: true });
    expect(db.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-other", userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(db.securityAuditEvent.create).toHaveBeenCalledWith({
      data: { userId: "u1", type: "session.revoked" },
    });
  });

  it("bumps sessionVersion, revokes other sessions, keeps this device active, and refreshes the JWT", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-that-is-long-enough-for-hashing");
    mockAuth.mockResolvedValue({
      user: { id: "u1", name: "Ada", email: "a@x.dev", role: "user", sessionVersion: 4, sessionId: "s-current" },
    });
    db.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Ada",
      email: "a@x.dev",
      image: null,
      role: "user",
      sessionVersion: 4,
    });
    db.userSession.findUnique.mockResolvedValue({
      id: "s-current",
      userId: "u1",
      sessionVersion: 4,
      revokedAt: null,
      lastActiveAt: new Date(),
    });

    const txUserUpdate = vi.fn().mockResolvedValue({ sessionVersion: 5 });
    const txSessionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txAuditCreate = vi.fn().mockResolvedValue({});
    db.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: txUserUpdate },
        userSession: { updateMany: txSessionUpdateMany },
        securityAuditEvent: { create: txAuditCreate },
      }),
    );

    await expect(signOutOtherSessionsAction()).resolves.toEqual({ ok: true });
    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    expect(txSessionUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: "u1", id: { not: "s-current" }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(txSessionUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "s-current", userId: "u1" },
      data: { sessionVersion: 5, lastActiveAt: expect.any(Date), revokedAt: null },
    });
    expect(updateSession).toHaveBeenCalledTimes(1);
    // Must not revalidate inside the same POST before Set-Cookie reaches the browser.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("masks IPs, parses client hints, and neutralises spreadsheet formulas in CSV export", () => {
    expect(maskIpAddress("102.89.44.19")).toBe("102.89.xx.xx");
    expect(maskIpAddress("2001:0db8:85a3::8a2e:0370:7334")).toBe("2001:0db8::xxxx");

    const win11 = parseRequestClient(
      new Headers({
        "x-forwarded-for": "102.89.44.19",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-platform-version": '"15.0.0"',
        "cf-ipcity": "Ikorodu",
        "cf-region": "Lagos",
        "cf-ipcountry": "NG",
      }),
    );
    expect(win11.sessionDevice).toBe("Chrome on Windows 11");
    expect(win11.historyDevice).toBe("Chrome · Windows 11");
    expect(win11.deviceType).toBe("laptop");
    expect(win11.maskedIp).toBe("102.89.xx.xx");
    expect(win11.sessionLocation).toBe("Ikorodu, Lagos, Nigeria");
    expect(win11.historyLocation).toBe("Ikorodu, NG");

    const android = parseRequestClient(
      new Headers({
        "x-forwarded-for": "105.112.10.4",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14; Oppo) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        "cf-ipcity": "Ikorodu",
        "cf-ipcountry": "NG",
      }),
    );
    expect(android.sessionDevice).toBe("Chrome on Android (Oppo)");
    expect(android.deviceType).toBe("mobile");

    const csv = buildLoginHistoryCsv([
      {
        createdAt: new Date("2026-11-04T09:37:00.000Z"),
        status: "failed_password",
        device: "=CMD|' /C calc'!A0",
        ipAddress: "45.134.xx.xx",
        location: "Amsterdam, NL",
      },
    ]);
    expect(csv).toContain(`"Nov 4, 2026 · 09:37","Failed · wrong password","'=CMD|' /C calc'!A0","45.134.xx.xx","Amsterdam, NL"`);

    // Next.js 16's `await headers()` returns a HeadersAdapter proxy where `"headers" in h` is true
    // and `h.headers` is a plain IncomingHttpHeaders object without `.get()`.
    vi.stubEnv("AUTH_SECRET", "test-secret-that-is-long-enough-for-hashing");
    const rawNextHeaders = new Headers({
      host: "localhost:3001",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
    });
    const nextReadonlyHeaders = new Proxy(rawNextHeaders, {
      has(target, prop) {
        return prop === "headers" || prop in target;
      },
      get(target, prop) {
        if (prop === "headers") return { host: "localhost:3001" };
        const val = Reflect.get(target, prop, target);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    const parsedProxy = parseRequestClient(nextReadonlyHeaders);
    expect(parsedProxy.maskedIp).toBe("127.0.xx.xx");
    expect(parsedProxy.sessionLocation).toBe("Local network");
    expect(legacySessionKey("u1", nextReadonlyHeaders)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Google and password account ownership", () => {
  let account: { id: string; email: string; name: string; role: string; passwordHash: string | null; emailVerified: Date | null; googleSubject: string | null; sessionVersion: number };
  const google = () => ({ email: "a@x.dev", subject: "google-1", emailVerified: true });
  beforeEach(() => {
    account = { id: "u1", email: "a@x.dev", name: "Chosen name", role: "user", passwordHash: "existing-password-hash", emailVerified: null, googleSubject: null, sessionVersion: 3 };
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ user: db.user }));
    db.user.findUnique.mockImplementation(async ({ where }: { where: { googleSubject?: string; email?: string } }) =>
      where.googleSubject ? (account.googleSubject === where.googleSubject ? account : null) : account);
    db.user.updateMany.mockImplementation(async ({ where, data }: { where: { sessionVersion: number }; data: object }) => {
      if (where.sessionVersion !== account.sessionVersion) return { count: 0 };
      Object.assign(account, data);
      return { count: 1 };
    });
  });

  it("connects a password account only after both methods are proven, keeping its password and data", async () => {
    const linked = await upsertGoogleUser({ ...google(), link: { userId: "u1", email: "a@x.dev", sessionVersion: 3 } });
    expect(linked.id).toBe("u1");
    expect(account).toMatchObject({ passwordHash: "existing-password-hash", googleSubject: "google-1", name: "Chosen name", sessionVersion: 3 });
    expect(account.emailVerified).toBeInstanceOf(Date);
    const again = await upsertGoogleUser({ ...google(), email: "changed-google-email@x.dev" });
    expect(again.id).toBe("u1");
    expect(again.email).toBe("a@x.dev");
  });

  it("refuses to silently link an unverified password registration or an unverified Google email", async () => {
    await expect(upsertGoogleUser(google())).rejects.toBeInstanceOf(GoogleLinkRequiredError);
    await expect(upsertGoogleUser({ ...google(), emailVerified: false })).rejects.toBeInstanceOf(GoogleLinkMismatchError);
    expect(account).toMatchObject({ passwordHash: "existing-password-hash", googleSubject: null, emailVerified: null });
  });

  it("rejects a different owner, different email, stale password proof, or a competing Google identity", async () => {
    for (const link of [
      { userId: "u2", email: "a@x.dev", sessionVersion: 3 },
      { userId: "u1", email: "other@x.dev", sessionVersion: 3 },
      { userId: "u1", email: "a@x.dev", sessionVersion: 2 },
    ]) await expect(upsertGoogleUser({ ...google(), link })).rejects.toBeInstanceOf(GoogleLinkMismatchError);
    account.googleSubject = "other-google";
    await expect(upsertGoogleUser(google())).rejects.toBeInstanceOf(GoogleLinkMismatchError);
    expect(account.passwordHash).toBe("existing-password-hash");
  });

  it("matches a proven email without discarding its password", async () => {
    account.emailVerified = new Date();
    await upsertGoogleUser(google());
    expect(account).toMatchObject({ id: "u1", googleSubject: "google-1", passwordHash: "existing-password-hash" });
  });

  it("never trusts a forged or expired re-authentication intent", () => {
    const now = 1_800_000_000_000;
    const proof = sealGoogleIntent({ callbackUrl: "https://evil.example", link: { userId: "u1", email: "a@x.dev", sessionVersion: 3 } }, now);
    expect(readGoogleIntent(proof, now)?.callbackUrl).toBe("/home");
    expect(readGoogleIntent(proof, now + 601_000)).toBeNull();
    expect(readGoogleIntent(proof.replace(/.$/, (last) => last === "0" ? "1" : "0"), now)).toBeNull();
  });

  it("offers password sign-in in production unless explicitly disabled", () => {
    expect(isPasswordAuthEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(isPasswordAuthEnabled({ NODE_ENV: "production", AUTH_PASSWORD_LOGIN: "false" })).toBe(false);
  });
});

describe("adding a password directly to a Google account", () => {
  let account: { id: string; name: string; email: string; role: string; passwordHash: string | null; googleSubject: string; sessionVersion: number };
  let session: { id: string; email: string; role: string; sessionId: string; sessionVersion: number; authenticationMethod: string; authenticatedAt: number };
  const input = (values: Record<string, string> = {}) => form({ password: "NewPassw0rd!", confirmPassword: "NewPassw0rd!", ...values });
  beforeEach(() => {
    account = { id: "u1", name: "Ada", email: "a@x.dev", role: "user", passwordHash: null, googleSubject: "google-1", sessionVersion: 3 };
    session = { id: "u1", email: "a@x.dev", role: "user", sessionId: "s1", sessionVersion: 3, authenticationMethod: "google", authenticatedAt: Date.now() };
    mockAuth.mockResolvedValue({ user: session });
    getCookieMock.mockReturnValue(undefined);
    db.userSession.findUnique.mockResolvedValue({ id: "s1", userId: "u1", sessionVersion: 3, revokedAt: null, lastActiveAt: new Date() });
    db.user.findUnique.mockImplementation(async () => account);
    db.user.updateMany.mockImplementation(async ({ where, data }) => {
      if (account.passwordHash || where.sessionVersion !== account.sessionVersion) return { count: 0 };
      account.passwordHash = data.passwordHash;
      account.sessionVersion += data.sessionVersion.increment;
      return { count: 1 };
    });
    db.totpCredential.findUnique.mockResolvedValue(null);
    db.googleSecurityProof.findUnique.mockResolvedValue(null);
    db.googleSecurityProof.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  });

  it("saves a usable password without SMTP, keeps Google connected and ends existing sessions", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_FROM", "");
    requestHeadersMock.mockResolvedValue(HeadersAdapter.seal(new HeadersAdapter({ "x-forwarded-for": "203.0.113.7" })));
    await expect(addPasswordAction(undefined, input())).rejects.toMatchObject({ to: "/login?passwordAdded=1" });
    expect(await compare("NewPassw0rd!", account.passwordHash!)).toBe(true);
    expect(account.googleSubject).toBe("google-1");
    expect(account.sessionVersion).toBe(4);
    expect(sendMail).not.toHaveBeenCalled();
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation and short passwords before changing the account", async () => {
    expect(await addPasswordAction(undefined, input({ confirmPassword: "DifferentPassw0rd!" }))).toHaveProperty("error");
    expect(await addPasswordAction(undefined, input({ password: "short", confirmPassword: "short" }))).toHaveProperty("error");
    expect(account.passwordHash).toBeNull();
    expect(account.sessionVersion).toBe(3);
  });

  it("requires fresh Google verification for old or non-Google sessions", async () => {
    session.authenticatedAt = Date.now() - 301_000;
    expect(await addPasswordAction(undefined, input())).toMatchObject({ requiresGoogleVerification: true });
    session.authenticatedAt = Date.now();
    session.authenticationMethod = "credentials";
    expect(await addPasswordAction(undefined, input())).toMatchObject({ requiresGoogleVerification: true });
    expect(account.passwordHash).toBeNull();
  });

  it("accepts a fresh password-specific Google proof for an older session", async () => {
    session.authenticatedAt = Date.now() - 301_000;
    const raw = "a".repeat(64);
    getCookieMock.mockImplementation((name) => name === GOOGLE_SECURITY_COOKIE ? { value: raw } : undefined);
    db.googleSecurityProof.findUnique.mockResolvedValue({ id: "proof1", userId: "u1", sessionId: "s1", sessionVersion: 3,
      googleSubject: "google-1", operation: "password", usedAt: null, expiresAt: new Date(Date.now() + 60_000), user: account });
    await expect(addPasswordAction(undefined, input())).rejects.toMatchObject({ to: "/login?passwordAdded=1" });
    expect(await compare("NewPassw0rd!", account.passwordHash!)).toBe(true);
  });

  it("rejects expired and wrong-operation proofs and refuses to replace an existing password", async () => {
    session.authenticatedAt = Date.now() - 301_000;
    getCookieMock.mockImplementation((name) => name === GOOGLE_SECURITY_COOKIE ? { value: "a".repeat(64) } : undefined);
    const proof = { id: "proof1", userId: "u1", sessionId: "s1", sessionVersion: 3, googleSubject: "google-1", operation: "setup",
      usedAt: null, expiresAt: new Date(Date.now() + 60_000), user: account };
    db.googleSecurityProof.findUnique.mockResolvedValue(proof);
    expect(await addPasswordAction(undefined, input())).toHaveProperty("error");
    proof.operation = "password";
    proof.expiresAt = new Date(Date.now() - 1);
    expect(await addPasswordAction(undefined, input())).toHaveProperty("error");
    session.authenticatedAt = Date.now();
    account.passwordHash = "existing-password";
    expect(await addPasswordAction(undefined, input())).toHaveProperty("error");
    expect(account.passwordHash).toBe("existing-password");
  });

  it("still requires an existing second factor when adding a password", async () => {
    db.totpCredential.findUnique.mockResolvedValue({ enabledAt: new Date() });
    expect(await addPasswordAction(undefined, input({ code: "wrong" }))).toHaveProperty("error");
    expect(account.passwordHash).toBeNull();
  });

  it("rejects an unauthenticated request", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(addPasswordAction(undefined, input())).rejects.toMatchObject({ to: "/login" });
    expect(account.passwordHash).toBeNull();
  });
});

describe("password proof before connecting Google", () => {
  it("never starts linking with a wrong password or a missing factor, and binds valid proof to the current account", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "a@x.dev", role: "user", sessionVersion: 3 } });
    db.userSession.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ id: "u1", name: "Ada", email: "a@x.dev", role: "user", sessionVersion: 3, passwordHash: await hash("ExistingPassw0rd!", 10) });
    db.totpCredential.findUnique.mockResolvedValue(null);
    expect(await connectGoogleAction(undefined, form({ currentPassword: "wrong" }))).toHaveProperty("error");
    expect(setCookieMock).not.toHaveBeenCalled();
    db.totpCredential.findUnique.mockResolvedValue({ enabledAt: new Date() });
    expect(await connectGoogleAction(undefined, form({ currentPassword: "ExistingPassw0rd!" }))).toHaveProperty("error");
    expect(setCookieMock).not.toHaveBeenCalled();
    db.totpCredential.findUnique.mockResolvedValue(null);
    vi.mocked(signIn).mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { to: "/settings/security" }));
    await expect(connectGoogleAction(undefined, form({ currentPassword: "ExistingPassw0rd!" }))).rejects.toMatchObject({ to: "/settings/security" });
    const cookie = setCookieMock.mock.calls.find(([name]) => name === GOOGLE_INTENT_COOKIE);
    expect(readGoogleIntent(cookie?.[1])?.link).toEqual({ userId: "u1", email: "a@x.dev", sessionVersion: 3 });
    expect(cookie?.[2]).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600 });
  });
});
