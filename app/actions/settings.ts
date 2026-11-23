"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { auth, updateSession } from "@/auth";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, isTheme } from "@/lib/theme";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { sessionRefreshFor } from "@/lib/session-refresh";
import { resolveCurrentSessionId } from "@/lib/user-sessions";
import { PREF_FIELD, isNotificationKind } from "@/lib/notification-prefs";
import { displayNameSchemaFor } from "@/lib/display-name";
import { walletAddressSchema } from "@/lib/validations/issue";
import { isAdmin } from "@/lib/roles";
import { fromZodError, fieldError, type FieldErrorResult } from "@/lib/form-errors";
import { appCookieOptions } from "@/lib/cookie-options";
import { compare, hash } from "bcryptjs";
import { sendMail, smtpConfigured } from "@/lib/mail";
import { logger } from "@/lib/logger";
import { consumeAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { changePasswordSchema } from "@/lib/validations/issue";
import { validateAvatarBytes } from "@/lib/avatar-upload";

export type SettingsResult = { error?: string; ok?: boolean; emailNotifications?: boolean };

export type DisplayNameResult = Partial<FieldErrorResult> & { ok?: boolean; name?: string };

export type WalletResult = Partial<FieldErrorResult> & { ok?: boolean; walletAddress?: string | null };

export type ChangePasswordResult = Partial<FieldErrorResult> & { ok?: boolean };

export type AvatarResult = { error?: string; ok?: boolean; image?: string | null };

export type SessionActionResult = { ok: true } | { ok: false; error: string };

/**
 * Change a credentials password from Settings (#570). Updating sessionVersion
 * invalidates every issued JWT, including this one; the form then asks the
 * person to sign in again with their new password.
 */
export async function changePasswordAction(
  _prev: ChangePasswordResult | undefined,
  formData: FormData,
): Promise<ChangePasswordResult> {
  const user = await requireUser();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  // Check before bcrypt so repeated guesses cannot be used to consume CPU.
  const limit = await consumeAuthRateLimit("changePassword", { email: `user:${user.id}`, ip: null });
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, passwordHash: true },
  });
  if (!account?.passwordHash) {
    return { error: "Password changes are only available for password-based accounts." };
  }

  if (!(await compare(parsed.data.currentPassword, account.passwordHash))) {
    return {
      error: "Your current password is incorrect.",
      field: "currentPassword",
      fieldErrors: { currentPassword: "Your current password is incorrect." },
    };
  }

  const passwordHash = await hash(parsed.data.password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, sessionVersion: { increment: 1 } },
  });

  // Unlike reset links, this is an informational notice: only deliver it
  // when a real SMTP transport exists (not development's console mailer).
  if (account.email && smtpConfigured()) {
    void sendMail({
      to: account.email,
      subject: "Your Ziki Issues password was changed",
      text: "Your Ziki Issues password was changed. All active sessions have been signed out. If this wasn't you, contact an administrator immediately.",
    }).catch((error: unknown) => logger.error("[settings] password-change notice failed:", error));
  }

  return { ok: true };
}

/** Turn the signed-in user's email notifications on or off (#151). */
export async function setEmailNotificationsAction(enabled: unknown): Promise<SettingsResult> {
  if (typeof enabled !== "boolean") return { error: "Invalid setting" };
  const user = await requireUser();
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailNotifications: enabled },
    });
  } catch (err) {
    console.error("[settings] setEmailNotificationsAction failed:", err);
    return { error: "Could not update email notifications setting" };
  }
  revalidatePath("/settings");
  return { ok: true, emailNotifications: enabled };
}

/** Turn the site-wide keyboard shortcuts on or off (#287). */
export async function setKeyboardShortcutsAction(enabled: unknown): Promise<SettingsResult> {
  if (typeof enabled !== "boolean") return { error: "Invalid setting" };
  const user = await requireUser();
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { keyboardShortcuts: enabled },
    });
  } catch (err) {
    console.error("[settings] setKeyboardShortcutsAction failed:", err);
    return { error: "Could not update keyboard shortcuts setting" };
  }
  // The layout reads the setting, so every page needs the new value.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Light, dark or follow the device (#277). Saved on the user so it follows
 * them, and in a cookie so this device's signed-out pages match.
 */
