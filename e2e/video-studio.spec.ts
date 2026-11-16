import { test, expect, PROJECT, expectNoHorizontalScroll } from "./fixtures";

test("make a marketing video from an idea through draft and final", async ({ page }, testInfo) => {
  await page.goto(`${PROJECT}/marketing`);
  await page.getByRole("link", { name: /Create video/ }).click();
  await expect(page).toHaveURL(new RegExp(`${PROJECT}/marketing/video$`));
  await page.getByRole("button", { name: /Give me ideas/ }).click();
  await page.getByRole("button", { name: /Morning rush, made calm/ }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(/A queue of tired commuters/);
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Create draft (8 credits)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your draft", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("232 credits", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create final video (40 credits)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your video is ready", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Download MP4", exact: true })).toBeVisible();
  await expect(page.getByText("192 credits", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await testInfo.attach("finished-video", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.getByRole("tab", { name: "My videos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Morning rush, made calm", exact: true })).toBeVisible();
});
