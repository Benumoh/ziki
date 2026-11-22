import { test, expect, fileIssue, expectNoHorizontalScroll, PROJECT } from "./fixtures";

test.use({ as: "admin" });

test("deletes an issue, finds it among deleted ones, and restores it", async ({ page, uniq }) => {
  const title = uniq("Delete and restore check");
  const url = await fileIssue(page, title);

  // Delete sits in the actions menu at the top right.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Delete issue" }).first().click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText(title);
  await confirm.getByRole("button", { name: "Delete issue" }).click();
  await expect(page.getByText(/This issue was deleted|deleted/i).first()).toBeVisible();

  await page.goto(`${PROJECT}/issues/all?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);

  await page.goto(`${PROJECT}/issues/all?deleted=true&q=${encodeURIComponent(title)}`);
  const deletedIssue = page.getByRole("link", { name: new RegExp(title) });
  await expect(deletedIssue).toHaveAttribute("href", new URL(url).pathname);
  await expectNoHorizontalScroll(page);
  await deletedIssue.click();
  // The deleted list opens the issue at its own address.
  await expect(page).toHaveURL(url.split("?")[0]);
  await page.getByRole("button", { name: /^Restore/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore issue" }).click();
  await expect(page.getByRole("button", { name: /^Restore/ })).toHaveCount(0);

  await page.goto(`${PROJECT}/issues/all?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test.describe("as a normal user", () => {
  test.use({ as: "user" });
  test("there is no delete control", async ({ page, uniq }) => {
    await fileIssue(page, uniq("No delete for users"));
    const menu = page.getByRole("button", { name: "More actions" });
    if (await menu.count()) await menu.click();
    await expect(page.getByRole("button", { name: "Delete issue" })).toHaveCount(0);
  });
});
