import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for Scripta/Verifa.
 *
 * Tests run against a local dev server (next dev) on port 3000.
 * Start the server manually or let Playwright launch it via webServer config.
 *
 * Critical paths covered:
 * - Auth: login flow, unauthorized access
 * - Billing: webhook → credit grant, chargeback → credit revocation
 * - Reports: credit check, report creation, download authorization (IDOR)
 * - Cron: stuck-job recovery
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Sequential — tests share DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker — DB tests are not safe in parallel
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Ignore HTTPS errors for local dev (self-signed certs)
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Auto-start the dev server if not already running.
  // Uncomment when running locally; in CI, start the server separately.
  // webServer: {
  //   command: "npm run dev",
  //   url: "http://localhost:3000",
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 60_000,
  // },
});
