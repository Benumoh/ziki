import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two-factor sign-in (#648): the login asks for a code when the account has
 * it on, a code works once inside its window, backup codes are spent once,
 * and guessing is rate limited.
 */
const db = vi.hoisted(() => ({
  totpCredential: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  totpBackupCode: { updateMany: vi.fn() },
  securityAuditEvent: { create: vi.fn() },
  googleSignInChallenge: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  googleSecurityProof: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  userSession: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
const limits = vi.hoisted(() => ({ attempt: vi.fn(), auth: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const cookieJar = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieJar), headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), updateSession: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "u1", email: "a@b.co", role: "user" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  consumeRateLimit: limits.attempt,
  consumeAuthRateLimit: limits.auth,
}));
vi.mock("@/lib/auth-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-mode")>()),
  isPasswordAuthEnabled: () => true,
}));

import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { loginAction } from "@/app/actions/auth";
import { sealSecret } from "@/lib/secret-box";
import { base32Encode, matchTotp, totpCode, totpStep } from "@/lib/totp";
import { hashBackupCode, verifySecondFactor } from "@/lib/two-factor";
import { createGoogleChallenge, consumeGoogleChallenge } from "@/lib/google-two-factor";
import { hashResetToken } from "@/lib/password-reset";
import { issueGoogleSecurityProof, consumeGoogleSecurityProof } from "@/lib/google-security";
import { startTwoFactorAction } from "@/app/(app)/settings/security/actions";
import SecuritySettingsPage from "@/app/(app)/settings/security/page";

const signInMock = vi.mocked(signIn);
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const NOW = 1_800_000_000_000;
const STEP = totpStep(NOW);
const goodCode = () => totpCode(SECRET, STEP);

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const authError = (code: string) => Object.assign(new AuthError("sign in failed"), { code });
const enabled = (lastUsedStep: number | null = null) =>
  db.totpCredential.findUnique.mockResolvedValue({ userId: "u1", secret: sealSecret(SECRET), enabledAt: new Date(), lastUsedStep });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-hashing";
  limits.attempt.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  limits.auth.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("the login's second step", () => {
  it("asks for a code when the password was right and two-factor is on, and passes the typed code on", async () => {
    signInMock.mockRejectedValueOnce(authError("two_factor_required"));
    expect(await loginAction(undefined, form({ email: "a@b.co", password: "pw" }))).toEqual({ error: expect.any(String), needsCode: true });

    signInMock.mockResolvedValueOnce(undefined as never);
    await expect(loginAction(undefined, form({ email: "a@b.co", password: "pw", totp: "123456", callbackUrl: "/issues" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(signInMock).toHaveBeenLastCalledWith("credentials", { email: "a@b.co", password: "pw", totp: "123456", redirect: false });
  });

  it("keeps asking after a wrong code, and gives one generic message for a bad password", async () => {
    signInMock.mockRejectedValueOnce(authError("two_factor_invalid"));
    expect((await loginAction(undefined, form({ email: "a@b.co", password: "pw", totp: "000000" })))?.needsCode).toBe(true);
    signInMock.mockRejectedValueOnce(authError("credentials"));
    const bad = await loginAction(undefined, form({ email: "a@b.co", password: "wrong" }));
    expect(bad).toEqual({ error: expect.any(String), field: "email" });
  });
});

describe("verifying the code", () => {
  it("accepts a right code once, moving the used step forward atomically", async () => {
    enabled();
    db.totpCredential.updateMany.mockResolvedValue({ count: 1 });
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBe("totp");
    expect(db.totpCredential.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: STEP } }] },
      data: { lastUsedStep: STEP },
    });
  });

  it("rejects a replayed step, a lost race and a wrong code", async () => {
    enabled(STEP);
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBeNull();
    enabled();
    db.totpCredential.updateMany.mockResolvedValue({ count: 0 });
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBeNull();
    expect(await verifySecondFactor("u1", "123456", NOW)).toBeNull();
  });

  it("spends a backup code once and audits it", async () => {
    enabled();
    db.totpBackupCode.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await verifySecondFactor("u1", "abcde-fghjk", NOW)).toBe("backup");
    expect(db.totpBackupCode.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", codeHash: hashBackupCode("u1", "ABCDEFGHJK"), usedAt: null },
      data: { usedAt: new Date(NOW) },
    });
    expect(db.securityAuditEvent.create).toHaveBeenCalledWith({ data: { userId: "u1", type: "totp.backup_code_used" } });
    expect(await verifySecondFactor("u1", "ABCDE-FGHJK", NOW)).toBeNull();
  });

  it("is rate limited, so a six-digit code can't be guessed", async () => {
    limits.attempt.mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    enabled();
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBeNull();
    expect(db.totpCredential.findUnique).not.toHaveBeenCalled();
  });

  it("allows one step of clock drift and nothing wider (RFC 6238)", () => {
    const rfc = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(matchTotp(rfc, totpCode(rfc, step - 1), { nowMs: now })).toBe(step - 1);
    expect(matchTotp(rfc, totpCode(rfc, step + 2), { nowMs: now })).toBeNull();
  });
});

