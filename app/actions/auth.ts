"use server";

import { fromZodError } from "@/lib/form-errors";
import { logger } from "@/lib/logger";

/** An error, and the field it is about when there is one (#309). */
type FieldAwareResult = {
  error?: string;
  field?: string;
  fieldErrors?: Record<string, string>;
  /** The password was right and the account needs a second-factor code (#648). */
  needsCode?: boolean;
};
import { AuthError } from "next-auth";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/auth";
import { ACTIVE_ROLE_COOKIE_NAME } from "@/lib/roles";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { canSendMail, sendMail } from "@/lib/mail";
import {
  PASSWORD_RESET_TTL_MS,
  buildPasswordResetUrl,
  createRawResetToken,
  hashResetToken,
} from "@/lib/password-reset";
import { consumeResetToken } from "@/lib/password-reset-consume";
import { prisma } from "@/lib/prisma";
import {
  isPasswordAuthEnabled,
  PASSWORD_AUTH_DISABLED_MESSAGE,
} from "@/lib/auth-mode";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import {
  RATE_LIMIT_MESSAGE,
  consumeAuthRateLimit,
  clientIpFrom,
  type AuthRateLimitAction,
} from "@/lib/rate-limit";
import {
  addPasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/validations/issue";
import { revokeSessionOnLogout } from "@/lib/user-sessions";
import { appCookieOptions } from "@/lib/cookie-options";
import { GOOGLE_INTENT_TTL_SECONDS, sealGoogleIntent } from "@/lib/google-auth-intent";
import { GOOGLE_CHALLENGE_COOKIE, GOOGLE_INTENT_COOKIE, GOOGLE_SECURITY_COOKIE } from "@/lib/google-auth-cookies";
import { requireUser } from "@/lib/auth-helpers";
import { confirmIdentity } from "@/lib/two-factor";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";
import { addGooglePassword } from "@/lib/google-security";

const RESET_LINK_INVALID =
  "This reset link is invalid or has expired. Request a new one.";

const RESET_EMAIL_UNAVAILABLE =
  "Password reset emails aren't set up on this site yet. Ask an admin to reset your password.";

/**
 * Shown when sign-up hits an existing email. It doesn't confirm that an
 * account exists (#207); a full fix would need email verification.
 */
const SIGNUP_FAILED =
  "We couldn't create an account with those details. If you already have one, sign in or reset your password.";

/** Returns an error result when this auth attempt is over its rate limit (#207). */
async function authRateLimited(
  action: AuthRateLimitAction,
  email: string | null,
): Promise<{ error: string } | null> {
  const ip = clientIpFrom(await headers());
  const result = await consumeAuthRateLimit(action, { email, ip });
  return result.allowed ? null : { error: RATE_LIMIT_MESSAGE };
}

const FORGOT_PASSWORD_SUCCESS =
  "If an account exists for that email, we've sent a password reset link.";


export async function loginAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<FieldAwareResult | undefined> {
  // Server actions stay callable even when no UI renders them.
  if (!isPasswordAuthEnabled()) {
    return { error: PASSWORD_AUTH_DISABLED_MESSAGE };
  }

  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl"));

  // Rate limited inside the Credentials provider's authorize() (auth.ts), which
  // every password sign-in passes through, including direct POSTs to
  // /api/auth/callback/credentials (#207).
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      totp: String(formData.get("totp") ?? ""),
      redirect: false,
    });
  } catch (error) {
    // Reached only after a correct password (see auth.ts), so asking for the
    // code does not reveal whether an account exists (#648).
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "two_factor_required") {
      return { error: "Enter the code from your authenticator app.", needsCode: true };
    }
    if (code === "two_factor_invalid") {
      return {
        error: "That code isn't right. Try the next one, or use a backup code.",
        needsCode: true,
      };
    }
    // Points at the email field so focus lands there, but deliberately not
    // at a single culprit: saying which one was wrong would reveal whether
    // the account exists.
    if (error instanceof AuthError) {
      return { error: "Invalid email or password", field: "email" };
    }
    logger.error("[loginAction] signIn error:", error);
    return { error: "Invalid email or password", field: "email" };
  }

  redirect(callbackUrl);
}

export async function signupAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<FieldAwareResult | undefined> {
  // Server actions stay callable even when no UI renders them.
  if (!isPasswordAuthEnabled()) {
    return { error: PASSWORD_AUTH_DISABLED_MESSAGE };
  }

  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return fromZodError(parsed.error);
  }

  const { name, email, password } = parsed.data;

  const limited = await authRateLimited("signup", email);
  if (limited) return limited;

  const passwordHash = await hash(password, 10);
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl"));

  try {
    await prisma.user.create({
      data: { name, email, passwordHash },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: SIGNUP_FAILED };
    }
    throw error;
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: "Account created, but sign-in failed. Try logging in.",
      };
    }
    logger.error("[signupAction] signIn error after user creation:", error);
    return {
      error: "Account created! Please sign in with your email and password.",
    };
  }


  redirect(callbackUrl);
}

