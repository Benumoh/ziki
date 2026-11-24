import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { giveWelcomeBonus } from "@/lib/coins/welcome-bonus";
import {
  INVITE_NOT_ALLOWED,
  canInvite,
  generateInviteToken,
  hashInviteToken,
  isInviteToken,
} from "@/lib/invites";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { absoluteUrl } from "@/lib/site-url";

/**
 * Shareable organisation invite links. An email invite (#444) is one address and
 * one use. A share link is for everyone else: the owner picks how long it
 * lasts and how many people may use it. Opening it and signing in with
 * Google (or any other sign-in) adds that account to the organisation as a member.
 *
 * The raw token is sealed with NEXTAUTH_SECRET so owners can copy it again.
 * Acceptance looks up the SHA-256 hash. A mail scanner that only GETs the
 * page cannot spend a use; joining is a POST from the signed-in account.
 */

type Db = PrismaClient;

export const SHARE_JOIN_PATH = "/join";
export const SHARE_LINK_EXPIRY_DAYS = [1, 7, 30] as const;
export const SHARE_LINK_USE_LIMITS = [1, 10, 25] as const;
/** Links that still work. Stops one organisation from collecting an unbounded set. */
export const SHARE_LINK_ACTIVE_CAP = 20;

export type ShareLinkState = "open" | "expired" | "used" | "revoked";

export type ShareLinkFailure = "invalid" | "expired" | "used" | "revoked";

export const SHARE_LINK_ERRORS: Record<ShareLinkFailure | "rate", string> = {
  invalid: "This invite link isn't valid. Ask the person who sent it for a new one.",
  expired: "This invite link has expired. Ask the person who sent it for a new one.",
  used: "This invite link has already been used by as many people as it allows. Ask for a new one.",
  revoked: "This invite link was turned off. Ask the person who sent it for a new one.",
  rate: "You're doing that too fast. Please wait a moment.",
};

const expiresSchema = z.enum(["1", "7", "30"]);
const usesSchema = z.enum(["1", "10", "25", "unlimited"]);
const labelSchema = z.string().trim().max(60, "Keep the note to 60 characters.");

export function shareJoinPath(rawToken: string): string {
  return `${SHARE_JOIN_PATH}/${rawToken}`;
}

export function shareJoinUrl(rawToken: string): string {
  return absoluteUrl(shareJoinPath(rawToken));
}

export function shareLinkState(
  link: { revokedAt: Date | null; expiresAt: Date; maxUses: number | null; useCount: number },
  now = new Date(),
): ShareLinkState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  if (link.maxUses != null && link.useCount >= link.maxUses) return "used";
  return "open";
}

export function shareLinkStatusLabel(state: ShareLinkState): string {
  switch (state) {
    case "open":
      return "Active";
    case "used":
      return "Used up";
    case "expired":
      return "Expired";
    case "revoked":
      return "Revoked";
  }
}

/** What a guest is told about who can still use an open link. */
export function shareLinkAudience(link: { maxUses: number | null; useCount: number }): string {
  if (link.maxUses == null) return "Anyone with this link can join until it expires.";
  const left = Math.max(0, link.maxUses - link.useCount);
  if (link.maxUses === 1) {
    return "One person can join. After they do, this link stops working.";
  }
  return `${left} of ${link.maxUses} people can still join. After that, this link stops working.`;
}

/** Names of people who joined, plus a count of anyone not listed. */
export function joinedSummary(names: string[], total: number): string {
  const shown = names.filter(Boolean).slice(0, 3);
  if (shown.length === 0 || total <= 0) return "";
  const extra = total - shown.length;
  return extra > 0 ? `${shown.join(", ")} and ${extra} more` : shown.join(", ");
}

function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

function readStoredToken(encrypted: string): string | null {
  try {
    const raw = openSecret(encrypted);
    return isInviteToken(raw) ? raw : null;
  } catch {
    return null;
  }
}

