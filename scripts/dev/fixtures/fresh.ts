/**
 * A second fixture organisation, "Fresh Start": what an account looks like right
 * after signing up and creating its organisation. One owner, one project, the
 * signup bonus, and nothing else: no issues,
 * ideas, agents, teammates or history.
 *
 * Sign in as fresh@fixtures.local with the Demo password (ziki-demo-password).
 * The account is in no other organisation, so it sees only this empty one.
 *
 * It mirrors createOrganisation() in lib/organisations.ts without importing it (the loader
 * runs outside the app). Like the Demo organisation it touches only its own rows
 * (id `fx-organisation-fresh`, slug `fresh`) and a rerun recreates it as new.
 */
import type { PrismaClient } from "@prisma/client";
import { giveWelcomeBonus } from "../../../lib/coins/welcome-bonus";

export const FRESH_LOGIN_EMAIL = "fresh@fixtures.local";
const USER_ID = "fx-user-fresh";
const ORGANISATION_ID = "fx-organisation-fresh";
const PROJECT_ID = "fx-project-fresh";
const SLUG = "fresh";
const NAME = "Fresh Start";

export async function loadFreshOrganisation(db: PrismaClient, passwordHash: string): Promise<void> {
  const existing = await db.organisation.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (existing && existing.id !== ORGANISATION_ID) throw new Error(`A "${SLUG}" organisation exists that the fixtures didn't make; not touching it.`);
  // Issues and ideas filed here locally restrict deleting it; everything else cascades.
  if (existing) {
    await db.bug.deleteMany({ where: { organisationId: ORGANISATION_ID } });
    await db.idea.deleteMany({ where: { organisationId: ORGANISATION_ID } });
    await db.organisation.delete({ where: { id: ORGANISATION_ID } });
  }

  const user = await db.user.upsert({
    where: { email: FRESH_LOGIN_EMAIL },
    update: { name: "Fresh Signup", passwordHash },
    create: { id: USER_ID, email: FRESH_LOGIN_EMAIL, name: "Fresh Signup", emailVerified: new Date(), emailNotifications: false, passwordHash },
    select: { id: true },
  });
  // A rerun gives the account a clean start: in no organisation but this one.
  await db.membership.deleteMany({ where: { userId: user.id } });
  await db.pointEntry.deleteMany({ where: { userId: user.id, sourceKey: `signup:${user.id}` } });

  await db.organisation.create({
    data: {
      id: ORGANISATION_ID,
      slug: SLUG,
      name: NAME,
      memberships: { create: { userId: user.id, role: "owner" } },
      // createOrganisation() starts every organisation with its Web project.
      projects: { create: { id: PROJECT_ID, slug: "web", name: "Web", workflow: { create: {} } } },
    },
  });
  // The welcome bonus, in Ziks: given once per account, so a rerun keeps the one it has (the ledger is append-only).
  await giveWelcomeBonus(db, user.id);
}
