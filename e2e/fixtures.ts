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

/** The seeded project every spec works in (e2e/seed.ts); pages live under its organisation and slug (#project-urls). */
export const PROJECT = "/zedu/zedu";

/**
 * Filing an idea is limited to 10 a minute per person (ACTION_RATE_LIMITS.createBug in lib/rate-limit.ts), and every submit
 * counts. The busiest desktop user files close to that many in one run, and a retried test files more, so in a fast minute the
 * form answers "too fast" and the test used to fail on a limit it is not about. Wait it out and press the button again.
 */
const TOO_FAST = /doing that too fast/i;
const TOO_FAST_PAUSE_MS = 15_000;
const TOO_FAST_TRIES = 5;

/** Reports an issue through the form and returns its page URL. Waits out the create limit rather than failing on it. */
export async function reportIssue(page: Page, title: string, description = "Steps: open the page, click Save. Expected it to save; it shows a blank page.") {
  await page.goto(`${PROJECT}/issues/new`);
  await page.getByLabel("Title").fill(title);
  // The description is the Markdown editor's textarea.
  await page.locator("#description").fill(description);
  const heading = page.getByRole("heading", { level: 1, name: new RegExp(escapeRe(title)) });
  const tooFast = page.getByText(TOO_FAST);
  for (let attempt = 1; attempt < TOO_FAST_TRIES; attempt += 1) {
    await page.getByRole("button", { name: "Create issue" }).click();
    await expect(heading.or(tooFast)).toBeVisible();
    if (await heading.isVisible()) return page.url();
    // Limited: give this test the time it is about to wait, so the wait cannot time it out, then try again.
    test.info().setTimeout(test.info().timeout + TOO_FAST_PAUSE_MS + 10_000);
    await page.waitForTimeout(TOO_FAST_PAUSE_MS);
  }
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(heading).toBeVisible();
  return page.url();
}

/**
 * Reports an idea and converts it to an issue straight in the database, as a
 * manager agent would once its verdicts reach the threshold (#idea-table),
 * then opens the issue in its work view. Returns the issue's URL.
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
          organisationId: idea.organisationId,
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
  // The issue page: confirmations, bids, the next step and the actions menu.
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
