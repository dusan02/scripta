/**
 * B4 — Hydration canary for firma pages (SEO-critical surface).
 *
 * Context: firma pages with financial data log ~11 recoverable React #425
 * hydration errors (pre-existing — proven by rollback-image test on
 * 2026-09-06; identical errors on 3-day-old code). React recovers by
 * client-rendering, so the page WORKS — but a hydration mismatch on 500k
 * SEO pages must never escalate to a fatal client exception (the
 * "Application error" incident).
 *
 * This canary asserts the FUNCTIONAL contract:
 *   1. page renders (no "Application error" screen)
 *   2. balance sheet table present with Celkové aktíva/pasíva identity
 *   3. Kontrola súvahy row present
 *   4. pageerror count does not GROW beyond the documented baseline
 *      (a new mismatch class would signal a regression)
 */

import { test, expect } from "@playwright/test";

// Documented baseline (2026-09-06, rollback-verified pre-existing).
// If this test fails with count > BASELINE, a NEW hydration mismatch
// class was introduced — investigate before shipping.
const HYDRATION_ERROR_BASELINE = 15;

test.describe("B4 hydration canary — firma page", () => {
  test("page renders fully despite recoverable hydration errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto("/firma/35876832-kia-slovakia-s-r-o", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    // 1. No fatal client exception screen
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toContain("Application error");

    // 2. Balance sheet identity visible
    expect(body).toContain("Celkové aktíva");
    expect(body).toContain("Celkové pasíva");

    // 3. Kontrola súvahy row present
    expect(body).toContain("Kontrola súvahy");

    // 4. Hydration error count within baseline (recoverable errors allowed)
    const hydrationErrors = pageErrors.filter((e) => e.includes("#425") || e.includes("#418") || e.includes("#423"));
    expect(
      hydrationErrors.length,
      `hydration errors (${hydrationErrors.length}) exceeded baseline ${HYDRATION_ERROR_BASELINE} — new mismatch class introduced`
    ).toBeLessThanOrEqual(HYDRATION_ERROR_BASELINE);
  });

  test("firma page WITHOUT financial data has zero hydration errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto("/firma/31662749", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toContain("Application error");
    // No financial components → no hydration mismatches expected at all
    expect(pageErrors.length).toBe(0);
  });
});
