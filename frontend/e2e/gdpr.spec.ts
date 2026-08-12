/**
 * E2E tests for GDPR compliance — cookie consent gate for GA4.
 *
 * Tests:
 * 1. GA4 script is NOT loaded when user declines cookies
 * 2. GA4 script IS loaded when user accepts cookies
 * 3. GA4 script is NOT loaded when no consent decision has been made
 * 4. Cookie banner is visible for first-time visitors
 * 5. Cookie banner disappears after accepting
 * 6. Cookie banner disappears after declining
 * 7. GA4 loads after accepting when it was previously declined
 */

import { test, expect, Page } from "@playwright/test";

const CONSENT_KEY = "verifa-cookie-consent";
const GA4_SCRIPT_PATTERN = /googletagmanager\.com\/gtag\/js/;

async function clearConsent(page: Page) {
  await page.addInitScript((key) => {
    localStorage.removeItem(key);
  }, CONSENT_KEY);
}

async function setConsent(page: Page, accepted: boolean) {
  await page.addInitScript((opts: { key: string; val: boolean }) => {
    localStorage.setItem(opts.key, JSON.stringify({
      necessary: true,
      analytics: opts.val,
      accepted: new Date().toISOString(),
      ...(opts.val ? {} : { declined: true }),
    }));
  }, { key: CONSENT_KEY, val: accepted });
}

test.describe("GDPR — cookie consent gate for GA4", () => {
  test.beforeEach(async ({ page }) => {
    await clearConsent(page);
  });

  test("GA4 script is NOT loaded without consent decision", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    const ga4Scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
    );
    expect(ga4Scripts.some((src) => GA4_SCRIPT_PATTERN.test(src))).toBe(false);
  });

  test("GA4 script is NOT loaded when user declines cookies", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Click decline
    const declineBtn = page.locator("button", { hasText: /odmietnuť|decline|ablehnen|odmítnout|elutasítás|odrzuć/i });
    if (await declineBtn.isVisible()) {
      await declineBtn.click();
    }
    await page.waitForTimeout(1000);

    const ga4Scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
    );
    expect(ga4Scripts.some((src) => GA4_SCRIPT_PATTERN.test(src))).toBe(false);
  });

  test("GA4 script IS loaded when user accepts cookies", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Click accept
    const acceptBtn = page.locator("button", { hasText: /prijať|accept|akzeptieren|přijmout|elfogadás|akceptuj/i });
    await acceptBtn.click();
    await page.waitForTimeout(2000);

    const ga4Scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
    );
    expect(ga4Scripts.some((src) => GA4_SCRIPT_PATTERN.test(src))).toBe(true);
  });

  test("GA4 script IS loaded when consent was previously given", async ({ page }) => {
    await setConsent(page, true);
    await page.goto("/");
    await page.waitForTimeout(2000);

    const ga4Scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
    );
    expect(ga4Scripts.some((src) => GA4_SCRIPT_PATTERN.test(src))).toBe(true);
  });

  test("GA4 script is NOT loaded when consent was previously declined", async ({ page }) => {
    await setConsent(page, false);
    await page.goto("/");
    await page.waitForTimeout(2000);

    const ga4Scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
    );
    expect(ga4Scripts.some((src) => GA4_SCRIPT_PATTERN.test(src))).toBe(false);
  });

  test("cookie banner is visible for first-time visitors", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    const banner = page.locator("text=/nevyhnutné cookies|necessary cookies|notwendige cookies|nezbytné cookies|szükséges sütiket|niezbędnych plików cookie/i");
    await expect(banner).toBeVisible();
  });

  test("cookie banner disappears after accepting", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    const acceptBtn = page.locator("button", { hasText: /prijať|accept|akzeptieren|přijmout|elfogadás|akceptuj/i });
    await acceptBtn.click();
    await page.waitForTimeout(500);

    const banner = page.locator("text=/nevyhnutné cookies|necessary cookies|notwendige cookies|nezbytné cookies|szükséges sütiket|niezbędnych plików cookie/i");
    await expect(banner).not.toBeVisible();
  });

  test("cookie banner disappears after declining", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    const declineBtn = page.locator("button", { hasText: /odmietnuť|decline|ablehnen|odmítnout|elutasítás|odrzuć/i });
    await declineBtn.click();
    await page.waitForTimeout(500);

    const banner = page.locator("text=/nevyhnutné cookies|necessary cookies|notwendige cookies|nezbytné cookies|szükséges sütiket|niezbędnych plików cookie/i");
    await expect(banner).not.toBeVisible();
  });

  test("GA4 loads after accepting when previously declined", async ({ page }) => {
    // Start with no consent
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Decline first
    const declineBtn = page.locator("button", { hasText: /odmietnuť|decline|ablehnen|odmítnout|elutasítás|odrzuć/i });
    await declineBtn.click();
    await page.waitForTimeout(500);

    // Verify GA4 not loaded
    let ga4Scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
    );
    expect(ga4Scripts.some((src) => GA4_SCRIPT_PATTERN.test(src))).toBe(false);

    // Reload page — banner should not appear (consent stored as declined)
    await page.reload();
    await page.waitForTimeout(2000);

    // Manually set consent to accepted via localStorage
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({
        necessary: true,
        analytics: true,
        accepted: new Date().toISOString(),
      }));
      window.dispatchEvent(new Event("cookie-consent-change"));
    }, CONSENT_KEY);
    await page.waitForTimeout(2000);

    // Now GA4 should be loaded
    ga4Scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src)
    );
    expect(ga4Scripts.some((src) => GA4_SCRIPT_PATTERN.test(src))).toBe(true);
  });
});
