import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env so test files can read CRON_SECRET, WORKER_SECRET, etc.
loadEnv();

// Billing webhook tests use a fake user ID ("test-user-id"), so the webhook
// must NOT pass signature verification (otherwise it tries to create a wallet
// for a non-existent user → FK violation → 500).
// Override the dev secret with a test-only value so signature verification
// always fails gracefully (400) in E2E tests.
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

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
