import { expectNoA11yViolations } from "./axe";
import { fileIssue, test, PROJECT } from "./fixtures";

/**
 * Real-browser accessibility gate (#A11Y). The jsdom unit tests cover the
 * components in isolation; this covers whole rendered pages, including the
 * colour contrast that jsdom cannot compute.
 */
test.describe("accessibility", () => {
  // A full-page axe scan is heavier than the app's normal interactions, so
  // this file gets more room than the suite's 30s default.
  test.describe.configure({ timeout: 60_000 });

  test.describe("signed out", () => {
    test.use({ as: null });

    test("the sign-in page", async ({ page }) => {
      await page.goto("/login");
      await expectNoA11yViolations(page);
    });
  });

  test.describe("as a user", () => {
    test.use({ as: "user" });

    test("the issue list", async ({ page }) => {
      await page.goto(`${PROJECT}/issues/open`);
      await expectNoA11yViolations(page);
    });

    test("the report form", async ({ page }) => {
      await page.goto(`${PROJECT}/issues/new`);
      await expectNoA11yViolations(page);
    });

    test("an issue page", async ({ page, uniq }) => {
      await fileIssue(page, uniq("A11y target"));
      await expectNoA11yViolations(page);
    });

    test("the settings page", async ({ page }) => {
      await page.goto("/settings");
      await expectNoA11yViolations(page);
    });

    test("the agent settings page", async ({ page }) => {
      await page.goto("/settings/agents");
      await expectNoA11yViolations(page);
    });

    test("the pairing approval page", async ({ page }) => {
      await page.goto("/settings/agents/pair");
      await expectNoA11yViolations(page);
    });
  });

  test.describe("as an admin", () => {
    test.use({ as: "admin" });

    test("the organisation admin screens", async ({ page }) => {
      await page.goto(`${PROJECT}/org/team`);
      await expectNoA11yViolations(page);

      await page.goto(`${PROJECT}/org/types`);
      await expectNoA11yViolations(page);
    });
  });

  test.describe("as a super admin", () => {
    test.use({ as: "super" });

    test("the site admin screen", async ({ page }) => {
      await page.goto("/superadmin/users");
      await expectNoA11yViolations(page);
    });
  });
});
