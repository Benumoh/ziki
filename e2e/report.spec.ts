import { test, expect, reportIssue, expectNoHorizontalScroll, PROJECT } from "./fixtures";

test("reports an idea and finds it on the Ideas tab", async ({ page, uniq, me }) => {
  const title = uniq("Save button shows a blank page");
  await reportIssue(page, title);
  await expect(page.getByText(me).filter({ visible: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto(`${PROJECT}/new?q=${encodeURIComponent(title)}`);
  // Fixes (the new ideas) are cards that unfold in place (#work-feed); the whole idea is a link inside the opened card.
  const card = page.getByRole("button", { name: new RegExp(title) });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("link", { name: "Open the full idea" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("says what's missing instead of submitting a bad report", async ({ page }) => {
  await page.goto(`${PROJECT}/issues/new`);
  await page.getByLabel("Title").fill("ab");
  await page.locator("#description").fill("short");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(/\/issues\/new/);
  await expectNoHorizontalScroll(page);
});