function failureOf(
  link: { revokedAt: Date | null; expiresAt: Date; maxUses: number | null; useCount: number },
  now: Date,
): ShareLinkFailure {
  const state = shareLinkState(link, now);
  if (state === "revoked") return "revoked";
  if (state === "expired") return "expired";
  return "used";
}

// ---------------------------------------------------------------------------
// Creating and listing
// ---------------------------------------------------------------------------

export type CreateShareLinkResult =
  | {
      ok: true;
      url: string;
      organisationSlug: string;
      expiresAt: Date;
      maxUses: number | null;
    }
  | { ok: false; error: string; field?: "label" | "expiresDays" | "maxUses" };

export async function createShareLink(
  db: Db,
  inviter: { id: string },
  input: { organisationId: string; expiresDays: unknown; maxUses: unknown; label: unknown },
  now = new Date(),
): Promise<CreateShareLinkResult> {
  const membership = input.organisationId
    ? await db.membership.findUnique({
        where: { organisationId_userId: { organisationId: input.organisationId, userId: inviter.id } },
        select: { role: true, organisation: { select: { id: true, slug: true, name: true } } },
      })
    : null;
  if (!membership || !canInvite(membership.role)) {
    return { ok: false, error: INVITE_NOT_ALLOWED };
  }

  const expires = expiresSchema.safeParse(typeof input.expiresDays === "string" ? input.expiresDays : "");
  if (!expires.success) {
    return { ok: false, error: expires.error.issues[0]?.message ?? "Choose how long the link lasts.", field: "expiresDays" };
  }
  const uses = usesSchema.safeParse(typeof input.maxUses === "string" ? input.maxUses : "");
  if (!uses.success) {
    return { ok: false, error: uses.error.issues[0]?.message ?? "Choose how many people can use the link.", field: "maxUses" };
  }
  const labelParsed = labelSchema.safeParse(typeof input.label === "string" ? input.label : "");
  if (!labelParsed.success) {
    return { ok: false, error: labelParsed.error.issues[0]?.message ?? "Keep the note to 60 characters.", field: "label" };
  }

  const days = Number(expires.data);
  const maxUses = uses.data === "unlimited" ? null : Number(uses.data);
  const label = labelParsed.data.length > 0 ? labelParsed.data : null;
  const { organisation } = membership;

  const existing = await db.organisationShareLink.findMany({
    where: { organisationId: organisation.id, revokedAt: null, expiresAt: { gt: now } },
    select: { maxUses: true, useCount: true },
  });
  const active = existing.filter((link) => link.maxUses == null || link.useCount < link.maxUses).length;
  if (active >= SHARE_LINK_ACTIVE_CAP) {
    return {
      ok: false,
      error: `This organisation already has ${SHARE_LINK_ACTIVE_CAP} invite links that still work. Revoke one before creating another.`,
    };
  }

  const token = generateInviteToken();
  let tokenEncrypted: string;
  try {
    tokenEncrypted = sealSecret(token.raw);
  } catch {
    return { ok: false, error: "Invite links aren't available on this site yet." };
  }

  const created = await db.organisationShareLink.create({
    data: {
      organisationId: organisation.id,
      tokenHash: token.hash,
      tokenEncrypted,
      label,
      expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      maxUses,
      invitedById: inviter.id,
    },
    select: { expiresAt: true, maxUses: true },
  });

  return {
    ok: true,
    url: shareJoinUrl(token.raw),
    organisationSlug: organisation.slug,
    expiresAt: created.expiresAt,
    maxUses: created.maxUses,
  };
}

export type ManagedShareLink = {
  id: string;
  url: string | null;
  label: string | null;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  state: ShareLinkState;
  createdAt: Date;
  invitedByName: string;
  joinedNames: string[];
};