export async function setThemeAction(theme: unknown): Promise<SettingsResult> {
  if (!isTheme(theme)) return { error: "Invalid setting" };
  const user = await requireUser();
  try {
    await prisma.user.update({ where: { id: user.id }, data: { theme } });
  } catch (err) {
    console.error("[settings] setThemeAction user update failed:", err);
    return { error: "Could not save theme to your account." };
  }
  (await cookies()).set(THEME_COOKIE, theme, appCookieOptions(THEME_COOKIE_MAX_AGE));
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Turn one kind of email on or off. The master switch above is unchanged, so
 * someone can keep mentions while dropping status changes.
 */
export async function setNotificationKindAction(
  kind: unknown,
  enabled: unknown,
): Promise<SettingsResult> {
  if (!isNotificationKind(kind)) return { error: "Invalid setting" };
  if (typeof enabled !== "boolean") return { error: "Invalid setting" };
  const user = await requireUser();
  try {
    await prisma.user.update({
      where: { id: user.id },
      // PREF_FIELD is a fixed lookup over a validated kind, so the column name
      // can never come from the request.
      data: { [PREF_FIELD[kind]]: enabled },
    });
  } catch (err) {
    console.error("[settings] setNotificationKindAction failed:", err);
    return { error: "Could not update notification preference" };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Change the signed-in user's display name (#293).
 *
 * Only `name` is written, never email (the sign-in identity) or role. Names
 * are read from the User row wherever they're shown — issues, comments, the
 * admin table — so this updates old comments too, with nothing to backfill.
 */
export async function updateDisplayNameAction(
  _prev: DisplayNameResult | undefined,
  formData: FormData,
): Promise<DisplayNameResult> {
  const user = await requireUser();
  const parsed = displayNameSchemaFor(isAdmin(user.role)).safeParse(formData.get("name") ?? "");
  if (!parsed.success) {
    // Zod's issue has no path for a bare string schema, so name the field.
    const first = fromZodError(parsed.error, "Enter a valid name.");
    return { error: first.error, field: "name", fieldErrors: { name: first.error } };
  }
  await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data } });
  // The name is in the header on every page, and on every issue and comment.
  revalidatePath("/", "layout");
  return { ok: true, name: parsed.data };
}

/**
 * Save or clear the signed-in person's EVM wallet address (#618).
 *
 * Only the caller's own row is ever written: the id comes from the session,
 * never from the form, so no submitted field can set a wallet for anyone else.
 * The address is readable only by them and by admins of an organisation they share
 * (`canViewWallet`), so nothing else in the app displays it.
 */
