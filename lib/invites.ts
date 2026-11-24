import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { giveWelcomeBonus } from "@/lib/coins/welcome-bonus";
import type { MembershipRole, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { notifyOrganisationInvite } from "@/lib/agent-notifications";
import { canSendMail, sendMail } from "@/lib/mail";
import { absoluteUrl } from "@/lib/site-url";

/**
 * Invites to a organisation (#444). Joining a organisation you're not in is invite-only.
 *
 * - Only an owner or admin of the organisation can invite, and only into it.
 * - An invite is a single-use link sent to one email address. Only a SHA-256
 *   hash of its token is stored; the raw link is shown to the inviter once.
 * - It expires after 7 days. Accepting it adds the person as a `member`.
 * - It can only be accepted by the account with the invited email, so a
 *   forwarded or leaked link lets nobody else in.
 *
 * Someone who already has an account is also told in Ziki (#443): that
 * notification links to /organisations?invite=<id>, where the same account rule
 * applies. Anyone else gets the link by email.
 */

type Db = PrismaClient;

export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
export const INVITE_PATH = "/organisations/invite";

export const CREATE_INVITE_RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };
export const ACCEPT_INVITE_RATE_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/** The same words whether the organisation doesn't exist or isn't yours to manage. */
export const INVITE_NOT_ALLOWED = "Only an owner or admin of this organisation can manage its invites.";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type NewInviteToken = { raw: string; hash: string };

export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** 32 random bytes, so a link can't be guessed. */
export function generateInviteToken(): NewInviteToken {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashInviteToken(raw) };
}

export function isInviteToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function invitePath(rawToken: string): string {
  return `${INVITE_PATH}/${rawToken}`;
}

export function inviteUrl(rawToken: string): string {
  return absoluteUrl(invitePath(rawToken));
}

/** Where a pasted invite should open. Share links live at /join, email invites at /organisations/invite. */
export function destinationForInviteInput(raw: string): string | null {
  const token = parseInviteLink(raw);
  if (!token) return null;
  return /\/join\//.test(raw) ? `/join/${token}` : invitePath(token);
}

/**
 * The token in a pasted invite link, or in a bare token. Null for anything
 * else, so junk never reaches the database.
 */
export function parseInviteLink(input: string): string | null {
  const value = input.trim();
  if (isInviteToken(value)) return value;
  const match = /\/(?:organisations\/invite|join)\/([^/?#\s]+)/.exec(value);
  const token = match?.[1];
  return token && isInviteToken(token) ? token : null;
}

export function canInvite(role: MembershipRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export type InviteState = "pending" | "accepted" | "expired";

export function inviteState(
  invite: { acceptedAt: Date | null; expiresAt: Date },
  now = new Date(),
): InviteState {
  if (invite.acceptedAt) return "accepted";
  return invite.expiresAt.getTime() > now.getTime() ? "pending" : "expired";
}

export const inviteEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254, "That email address is too long."));

function sameEmail(a: string, b: string | null | undefined): boolean {
  return Boolean(b) && a.trim().toLowerCase() === b!.trim().toLowerCase();
}

/** "a•••@example.com": enough to recognise your own address, no more. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type CreateInviteResult =
  | {
      ok: true;
      invite: { id: string; email: string; expiresAt: Date };
      organisation: { id: string; slug: string; name: string };
      /** Shown to the inviter once. Never stored. */
      rawToken: string;
    }
  | { ok: false; error: string; field?: "email" };

