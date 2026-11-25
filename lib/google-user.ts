import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSuperAdminEmail } from "@/lib/super-admin";
import type { GoogleAuthIntent } from "@/lib/google-auth-intent";

export class GoogleLinkRequiredError extends Error {}
export class GoogleLinkMismatchError extends Error {}

export type GoogleAccount = {
  id: string;
  email: string;
  name: string;
  role: Role;
  sessionVersion: number;
};

/** Link a verified Google identity without changing passwords, factors or account ownership. */
export async function upsertGoogleUser(input: {
  email: string;
  subject: string;
  name?: string | null;
  image?: string | null;
  emailVerified: boolean;
  link?: GoogleAuthIntent["link"];
}): Promise<GoogleAccount> {
  if (input.emailVerified !== true || !input.subject || input.subject.length > 255) {
    throw new GoogleLinkMismatchError("Google must verify the account email.");
  }
  const email = input.email.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    const linked = await tx.user.findUnique({ where: { googleSubject: input.subject } });
    if (linked) {
      if (input.link && (linked.id !== input.link.userId ||
          linked.sessionVersion !== input.link.sessionVersion || email !== input.link.email)) {
        throw new GoogleLinkMismatchError("Choose the Google account with your sign-in email.");
      }
      return linked;
    }
    const existing = await tx.user.findUnique({ where: { email } });
    if (input.link && (!existing || existing.id !== input.link.userId ||
        existing.sessionVersion !== input.link.sessionVersion || email !== input.link.email)) {
      throw new GoogleLinkMismatchError("The account changed. Confirm your password again.");
    }
    if (existing) {
      if (existing.googleSubject) throw new GoogleLinkMismatchError("A different Google account is already connected.");
      // Email/password signup alone does not prove ownership of the address.
      // Require both the password (signed link intent) and Google in that case.
      if (existing.passwordHash && !existing.emailVerified && !input.link) {
        throw new GoogleLinkRequiredError("Sign in with your password, then connect Google in Settings.");
      }
      const changed = await tx.user.updateMany({
        where: { id: existing.id, sessionVersion: existing.sessionVersion, googleSubject: null },
        data: { googleSubject: input.subject, emailVerified: new Date(), ...(input.image ? { image: input.image } : {}) },
      });
      if (changed.count !== 1) throw new GoogleLinkMismatchError("The account changed. Try connecting Google again.");
      return existing;
    }
    return tx.user.create({
      data: {
        email,
        name: input.name?.trim() || email.split("@")[0],
        googleSubject: input.subject,
        emailVerified: new Date(),
        ...(input.image ? { image: input.image } : {}),
        ...(isSuperAdminEmail(email) ? { role: "super_admin" } : {}),
      },
    });
  });
}