/** Newest links first, active ones before links that no longer work. */
export async function listShareLinks(db: Db, organisationId: string, now = new Date()): Promise<ManagedShareLink[]> {
  // Names are loaded apart from the links. Joining `invitedBy` or `user` makes
  // Prisma throw when that account is gone, and the invite screen dies.
  const rows = await db.organisationShareLink.findMany({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      tokenEncrypted: true,
      label: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      revokedAt: true,
      createdAt: true,
      invitedById: true,
      redemptions: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { userId: true },
      },
    },
  });
  const ids = [
    ...new Set(
      rows.flatMap((row) => [row.invitedById, ...row.redemptions.map((redemption) => redemption.userId)]),
    ),
  ];
  const people =
    ids.length === 0
      ? []
      : await db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
  const names = new Map(people.map((person) => [person.id, person.name]));

  const links = rows.map((row) => {
    const raw = readStoredToken(row.tokenEncrypted);
    return {
      id: row.id,
      url: raw ? shareJoinUrl(raw) : null,
      label: row.label,
      expiresAt: row.expiresAt,
      maxUses: row.maxUses,
      useCount: row.useCount,
      state: shareLinkState(row, now),
      createdAt: row.createdAt,
      invitedByName: names.get(row.invitedById) ?? "Someone",
      joinedNames: row.redemptions.flatMap((redemption) => {
        const name = names.get(redemption.userId);
        return name ? [name] : [];
      }),
    };
  });

  const rank: Record<ShareLinkState, number> = { open: 0, used: 1, expired: 2, revoked: 3 };
  return links.sort((a, b) => rank[a.state] - rank[b.state] || b.createdAt.getTime() - a.createdAt.getTime());
}

export type RevokeShareLinkResult = { ok: true; organisationSlug: string } | { ok: false; error: string };

/** An owner or admin turns a link off. People who already joined stay members. */
export async function revokeShareLink(db: Db, actor: { id: string }, linkId: string, now = new Date()): Promise<RevokeShareLinkResult> {
  const link = linkId
    ? await db.organisationShareLink.findUnique({
        where: { id: linkId },
        select: { id: true, organisationId: true, revokedAt: true, organisation: { select: { slug: true } } },
      })
    : null;
  const membership = link
    ? await db.membership.findUnique({
        where: { organisationId_userId: { organisationId: link.organisationId, userId: actor.id } },
        select: { role: true },
      })
    : null;
  if (!link || !canInvite(membership?.role)) return { ok: false, error: INVITE_NOT_ALLOWED };
  if (link.revokedAt) return { ok: true, organisationSlug: link.organisation.slug };

  await db.organisationShareLink.updateMany({
    where: { id: link.id, revokedAt: null },
    data: { revokedAt: now },
  });
  return { ok: true, organisationSlug: link.organisation.slug };
}

// ---------------------------------------------------------------------------
// What a guest sees, and joining
// ---------------------------------------------------------------------------

const linkSelect = {
  id: true,
  organisationId: true,
  expiresAt: true,
  maxUses: true,
  useCount: true,
  revokedAt: true,
  invitedBy: { select: { name: true } },
  organisation: { select: { id: true, slug: true, name: true } },
} as const;

async function findByToken(db: Db, token: string) {
  if (!isInviteToken(token)) return null;
  return db.organisationShareLink.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: linkSelect,
  });
}

export type ShareLinkPreview = {
  state: ShareLinkState;
  organisation: { id: string; slug: string; name: string };
  invitedByName: string;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  alreadyMember: boolean;
};

/**
 * Public details of a link. An unknown token is null, so a guess learns
 * nothing. The note an owner attached is not included.
 */
export async function previewShareLink(
  db: Db,
  token: string,
  viewer?: { id: string },
  now = new Date(),
): Promise<ShareLinkPreview | null> {
  const link = await findByToken(db, token);
  if (!link) return null;
  const membership = viewer
    ? await db.membership.findUnique({
        where: { organisationId_userId: { organisationId: link.organisationId, userId: viewer.id } },
        select: { id: true },
      })
    : null;
  return {
    state: shareLinkState(link, now),
    organisation: link.organisation,
    invitedByName: link.invitedBy.name,
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    useCount: link.useCount,
    alreadyMember: Boolean(membership),
  };
}

