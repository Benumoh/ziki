import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests (#299). Run against a production build with a seeded
 * database: `pnpm e2e` locally (see e2e/README.md), the `e2e` job in CI.
 *
 * Two widths, each with its own seeded users, so neither run trips the
 * per-user rate limits the other one is using up.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    // What a failure leaves behind for whoever looks at it.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...(process.env.E2E_CHROMIUM ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM } } : {}),
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      use: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],
  // CI builds once, then this starts it. Locally, point E2E_BASE_URL at a
  // server you already have running and this is skipped.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm start`,
        url: `${baseURL}/login`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: { PORT: String(PORT), AUTH_PASSWORD_LOGIN: "true", SITE_URL_ALLOW_LOOPBACK: "true" },
      },
});