export async function setWalletAddressAction(
  _prev: WalletResult | undefined,
  formData: FormData,
): Promise<WalletResult> {
  const user = await requireUser();
  const parsed = walletAddressSchema.safeParse(formData.get("walletAddress") ?? "");
  if (!parsed.success) {
    // A bare string schema has no issue path, so the field is named here.
    return fieldError("walletAddress", parsed.error.issues[0]?.message ?? "Enter a valid EVM address.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { walletAddress: parsed.data } });
  revalidatePath("/settings");
  revalidatePath(`/users/${user.id}`);
  return { ok: true, walletAddress: parsed.data };
}

/**
 * Update the signed-in person's profile avatar image (#290, #576).
 */
export async function updateAvatarAction(
  _prev: AvatarResult | undefined,
  formData: FormData,
): Promise<AvatarResult> {
  const user = await requireUser();
  const file = formData.get("avatar");
  if (!file || !(file instanceof File)) {
    return { error: "Please select an image file to upload." };
  }
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const validated = validateAvatarBytes(bytes);
  if (!validated.ok) {
    return { error: validated.error };
  }

  // Remove previous avatar attachments for this user
  await prisma.attachment.deleteMany({
    where: { uploaderId: user.id, filename: { startsWith: "avatar" } },
  }).catch(() => undefined);

  const ext = validated.contentType.split("/")[1] || "png";
  await prisma.attachment.create({
    data: {
      uploaderId: user.id,
      filename: `avatar-${user.id}.${ext}`,
      contentType: validated.contentType,
      size: bytes.byteLength,
      data: Buffer.from(bytes),
    },
  });

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ziki.dev")
    .replace(/^http:\/\//i, "https://")
    .replace(/\/$/, "");
  const avatarUrl = `${base}/api/users/${user.id}/avatar?v=${Date.now()}`;

  await prisma.user.update({
    where: { id: user.id },
    data: { image: avatarUrl },
  });

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath(`/users/${user.id}`);
  return { ok: true, image: avatarUrl };
}

/**
 * Remove the signed-in person's profile avatar, reverting to initials fallback (#290, #576).
 */
export async function removeAvatarAction(): Promise<AvatarResult> {
  const user = await requireUser();
  await prisma.attachment.deleteMany({
    where: { uploaderId: user.id, filename: { startsWith: "avatar" } },
  }).catch(() => undefined);

  await prisma.user.update({
    where: { id: user.id },
    data: { image: null },
  });

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath(`/users/${user.id}`);
  return { ok: true, image: null };
}

/**
 * Revoke a single active session belonging to the signed-in caller. Refuses to
 * sign out the caller's own active device here (that uses `logoutAction`).
 */
export async function signOutSessionAction(sessionId: unknown): Promise<SessionActionResult> {
  const user = await requireUser();
  const targetId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!targetId) {
    return { ok: false, error: "Invalid session." };
  }

  const session = await auth().catch(() => null);
  const reqHeaders = await headers().catch(() => null);
  const currentSessionId = await resolveCurrentSessionId({
    userId: user.id,
    sessionId: session?.user?.sessionId,
    headers: reqHeaders,
  });

  if (currentSessionId && targetId === currentSessionId) {
    return { ok: false, error: "Use Sign out in the account menu to sign out of this device." };
  }

  try {
    const updated = await prisma.userSession.updateMany({
      where: { id: targetId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) {
      return { ok: false, error: "That session is already signed out." };
    }
    await prisma.securityAuditEvent
      ?.create?.({ data: { userId: user.id, type: "session.revoked" } })
      .catch(() => undefined);
  } catch (error) {
    logger.error("[settings] signOutSessionAction failed:", error);
    return { ok: false, error: "Could not sign out that session." };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Ends every session belonging to the signed-in caller except the current
 * device: bumps `sessionVersion` to invalidate all other JWTs, keeps only this
 * session row at the new version, and refreshes this device's JWT cookie.
 */
export async function signOutOtherSessionsAction(): Promise<SessionActionResult> {
  const user = await requireUser();
  const session = await auth().catch(() => null);
  const reqHeaders = await headers().catch(() => null);
  const currentSessionId = await resolveCurrentSessionId({
    userId: user.id,
    sessionId: session?.user?.sessionId,
    headers: reqHeaders,
  });

  let nextVersion: number;
  try {
    nextVersion = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
        select: { sessionVersion: true },
      });

      await tx.userSession.updateMany({
        where: currentSessionId
          ? { userId: user.id, id: { not: currentSessionId }, revokedAt: null }
          : { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      if (currentSessionId) {
        await tx.userSession.updateMany({
          where: { id: currentSessionId, userId: user.id },
          data: {
            sessionVersion: updatedUser.sessionVersion,
            lastActiveAt: now,
            revokedAt: null,
          },
        });
      }

      if (tx.securityAuditEvent?.create) {
        await tx.securityAuditEvent.create({
          data: { userId: user.id, type: "session.revoked_others" },
        });
      }

      return updatedUser.sessionVersion;
    });
  } catch (error) {
    logger.error("[settings] signOutOtherSessionsAction transaction failed:", error);
    return { ok: false, error: "Could not sign out other devices." };
  }

  const refreshData = {
    sessionRefresh: sessionRefreshFor(user.id, nextVersion),
    ...(currentSessionId ? { sessionId: currentSessionId } : {}),
  } as unknown as Parameters<typeof updateSession>[0];
  try {
    await updateSession(refreshData);
  } catch (error) {
    logger.error("[settings] could not refresh current session after signing out other devices:", error);
    return { ok: false, error: "Could not refresh your current session. Please sign in again." };
  }

  // Deliberately do NOT call `revalidatePath("/settings")` inside this action:
  // NextAuth's `updateSession` writes the new JWT to `cookies().set(...)` (the
  // outgoing Set-Cookie header), while `auth()` reads `headers().get("cookie")`
  // (the incoming header from the start of this POST). Re-rendering SettingsPage
  // in the same request would read the pre-update cookie against `nextVersion`
  // and redirect this device to `/session-expired`. The client calls
  // `router.refresh()` once the response (and new Set-Cookie) lands.
  return { ok: true };
}