export type AcceptShareLinkResult =
  | { ok: true; organisation: { id: string; slug: string; name: string }; alreadyMember: boolean }
  | { ok: false; reason: ShareLinkFailure };

/**
 * Adds the signed-in account to the organisation.
 *
 * The seat is claimed with a conditional update so two people racing for the
 * last use can't both get in. The same account never takes two seats: a
 * second click finds their redemption and does not increment again. Someone
 * who is already a member keeps their role and does not spend a use, so the
 * owner can open their own link without using it up.
 */
export async function acceptShareLink(
  db: Db,
  token: string,
  account: { id: string },
  now = new Date(),
): Promise<AcceptShareLinkResult> {
  const link = await findByToken(db, token);
  if (!link) return { ok: false, reason: "invalid" };

  return db.$transaction(async (tx) => {
    const existing = await tx.membership.findUnique({
      where: { organisationId_userId: { organisationId: link.organisationId, userId: account.id } },
      select: { id: true },
    });
    if (existing) return { ok: true as const, organisation: link.organisation, alreadyMember: true };

    const redeemed = await tx.organisationShareRedemption.findUnique({
      where: { linkId_userId: { linkId: link.id, userId: account.id } },
      select: { id: true },
    });
    if (redeemed) {
      await tx.membership.upsert({
        where: { organisationId_userId: { organisationId: link.organisationId, userId: account.id } },
        create: { organisationId: link.organisationId, userId: account.id, role: "member" },
        update: {},
      });
      await giveWelcomeBonus(tx, account.id);
      return { ok: true as const, organisation: link.organisation, alreadyMember: false };
    }

    if (shareLinkState(link, now) !== "open") return { ok: false as const, reason: failureOf(link, now) };

    const claimWhere: Prisma.OrganisationShareLinkWhereInput = {
      id: link.id,
      revokedAt: null,
      expiresAt: { gt: now },
    };
    if (link.maxUses != null) claimWhere.useCount = { lt: link.maxUses };

    const claimed = await tx.organisationShareLink.updateMany({
      where: claimWhere,
      data: { useCount: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      const again = await tx.organisationShareRedemption.findUnique({
        where: { linkId_userId: { linkId: link.id, userId: account.id } },
        select: { id: true },
      });
      if (again) {
        await tx.membership.upsert({
          where: { organisationId_userId: { organisationId: link.organisationId, userId: account.id } },
          create: { organisationId: link.organisationId, userId: account.id, role: "member" },
          update: {},
        });
        await giveWelcomeBonus(tx, account.id);
        return { ok: true as const, organisation: link.organisation, alreadyMember: false };
      }
      const latest = await tx.organisationShareLink.findUnique({
        where: { id: link.id },
        select: { revokedAt: true, expiresAt: true, maxUses: true, useCount: true },
      });
      return { ok: false as const, reason: latest ? failureOf(latest, now) : "invalid" };
    }

    try {
      await tx.organisationShareRedemption.create({ data: { linkId: link.id, userId: account.id } });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      await tx.organisationShareLink.updateMany({
        where: { id: link.id, useCount: { gt: 0 } },
        data: { useCount: { decrement: 1 } },
      });
      await tx.membership.upsert({
        where: { organisationId_userId: { organisationId: link.organisationId, userId: account.id } },
        create: { organisationId: link.organisationId, userId: account.id, role: "member" },
        update: {},
      });
      await giveWelcomeBonus(tx, account.id);
      return { ok: true as const, organisation: link.organisation, alreadyMember: false };
    }

    await tx.membership.upsert({
      where: { organisationId_userId: { organisationId: link.organisationId, userId: account.id } },
      create: { organisationId: link.organisationId, userId: account.id, role: "member" },
      update: {},
    });
    await giveWelcomeBonus(tx, account.id);
    return { ok: true as const, organisation: link.organisation, alreadyMember: false };
  });
}
