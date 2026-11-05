import { test as base, expect, type Page } from "@playwright/test";
import { authFile, nameFor, widthOf, type Role, type Width } from "./users";
import { e2eDb } from "./db";

type Options = { as: Role | null };
type Fixtures = { width: Width; me: string; uniq: (label: string) => string };

/**
 * Fixture callbacks name their second argument `provide`, not Playwright's
 * usual `use`, so the React hooks lint rule doesn't mistake it for React's.
 *
 * `test.use({ as: "admin" })` signs a spec in as that role, at whichever
 * width the project is running. `as: null` starts signed out.
 */
export const test = base.extend<Fixtures & Options>({
  as: ["user", { option: true }],
  width: async ({}, provide, testInfo) => provide(widthOf(testInfo.project.name)),
  me: async ({ as, width }, provide) => provide(as ? nameFor(as, width) : ""),
  storageState: async ({ as, width }, provide) => provide(as ? authFile(as, width) : { cookies: [], origins: [] }),
  // Every test starts as a visitor who already answered the cookie banner
  // (declined), so it never sits over the page being tested.
  page: async ({ page }, provide) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("ziki-cookie-consent", JSON.stringify({ choice: "denied", at: Date.now() }));
      } catch {
        // Storage blocked: the banner shows, as it would for that visitor.
      }
    });
    await provide(page);
  },
  // Titles unique to this run, width and test, so parallel tests never
  // find each other's issues.
  uniq: async ({ width }, provide, testInfo) => {
    const stamp = `${Date.now().toString(36)}${testInfo.workerIndex}`;
    await provide((label: string) => `${label} ${width} ${stamp}`);
  },
});

export { expect };

/** The seeded project every spec works in (e2e/seed.ts); pages live under its slug (#project-urls). */
export const PROJECT = "/zedu";

/** Reports an issue through the form and returns its page URL. */
export async function reportIssue(page: Page, title: string, description = "Steps: open the page, click Save. Expected it to save; it shows a blank page.") {
  await page.goto(`${PROJECT}/issues/new`);
  await page.getByLabel("Title").fill(title);
  // The description is the Markdown editor's textarea.
  await page.locator("#description").fill(description);
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(escapeRe(title)) })).toBeVisible();
  return page.url();
}

/**
 * Reports an idea and converts it to an issue straight in the database, as a
 * manager agent would once its verdicts reach the threshold (#idea-table),
 * then opens the issue. Returns the issue's URL.
 */
export async function fileIssue(page: Page, title: string) {
  const ideaUrl = await reportIssue(page, title);
  const ideaNumber = Number(new URL(ideaUrl).pathname.split("/").pop());
  const prisma = e2eDb();
  let issueNumber: number;
  try {
    issueNumber = await prisma.$transaction(async (tx) => {
      const idea = await tx.idea.findFirstOrThrow({ where: { number: ideaNumber, title } });
      const issue = await tx.bug.create({
        data: {
          tenantId: idea.tenantId,
          projectId: idea.projectId,
          title: idea.title,
          description: idea.description,
          reporterId: idea.reporterId,
          beneficiaryUserId: idea.beneficiaryUserId,
          watches: { create: { userId: idea.reporterId } },
        },
        select: { id: true, number: true },
      });
      await tx.idea.update({ where: { id: idea.id }, data: { status: "converted", convertedAt: new Date(), issueId: issue.id } });
      return issue.number;
    });
  } finally {
    await prisma.$disconnect();
  }
  await page.goto(`${PROJECT}/${issueNumber}`);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(escapeRe(title)) })).toBeVisible();
  return page.url();
}

export function escapeRe(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fails if the page is wider than the screen: the #255-style regression. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}