describe("Google's second factor before issuing a session", () => {
  let challenge: { id: string; tokenHash: string; userId: string; sessionVersion: number; callbackUrl: string; expiresAt: Date; usedAt: Date | null; user: { id: string; googleSubject: string; sessionVersion: number } };
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    enabled();
    db.totpCredential.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
    db.googleSignInChallenge.create.mockImplementation(async ({ data }) => {
      challenge = { ...data, id: "gc1", usedAt: null, user: { id: "u1", googleSubject: "google-1", sessionVersion: 3 } };
      return challenge;
    });
    db.googleSignInChallenge.findUnique.mockImplementation(async ({ where }) => where.tokenHash === challenge?.tokenHash ? challenge : null);
    db.googleSignInChallenge.updateMany.mockImplementation(async () => {
      if (challenge.usedAt) return { count: 0 };
      challenge.usedAt = new Date(NOW);
      return { count: 1 };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires a correct code after Google, then spends the pending sign-in once", async () => {
    const raw = await createGoogleChallenge({ id: "u1", sessionVersion: 3 }, "/settings/security");
    expect(challenge.tokenHash).toBe(hashResetToken(raw));
    expect(await consumeGoogleChallenge(raw, String((Number(goodCode()) + 1) % 1_000_000).padStart(6, "0"))).toBeNull();
    expect(challenge.usedAt).toBeNull();
    const result = await consumeGoogleChallenge(raw, goodCode());
    expect(result).toMatchObject({ user: { id: "u1" }, callbackUrl: "/settings/security" });
    expect(await consumeGoogleChallenge(raw, goodCode())).toBeNull();
  });

  it("refuses missing, expired or version-invalidated Google proof even with a correct code", async () => {
    const raw = await createGoogleChallenge({ id: "u1", sessionVersion: 3 }, "https://evil.example");
    expect(challenge.callbackUrl).toBe("/home");
    expect(await consumeGoogleChallenge("", goodCode())).toBeNull();
    challenge.expiresAt = new Date(NOW - 1);
    expect(await consumeGoogleChallenge(raw, goodCode())).toBeNull();
    challenge.expiresAt = new Date(NOW + 1000);
    challenge.user.sessionVersion = 4;
    expect(await consumeGoogleChallenge(raw, goodCode())).toBeNull();
    expect(challenge.usedAt).toBeNull();
  });

  it("refuses a lost race when another request already claimed the Google sign-in", async () => {
    const raw = await createGoogleChallenge({ id: "u1", sessionVersion: 3 }, "/home");
    db.googleSignInChallenge.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await consumeGoogleChallenge(raw, goodCode())).toBeNull();
  });
});

