import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { OUTSIDE_ORG, OUTSIDE_PRIVATE, OUTSIDE_PRIVATE_ISSUE, OUTSIDE_PUBLIC, OUTSIDE_PUBLIC_ISSUE } from "./users";

/**
 * Public and private projects in a real browser (#access-control), for each role in the access-control audit
 * (docs/access-control-audit.md). The seed's outside organisation has none of the test accounts as members:
 * a public project with issue #1 and a private one with issue #2.
 *
 * A private project someone can't see must look exactly like one that doesn't exist, and its issue's title must
 * never reach the page. Each check attaches a screenshot to the report as evidence.
 */

const PUBLIC = `/${OUTSIDE_ORG}/${OUTSIDE_PUBLIC}`;
const PRIVATE = `/${OUTSIDE_ORG}/${OUTSIDE_PRIVATE}`;
const NOT_FOUND = /couldn.t find/i;

async function evidence(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function expectHidden(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText(NOT_FOUND).first()).toBeVisible();
  await expect(page.getByText(OUTSIDE_PRIVATE_ISSUE)).toHaveCount(0);
  await expect(page.getByText("Outside private", { exact: true })).toHaveCount(0);
  expect(await page.title()).not.toContain("Outside private");
}

test.describe("signed-out visitor", () => {
  test.use({ as: null });

  test("sees a public project and its public issues", async ({ page }, testInfo) => {
    await page.goto(PUBLIC);
    await expect(page.getByRole("heading", { name: "Outside public" }).first()).toBeVisible();
    await expect(page.getByText(/sign in to ask to join/i).first()).toBeVisible();
    await evidence(page, testInfo, "signed-out: public project overview");

    await page.goto(`${PUBLIC}/public-issues`);
    await expect(page.getByText(OUTSIDE_PUBLIC_ISSUE).first()).toBeVisible();
    await evidence(page, testInfo, "signed-out: public issues list");
  });

  test("gets not found for a private project, its issue and its public-issues page", async ({ page }, testInfo) => {
    await expectHidden(page, PRIVATE);
    await evidence(page, testInfo, "signed-out: private project overview is not found");
    await expectHidden(page, `${PRIVATE}/public-issues`);
    await expectHidden(page, `${PRIVATE}/public-issues/2`);
    await evidence(page, testInfo, "signed-out: private public-issue page is not found");
  });

  test("is never sent the private project by the public ideas or search APIs", async ({ request }) => {
    const ideas = await request.get(`/api/public/projects/${OUTSIDE_ORG}/${OUTSIDE_PRIVATE}/ideas?q=outside`);
    expect(await ideas.text()).not.toContain(OUTSIDE_PRIVATE_ISSUE);
    // Signed out, search is refused: the middleware sends it to sign in, or the route answers 401.
    const suggest = await request.get(`/api/issues/suggest?q=outside`, { maxRedirects: 0 });
    expect([302, 303, 307, 401]).toContain(suggest.status());
    expect(await suggest.text()).not.toContain(OUTSIDE_PRIVATE_ISSUE);
  });
});

for (const role of ["user", "admin"] as const) {
  test.describe(`signed-in non-member (${role === "user" ? "regular user" : "site admin of another organisation"})`, () => {
    test.use({ as: role });

    test("opens the public project and can ask to join it", async ({ page }, testInfo) => {
      await page.goto(PUBLIC);
      await expect(page.getByRole("heading", { name: "Outside public" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /request to join/i }).first()).toBeVisible();
      await evidence(page, testInfo, `${role}: public project with Request to join`);
    });

    test("gets not found for the private project and its issue, as for one that doesn't exist", async ({ page }, testInfo) => {
      await expectHidden(page, PRIVATE);
      await evidence(page, testInfo, `${role}: private project is not found`);
      await expectHidden(page, `${PRIVATE}/2`);
      await expectHidden(page, `${PRIVATE}/ideas`);
      await expectHidden(page, `${PRIVATE}/org/members`);
      await expectHidden(page, `/${OUTSIDE_ORG}/no-such-project-e2e`);
      await evidence(page, testInfo, `${role}: a project that doesn't exist looks the same`);
    });
  });
}

test.describe("site super admin", () => {
  test.use({ as: "super" });

  test("opens the private project", async ({ page }, testInfo) => {
    await page.goto(PRIVATE);
    await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
    await expect(page.getByText("Outside private").first()).toBeVisible();
    await evidence(page, testInfo, "super admin: private project opens");
  });
});