export async function logoutAction() {
  const session = await auth().catch(() => null);
  const reqHeaders = await headers().catch(() => null);
  await revokeSessionOnLogout({
    userId: session?.user?.id,
    sessionId: session?.user?.sessionId,
    headers: reqHeaders,
  });
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ROLE_COOKIE_NAME);
  cookieStore.delete(GOOGLE_INTENT_COOKIE);
  cookieStore.delete(GOOGLE_CHALLENGE_COOKIE);
  cookieStore.delete(GOOGLE_SECURITY_COOKIE);
  await signOut({ redirectTo: "/login" });
}

export async function switchActiveRoleAction(
  newRole: "super_admin" | "admin" | "user",
  returnTo?: string,
) {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: "Unauthorized" };
  }

  // Stored emails are lowercase. A mixed-case session email missed the row,
  // so the switch was refused and the menu looked like it did nothing.
  const email = session.user.email.toLowerCase();
  const isSuper = isSuperAdminEmail(email);
  let isRealAdmin = isSuper;
  let isRealSuper = isSuper;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (user?.role === "super_admin" || isSuper) {
    isRealSuper = true;
    isRealAdmin = true;
  } else if (user?.role === "admin") {
    isRealAdmin = true;
  }

  if (!isRealAdmin) {
    return { error: "Unauthorized: only admins and super admins can switch roles" };
  }

  if (!isRealSuper && newRole === "super_admin") {
    return { error: "Only super admins can switch to super admin" };
  }

  const cookieStore = await cookies();
  const baseRole = isRealSuper ? "super_admin" : "admin";
  const cookieOptions = {
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  };
  if (newRole === baseRole) {
    // Match the attributes used when the cookie was set, or a Secure cookie
    // stays behind and the next request still renders the old role.
    cookieStore.set(ACTIVE_ROLE_COOKIE_NAME, "", {
      ...cookieOptions,
      expires: new Date(0),
    });
  } else {
    const cookieValue = user?.id ? `${newRole}:${user.id}` : newRole;
    cookieStore.set(ACTIVE_ROLE_COOKIE_NAME, cookieValue, {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  revalidatePath("/", "layout");
  redirect(safeCallbackUrl(returnTo));
}

export async function googleSignInAction(
  callbackUrlOrFormData?: string | FormData,
) {
  let target = "/home";
  if (typeof callbackUrlOrFormData === "string") {
    target = callbackUrlOrFormData;
  } else if (
    callbackUrlOrFormData &&
    typeof callbackUrlOrFormData === "object" &&
    "get" in callbackUrlOrFormData
  ) {
    const raw = callbackUrlOrFormData.get("callbackUrl");
    if (typeof raw === "string") target = raw;
  }
  const safeTarget = safeCallbackUrl(target);
  const jar = await cookies();
  jar.delete(GOOGLE_CHALLENGE_COOKIE);
  jar.set(GOOGLE_INTENT_COOKIE, sealGoogleIntent({ callbackUrl: safeTarget }), appCookieOptions(GOOGLE_INTENT_TTL_SECONDS));
  await signIn("google", { redirectTo: safeTarget });
}

/** Re-authenticate before linking an unverified password account to Google. */
export async function connectGoogleAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const user = await requireUser();
  if (!isGoogleOAuthConfigured()) return { error: "Google sign-in is not configured on this site yet." };
  const identity = await confirmIdentity(user.id, {
    password: String(formData.get("currentPassword") ?? ""),
    code: String(formData.get("code") ?? ""),
  });
  if (!identity.ok) return { error: identity.error };
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, sessionVersion: true } });
  const session = await auth();
  if (!account || session?.user?.id !== user.id || account.sessionVersion !== (session.user.sessionVersion ?? 0)) return { error: "Your session ended. Sign in again." };
  const jar = await cookies();
  jar.set(GOOGLE_INTENT_COOKIE, sealGoogleIntent({
    callbackUrl: "/settings/security",
    link: { userId: user.id, email: account.email, sessionVersion: account.sessionVersion },
  }), appCookieOptions(GOOGLE_INTENT_TTL_SECONDS));
  await signIn("google", { redirectTo: "/settings/security" }, { prompt: "select_account" });
}

