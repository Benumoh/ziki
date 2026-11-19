import { e2eDb } from "./db";
import { test, expect, PROJECT } from "./fixtures";
import { E2E_PASSWORD, STALE_EMAIL, emailFor, nameFor } from "./users";

test.use({ as: null });

test("signs in with email and password", async ({ page, width }) => {
  await page.goto(`${PROJECT}/issues/open`);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(emailFor("user", width));
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // A stage's list opens its place on the Overview (#work-feed): Open is the Work Feed filtered to Open.
  await expect(page).toHaveURL(/\/zedu\/zedu\/issues\/your-work\?state=open/);
  // Signed in as the right person: the session says so.
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session.user.name).toBe(nameFor("user", width));
});

test("refuses a wrong password without signing in", async ({ page, width }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor("user", width));
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a session whose account was deleted goes back to sign-in, not a crash", async ({ page, width }) => {
  const email = STALE_EMAIL(width);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signing in opens the Overview.
  await expect(page).toHaveURL(/\/issues\/your-work/);

  const prisma = e2eDb();
  try {
    await prisma.user.delete({ where: { email } });
  } finally {
    await prisma.$disconnect();
  }

  const response = await page.goto(`${PROJECT}/issues/open`);
  expect(response?.status()).toBeLessThan(500);
  await expect(page).toHaveURL(/\/login/);
});
