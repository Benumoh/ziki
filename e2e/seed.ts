/**
 * A clean, known database for the end-to-end suite (#299).
 *
 * Empties every table (keeping Prisma's migration history), then adds the
 * standard issue types and one account per role per width.
 * Run with `pnpm e2e:seed` against a database that has had
 * `prisma migrate deploy`. Never point it at real data: it deletes all of it,
 * so it refuses any database whose name doesn't say it's for tests
 * (AGENTS.md: never reseed a shared or demo database).
 */
import { e2eDb } from "./db";
import bcrypt from "bcryptjs";
import {
  E2E_PASSWORD,
  OUTSIDE_ORG,
  OUTSIDE_PRIVATE,
  OUTSIDE_PRIVATE_ISSUE,
  OUTSIDE_PUBLIC,
  OUTSIDE_PUBLIC_ISSUE,
  ROLES,
  STALE_EMAIL,
  WIDTHS,
  emailFor,
  nameFor,
} from "./users";
import { loadFixtures } from "../scripts/dev/fixtures/load";

const prisma = e2eDb();

async function main() {
  const dbName = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
    } catch {
      return "";
    }
  })();
  if (!/(^|[_-])(e2e|test)([_-]|$)/i.test(dbName)) {
    throw new Error(
      `Refusing to wipe "${dbName || "(no database)"}": the e2e seed only runs on a database named for tests, like bug_tracker_e2e.`,
    );
  }

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }

  // The wipe above also removes the Zedu organisation the migration creates (#423).
  // Put it back with the migration's ids; issues are created inside it.
  const organisation = await prisma.organisation.create({
    data: { id: "organisation_zedu", slug: "zedu", name: "Ziki" },
  });
  await prisma.project.create({
    data: { id: "project_zedu", organisationId: organisation.id, slug: "zedu", name: "Ziki", workflow: { create: {} } },
  });

  for (const [name, description] of [
    ["Fix", "Issue fixes and defect resolutions"],
    ["Feat", "New features and enhancements"],
    ["Design", "UI/UX and visual design tasks"],
    ["Marketing", "Marketing and promotion related tasks"],
  ]) {
    await prisma.issueType.create({ data: { organisationId: organisation.id, name, description, isActive: true } });
  }

  // Cost 4: these are throwaway test accounts and the suite signs in often.
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 4);
  const roleFor = { user: "user", admin: "admin", super: "super_admin" } as const;
  for (const width of WIDTHS) {
    for (const role of ROLES) {
      await prisma.user.create({
        data: {
          email: emailFor(role, width),
          name: nameFor(role, width),
          role: roleFor[role],
          passwordHash,
          emailVerified: new Date(),
          emailNotifications: false,
        },
      });
    }
    await prisma.user.create({
      data: {
        email: STALE_EMAIL(width),
        name: `Stan Stale ${width === "desktop" ? "D" : "M"}`,
        role: "user",
        passwordHash,
        emailVerified: new Date(),
        emailNotifications: false,
      },
    });
  }
  // Every test account is a Zedu member. Site admins are organisation admins
  // too: delete and triage follow the membership role, not the site-wide one.
  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  await prisma.membership.createMany({
    data: users.map((user) => ({
      organisationId: organisation.id,
      userId: user.id,
      role: user.role === "super_admin" ? "owner" : user.role === "admin" ? "admin" : "member",
      // Answered already (#join-questions): otherwise the join questions open over every page a member visits and
      // cover what the tests click.
      joinAnsweredAt: new Date(),
    })),
  });
  // An organisation none of the test accounts belong to (#access-control): one public project and one private,
  // an issue in each, owned by someone outside the suite. access-control.spec.ts opens them as each role.
  const outsideOwner = await prisma.user.create({
    data: {
      email: "e2e-outside-owner@test.local",
      name: "Olu Outside",
      role: "user",
      passwordHash,
      emailVerified: new Date(),
      emailNotifications: false,
    },
  });
  const outside = await prisma.organisation.create({ data: { id: "organisation_e2e_outside", slug: OUTSIDE_ORG, name: "Outside Org" } });
  await prisma.membership.create({ data: { organisationId: outside.id, userId: outsideOwner.id, role: "owner" } });
  for (const [slug, visibility] of [[OUTSIDE_PUBLIC, "public"], [OUTSIDE_PRIVATE, "private"]] as const) {
    const project = await prisma.project.create({
      data: { id: `project_e2e_${slug}`, organisationId: outside.id, slug, name: `Outside ${visibility}`, goal: `The ${visibility} project.`, visibility, workflow: { create: {} } },
    });
    // In this order the public project's issue is #1 and the private one's #2 (numbers count per organisation).
    await prisma.bug.create({
      data: {
        organisationId: outside.id,
        projectId: project.id,
        title: visibility === "public" ? OUTSIDE_PUBLIC_ISSUE : OUTSIDE_PRIVATE_ISSUE,
        description: `An issue in the ${visibility} project.`,
        reporterId: outsideOwner.id,
        beneficiaryUserId: outsideOwner.id,
      },
    });
  }
  // The Demo organisation (scripts/dev/fixtures): realistic issues in every state,
  // in a organisation of its own, so the suite runs against data like real Ziki's.
  await loadFixtures({ db: prisma, quiet: true });
  console.log("e2e seed: database reset and seeded, with the Demo fixtures");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