/** Add the first password after a recent Google sign-in or fresh Google verification. */
export async function addPasswordAction(
  _prev: (FieldAwareResult & { requiresGoogleVerification?: boolean }) | undefined,
  formData: FormData,
): Promise<(FieldAwareResult & { requiresGoogleVerification?: boolean }) | undefined> {
  const user = await requireUser();
  if (!isPasswordAuthEnabled()) return { error: PASSWORD_AUTH_DISABLED_MESSAGE };
  const parsed = addPasswordSchema.safeParse({
    password: formData.get("password"), confirmPassword: formData.get("confirmPassword"),
    code: String(formData.get("code") ?? ""),
  });
  if (!parsed.success) return fromZodError(parsed.error);
  const limited = await authRateLimited("changePassword", user.email ?? null);
  if (limited) return limited;
  const session = await auth();
  if (session?.user.id !== user.id) return { error: "Sign in again before adding a password." };
  const jar = await cookies();
  let result: Awaited<ReturnType<typeof addGooglePassword>>;
  try {
    result = await addGooglePassword(jar.get(GOOGLE_SECURITY_COOKIE)?.value, session.user, parsed.data.password, parsed.data.code);
  } catch (error) {
    logger.error("[password-setup] Could not save password", error);
    return { error: "We couldn't save your password. Please try again." };
  }
  if (!result.ok) return result;
  jar.delete(GOOGLE_SECURITY_COOKIE);
  await signOut({ redirect: false });
  redirect("/login?passwordAdded=1");
}

export async function googleTwoFactorAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const jar = await cookies();
  const raw = jar.get(GOOGLE_CHALLENGE_COOKIE)?.value ?? "";
  const challenge = /^[a-f0-9]{64}$/.test(raw)
    ? await prisma.googleSignInChallenge.findUnique({ where: { tokenHash: hashResetToken(raw) } }) : null;
  if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() <= Date.now()) {
    return { error: "Your Google sign-in expired. Continue with Google again." };
  }
  try {
    await signIn("google-two-factor", { code: String(formData.get("code") ?? ""), redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { error: "That code wasn't accepted. Try another code or sign in with Google again." };
    throw error;
  }
  redirect(safeCallbackUrl(challenge.callbackUrl));
}


export async function forgotPasswordAction(
  _prev: { error?: string; success?: string } | undefined,
  formData: FormData,
): Promise<FieldAwareResult & { success?: string }> {
  // Server actions stay callable even when no UI renders them.
  if (!isPasswordAuthEnabled()) {
    return { error: PASSWORD_AUTH_DISABLED_MESSAGE };
  }

  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return fromZodError(parsed.error, "Invalid email");
  }

  const email = parsed.data.email;

  const limited = await authRateLimited("forgotPassword", email);
  if (limited) return limited;

  // Checked before looking anyone up, so every address gets the same answer
  // (no account enumeration) and nobody is told a link is on its way when it
  // can't be sent (#210).
  if (!canSendMail()) {
    return { error: RESET_EMAIL_UNAVAILABLE };
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    // Only credentials accounts (passwordHash set) can reset via email.
    // Always return the same success copy to avoid account enumeration.
    if (user?.passwordHash) {
      const rawToken = createRawResetToken();
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

      await prisma.$transaction([
        prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
        prisma.passwordResetToken.create({
          data: { tokenHash, userId: user.id, expiresAt },
        }),
      ]);

      const resetUrl = buildPasswordResetUrl(rawToken);
      await sendMail({
        to: email,
        subject: "Reset your Ziki Issues password",
        text: [
          "You requested a password reset for your Ziki Issues account.",
          "",
          `Open this link within 30 minutes to set a new password:`,
          resetUrl,
          "",
          "If you did not request this, you can ignore this email.",
        ].join("\n"),
      });
    }
  } catch (error) {
    logger.error("[forgot-password]", error);
    // Still return the generic message — do not leak failure mode.
  }

  return { success: FORGOT_PASSWORD_SUCCESS };
}

export async function resetPasswordAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<FieldAwareResult | undefined> {
  // Server actions stay callable even when no UI renders them.
  if (!isPasswordAuthEnabled()) {
    return { error: PASSWORD_AUTH_DISABLED_MESSAGE };
  }

  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return fromZodError(parsed.error);
  }

  const { token, password } = parsed.data;
  const tokenHash = hashResetToken(token);

  // No email here; the token hash stands in as the per-target key.
  const limited = await authRateLimited("resetPassword", `token:${tokenHash}`);
  if (limited) return limited;

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    return { error: RESET_LINK_INVALID };
  }

  const passwordHash = await hash(password, 10);

  // Claim the token atomically so a raced second request can't reuse it (#209).
  const consumed = await prisma.$transaction((tx) =>
    consumeResetToken(tx, {
      tokenId: record.id,
      userId: record.userId,
      passwordHash,
    }),
  );
  if (!consumed) {
    return { error: RESET_LINK_INVALID };
  }

  await signOut({ redirect: false });
  redirect("/login");
}