export async function createInvite(
  db: Db,
  inviter: { id: string },
  input: { organisationId: string; email: unknown },
  now = new Date(),
): Promise<CreateInviteResult> {
  const inviterMembership = input.organisationId
    ? await db.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: inviter.id } },
        select: { role: true, organisation: { select: { id: true, slug: true, name: true } } },
      })
    : null;
  if (!inviterMembership || !canInvite(inviterMembership.role)) {
    return { ok: false, error: INVITE_NOT_ALLOWED };
  }
  const { organisation } = inviterMembership;

  const parsed = inviteEmailSchema.safeParse(typeof input.email === "string" ? input.email : "");
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid email address.", field: "email" };
  }
  const email = parsed.data;

  const alreadyMember = await db.membership.findFirst({
    where: { organisationId: organisation.id, user: { email: { equals: email, mode: "insensitive" } } },
    select: { id: true },
  });
  if (alreadyMember) {
    return { ok: false, error: `${email} is already a member of ${organisation.name}.`, field: "email" };
  }

  const token = generateInviteToken();
  const invite = await db.$transaction(async (tx) => {
    // One live link per person and organisation: inviting again replaces the old
    // link, whose token can't be shown again anyway.
    await tx.organisationInvite.deleteMany({ where: { organisationId: organisation.id, email, acceptedAt: null } });
    return tx.organisationInvite.create({
      data: {
        organisationId: organisation.id,
        email,
        role: "member",
        tokenHash: token.hash,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        invitedById: inviter.id,
      },
      select: { id: true, email: true, expiresAt: true },
    });
  });

  return { ok: true, invite, organisation, rawToken: token.raw };
}