describe("Google-only two-factor settings", () => {
  const session = { id: "u1", sessionId: "s1", sessionVersion: 3 };
  const intent = { userId: "u1", sessionId: "s1", sessionVersion: 3, subject: "google-1", operation: "setup" as const };
  let account: { id: string; email: string; googleSubject: string; passwordHash: string | null; sessionVersion: number };
  let proof: { id: string; tokenHash: string; userId: string; sessionId: string; sessionVersion: number; googleSubject: string; operation: string; expiresAt: Date; usedAt: Date | null; user: typeof account };
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    account = { id: "u1", email: "a@b.co", googleSubject: "google-1", passwordHash: null, sessionVersion: 3 };
    db.user.findUnique.mockImplementation(async () => account);
    db.userSession.findUnique.mockResolvedValue({ id: "s1", userId: "u1", sessionVersion: 3, revokedAt: null });
    db.totpCredential.findUnique.mockResolvedValue(null);
    vi.mocked(auth).mockResolvedValue({ user: session } as never);
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
    db.googleSecurityProof.create.mockImplementation(async ({ data }) => {
      proof = { ...data, id: "gp1", usedAt: null, user: account };
      return proof;
    });
    db.googleSecurityProof.findUnique.mockImplementation(async ({ where }) => where.tokenHash === proof?.tokenHash ? proof : null);
    db.googleSecurityProof.updateMany.mockImplementation(async () => {
      if (proof.usedAt) return { count: 0 };
      proof.usedAt = new Date(NOW);
      return { count: 1 };
    });
    cookieJar.get.mockReturnValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads security settings normally before any Google verification exists", async () => {
    cookieJar.get.mockReturnValue(undefined);
    await expect(SecuritySettingsPage({ searchParams: Promise.resolve({}) })).resolves.toBeDefined();
  });

  it("lets a Google-only user begin authenticator setup after fresh verification, with no password", async () => {
    const raw = await issueGoogleSecurityProof(intent, "google-1", session);
    expect(raw).not.toBeNull();
    cookieJar.get.mockReturnValue({ value: raw });
    const result = await startTwoFactorAction(new FormData());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.secret.length).toBeGreaterThan(0);
    expect(account.passwordHash).toBeNull();
    expect(proof.usedAt).toBeInstanceOf(Date);
    expect((await startTwoFactorAction(new FormData())).ok).toBe(false);
  });

  it("refuses setup without Google proof and refuses proof for a different Google account or app session", async () => {
    expect((await startTwoFactorAction(new FormData())).ok).toBe(false);
    expect(await issueGoogleSecurityProof(intent, "other-google", session)).toBeNull();
    expect(await issueGoogleSecurityProof(intent, "google-1", { ...session, sessionId: "s2" })).toBeNull();
    expect(db.totpCredential.upsert).not.toHaveBeenCalled();
  });

  it("binds proof to the operation, expiry, account version and session", async () => {
    const raw = await issueGoogleSecurityProof(intent, "google-1", session);
    expect((await consumeGoogleSecurityProof(raw!, session, "disable")).ok).toBe(false);
    expect((await consumeGoogleSecurityProof(raw!, { ...session, sessionId: "s2" }, "setup")).ok).toBe(false);
    account.sessionVersion = 4;
    expect((await consumeGoogleSecurityProof(raw!, session, "setup")).ok).toBe(false);
    account.sessionVersion = 3;
    proof.expiresAt = new Date(NOW - 1);
    expect((await consumeGoogleSecurityProof(raw!, session, "setup")).ok).toBe(false);
    expect(proof.usedAt).toBeNull();
  });

  it("also requires the existing authenticator or backup code before turning two-factor off", async () => {
    const raw = await issueGoogleSecurityProof({ ...intent, operation: "disable" }, "google-1", session);
    enabled();
    db.totpCredential.updateMany.mockResolvedValue({ count: 1 });
    expect((await consumeGoogleSecurityProof(raw!, session, "disable", "wrong-code")).ok).toBe(false);
    expect(proof.usedAt).toBeNull();
    expect((await consumeGoogleSecurityProof(raw!, session, "disable", goodCode())).ok).toBe(true);
    expect((await consumeGoogleSecurityProof(raw!, session, "disable", goodCode())).ok).toBe(false);
  });
});