/** The email someone without an account gets. */
export function inviteEmail(input: {
  inviterName: string;
  organisationName: string;
  email: string;
  link: string;
}): { subject: string; text: string } {
  return {
    subject: `[Ziki Issues] ${input.inviterName} invited you to ${input.organisationName}`,
    text: [
      `${input.inviterName} invited you to join ${input.organisationName} on Ziki.`,
      "",
      `Accept the invite: ${input.link}`,
      "",
      `The link works once and expires in ${INVITE_TTL_DAYS} days. Sign in or sign up as ${input.email} to accept it.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}

/**
 * How the invitee hears about it:
 * - "notified": they have an account, so Ziki tells them (#443);
 * - "emailed": no account yet, so the link goes to their email;
 * - "manual": no account and no email on this site: the inviter sends it.
 */
export type InviteDelivery = "notified" | "emailed" | "manual";

export async function deliverInvite(
  db: Db,
  input: {
    invite: { id: string; email: string };
    rawToken: string;
    organisationId?: string;
    organisationName: string;
    inviter: { id: string; name: string };
  },
): Promise<InviteDelivery> {
  const { invite, rawToken, organisationName, inviter } = input;
  const account = await db.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  if (account) {
    await notifyOrganisationInvite({
      id: invite.id,
      ...(input.organisationId ? { organisationId: input.organisationId } : {}),
      organisationName,
      email: invite.email,
      invitedBy: inviter,
    });
    return "notified";
  }
  if (!canSendMail()) return "manual";

  const message = inviteEmail({
    inviterName: inviter.name,
    organisationName,
    email: invite.email,
    link: inviteUrl(rawToken),
  });
  // After the response, so a slow mail server never holds up the inviter.
  after(async () => {
    try {
      await sendMail({ to: invite.email, ...message });
    } catch (error) {
      // Never log the message: the link in it is a live credential.
      console.error("[invites] invite email failed", {
        inviteId: invite.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return "emailed";
}

// ---------------------------------------------------------------------------
// Viewing and accepting
// ---------------------------------------------------------------------------

export type InviteLookup = { token: string } | { inviteId: string };

const inviteSelect = {
  id: true,
  email: true,
  organisationId: true,
  acceptedAt: true,
  expiresAt: true,
  invitedBy: { select: { name: true } },
  organisation: { select: { id: true, slug: true, name: true } },
} as const;

async function findInvite(db: Db, lookup: InviteLookup) {
  if ("token" in lookup) {
    if (!isInviteToken(lookup.token)) return null;
    return db.organisationInvite.findUnique({
      where: { tokenHash: hashInviteToken(lookup.token) },
      select: inviteSelect,
    });
  }
  if (!lookup.inviteId) return null;
  return db.organisationInvite.findUnique({ where: { id: lookup.inviteId }, select: inviteSelect });
}

export type InviteView = {
  id: string;
  state: InviteState;
  expiresAt: Date;
  /** The invited address, masked. */
  maskedEmail: string;
  /** Whether the signed-in account is the one the invite was sent to. */
  forThisAccount: boolean;
  /** Who and what it's for: only shown to the account it was sent to. */
  details: {
    organisation: { id: string; slug: string; name: string };
    invitedByName: string;
    alreadyMember: boolean;
  } | null;
};

/**
 * What the signed-in person may see of an invite. By link, anyone holding it
 * learns its state and the masked address; the organisation's name is only for the
 * invited account. By id (from an in-app notification), an invite for
 * another account is `null`, the same as one that doesn't exist.
 */
export async function viewInvite(
  db: Db,
  lookup: InviteLookup,
  account: { id: string; email?: string | null },
  now = new Date(),
): Promise<InviteView | null> {
  const invite = await findInvite(db, lookup);
  if (!invite) return null;
  const forThisAccount = sameEmail(invite.email, account.email);
  if (!forThisAccount && "inviteId" in lookup) return null;

  let details: InviteView["details"] = null;
  if (forThisAccount) {
    const membership = await db.membership.findUnique({
      where: { organisationId_userId: { organisationId: invite.organisationId, userId: account.id } },
      select: { id: true },
    });
    details = {
      organisation: invite.organisation,
      invitedByName: invite.invitedBy.name,
      alreadyMember: Boolean(membership),
    };
  }

  return {
    id: invite.id,
    state: inviteState(invite, now),
    expiresAt: invite.expiresAt,
    maskedEmail: maskEmail(invite.email),
    forThisAccount,
    details,
  };
}

export type AcceptInviteFailure = "invalid" | "expired" | "used" | "wrong_account";

export const ACCEPT_INVITE_ERRORS: Record<AcceptInviteFailure, string> = {
  invalid: "This invite link isn't valid. Check you copied all of it, or ask for a new one.",
  expired: "This invite has expired. Ask the person who invited you for a new one.",
  used: "This invite was already used. Ask the person who invited you for a new one.",
  wrong_account: "This invite was sent to a different email address. Sign in with that address to accept it.",
};

export type AcceptInviteResult =
  | { ok: true; organisation: { id: string; slug: string; name: string }; alreadyMember: boolean }
  | { ok: false; reason: AcceptInviteFailure; error: string };

function failed(reason: AcceptInviteFailure): AcceptInviteResult {
  return { ok: false, reason, error: ACCEPT_INVITE_ERRORS[reason] };
}

/**
 * Accepts an invite for the signed-in account and adds them as a member.
 *
 * The claim is a conditional update (`acceptedAt IS NULL AND expiresAt >
 * now`), so when two requests race with one link, Postgres row locking lets
 * exactly one through. Someone already in the organisation keeps their role.
 */
export async function acceptInvite(
  db: Db,
  lookup: InviteLookup,
  account: { id: string; email?: string | null },
  now = new Date(),
): Promise<AcceptInviteResult> {
  const invite = await findInvite(db, lookup);
  if (!invite) return failed("invalid");
  const forThisAccount = sameEmail(invite.email, account.email);
  // By id, someone else's invite looks the same as no invite.
  if (!forThisAccount && "inviteId" in lookup) return failed("invalid");

  const state = inviteState(invite, now);
  if (state === "accepted") return failed("used");
  if (state === "expired") return failed("expired");
  if (!forThisAccount) return failed("wrong_account");

  return db.$transaction(async (tx) => {
    const claimed = await tx.organisationInvite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      // Lost a race with another click, or it expired a moment ago.
      const latest = await tx.organisationInvite.findUnique({
        where: { id: invite.id },
        select: { acceptedAt: true },
      });
      return failed(latest?.acceptedAt ? "used" : "expired");
    }

    const existing = await tx.membership.findUnique({
      where: { organisationId_userId: { organisationId: invite.organisationId, userId: account.id } },
      select: { id: true },
    });
    await tx.membership.upsert({
      where: { organisationId_userId: { organisationId: invite.organisationId, userId: account.id } },
      create: { organisationId: invite.organisationId, userId: account.id, role: "member" },
      update: {},
    });
    if (!existing) await giveWelcomeBonus(tx, account.id);
    return { ok: true as const, organisation: invite.organisation, alreadyMember: Boolean(existing) };
  });
}

// ---------------------------------------------------------------------------
// Managing a organisation's invites
// ---------------------------------------------------------------------------

export type PendingInvite = {
  id: string;
  email: string;
  expiresAt: Date;
  createdAt: Date;
  invitedByName: string;
};

export type AccountInvite = {
  id: string;
  expiresAt: Date;
  organisation: { id: string; name: string; slug: string };
  invitedByName: string;
};

/**
 * Live invites addressed to this account. The organisations page lists these so
 * the person can join without pasting the link. One they already belong to
 * is left out.
 */
export async function openInvitesFor(
  db: Db,
  account: { id: string; email?: string | null },
  now = new Date(),
): Promise<AccountInvite[]> {
  const email = account.email?.trim();
  if (!email) return [];
  const rows = await db.organisationInvite.findMany({
    where: {
      email: { equals: email, mode: "insensitive" },
      acceptedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      expiresAt: true,
      organisationId: true,
      organisation: { select: { id: true, name: true, slug: true } },
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const open: AccountInvite[] = [];
  for (const row of rows) {
    const membership = await db.membership.findUnique({
      where: { organisationId_userId: { organisationId: row.organisationId, userId: account.id } },
      select: { id: true },
    });
    if (membership) continue;
    open.push({
      id: row.id,
      expiresAt: row.expiresAt,
      organisation: row.organisation,
      invitedByName: row.invitedBy.name,
    });
  }
  return open;
}

/** Links still waiting to be used, newest first. */
export async function pendingInvites(
  db: Db,
  organisationId: string,
  now = new Date(),
): Promise<PendingInvite[]> {
  // The inviter is loaded apart so a deleted account does not fail the page.
  const rows = await db.organisationInvite.findMany({
    where: { organisationId, acceptedAt: null, expiresAt: { gt: now } },
    select: { id: true, email: true, expiresAt: true, createdAt: true, invitedById: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const ids = [...new Set(rows.map((row) => row.invitedById))];
  const people =
    ids.length === 0
      ? []
      : await db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
  const names = new Map(people.map((person) => [person.id, person.name]));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    invitedByName: names.get(row.invitedById) ?? "Someone",
  }));
}

export type RevokeInviteResult =
  | { ok: true; organisationSlug: string }
  | { ok: false; error: string };

/** An owner or admin withdraws a link that hasn't been used. */
export async function revokeInvite(
  db: Db,
  actor: { id: string },
  inviteId: string,
): Promise<RevokeInviteResult> {
  const invite = inviteId
    ? await db.organisationInvite.findUnique({
        where: { id: inviteId },
        select: { id: true, organisationId: true, acceptedAt: true, organisation: { select: { slug: true } } },
      })
    : null;
  const membership = invite
    ? await db.membership.findUnique({
        where: { organisationId_userId: { organisationId: invite.organisationId, userId: actor.id } },
        select: { role: true },
      })
    : null;
  // Someone else's organisation's invite looks the same as no invite.
  if (!invite || !canInvite(membership?.role)) return { ok: false, error: INVITE_NOT_ALLOWED };
  if (invite.acceptedAt) return { ok: false, error: "That invite was already accepted." };

  await db.organisationInvite.deleteMany({ where: { id: invite.id, acceptedAt: null } });
  return { ok: true, organisationSlug: invite.organisation.slug };
}
