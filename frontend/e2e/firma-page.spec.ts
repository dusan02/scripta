import { test, expect } from "@playwright/test";

/**
 * Smoke tests for the public company profile page (/firma/[ico]).
 *
 * These tests run against the production DB (read-only) and verify:
 * - Page loads with correct company name
 * - JSON-LD structured data is present and valid
 * - Breadcrumb is visible
 * - Financial charts/tables render when data exists
 * - Provenance section is present
 * - Related firms section renders
 * - 404 for non-existent IČO
 */

// Real company with financial data (MOZET, spol. s r.o.)
const VALID_ICO = "36000019";
const VALID_SLUG = "36000019-mozet-spol-s-r-o";

// Company with no financial data — should show "not available" message
// Using a known IČO that exists but may have limited data
const MINIMAL_ICO = "00112233"; // unlikely to exist

test.describe("Company profile page", () => {
  test("loads successfully for valid company", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    // Company name should appear
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });

    // Breadcrumb should be visible
    await expect(page.locator("text=Verifa.sk").first()).toBeVisible();
    await expect(page.locator("text=Firma").first()).toBeVisible();
  });

  test("redirects slug URL to canonical IČO URL", async ({ page }) => {
    await page.goto(`/firma/${VALID_SLUG}`, { waitUntil: "networkidle" });
    // Should redirect to /firma/{ICO}
    expect(page.url()).toMatch(/\/firma\/\d{8}$/);
  });

  test("contains Organization JSON-LD with correct fields", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const jsonLdScripts = await page.locator('script[type="application/ld+json"]').all();
    expect(jsonLdScripts.length).toBeGreaterThan(0);

    // Find the Organization schema with @id
    let orgSchema: any = null;
    let breadcrumbSchema: any = null;

    for (const script of jsonLdScripts) {
      const content = await script.textContent();
      if (!content) continue;
      const parsed = JSON.parse(content);

      // Could be a single object or have @graph
      const items = parsed["@graph"] || [parsed];
      for (const item of items) {
        if (item["@type"] === "Organization" && item["@id"]?.includes(VALID_ICO)) {
          orgSchema = item;
        }
        if (item["@type"] === "BreadcrumbList") {
          breadcrumbSchema = item;
        }
      }
    }

    // Organization schema assertions
    expect(orgSchema).not.toBeNull();
    expect(orgSchema.name).toBeTruthy();
    expect(orgSchema.legalName).toBeTruthy();
    expect(orgSchema.identifier).toBeTruthy();
    expect(orgSchema.identifier["@type"]).toBe("PropertyValue");
    expect(orgSchema.identifier.name).toBe("IČO");
    expect(orgSchema.identifier.value).toBe(VALID_ICO);
    expect(orgSchema.url).toContain(VALID_ICO);

    // BreadcrumbList schema assertions
    expect(breadcrumbSchema).not.toBeNull();
    const items = breadcrumbSchema.itemListElement;
    expect(items.length).toBe(3);
    expect(items[0].name).toBe("Verifa.sk");
    expect(items[1].name).toBe("Firma");
    expect(items[2].name).toBeTruthy();
  });

  test("does NOT contain Dataset JSON-LD", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const scripts = await page.locator('script[type="application/ld+json"]').all();
    for (const script of scripts) {
      const content = await script.textContent();
      if (!content) continue;
      const parsed = JSON.parse(content);
      const items = parsed["@graph"] || [parsed];
      for (const item of items) {
        expect(item["@type"]).not.toBe("Dataset");
      }
    }
  });

  test("shows provenance section with data source", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    // Provenance text should mention RÚZ
    const provenanceText = page.locator("text=/RÚZ|Register účtovných závierok/i").first();
    await expect(provenanceText).toBeVisible({ timeout: 10_000 });
  });

  test("renders financial data when available", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    // Metric cards should be visible (Tržby, Zisk, Aktíva, Imanie)
    await expect(page.locator("text=/Tržby|Revenue/i").first()).toBeVisible({ timeout: 10_000 });

    // Chart cards should be present
    await expect(page.locator("text=/Štruktúra súvahy|Balance/i").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=/Súvaha/i").first()).toBeVisible({ timeout: 10_000 });
  });

  test("renders financial ratios with methodology link", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    // Financial ratios section
    await expect(page.locator("text=/Finančné ukazovatele|Financial Ratios/i").first()).toBeVisible({ timeout: 10_000 });

    // Methodology link to /slovnik
    const slovnikLink = page.locator('a[href*="slovnik"]').first();
    await expect(slovnikLink).toBeVisible({ timeout: 10_000 });
  });

  test("renders related firms section", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    // Related firms heading
    await expect(page.locator("text=/Súvisiace firmy|Related/i").first()).toBeVisible({ timeout: 10_000 });
  });

  test("returns 404 page for invalid IČO", async ({ page }) => {
    // Use invalid IČO (1 digit) — parseCompanySlug will reject it
    // Note: Next.js ISR may return 200 status but render the 404 page
    await page.goto(`/firma/1`, { waitUntil: "domcontentloaded" });
    // Check for 404-related content
    const body = await page.locator("body").textContent();
    expect(body).toMatch(/404|not found|nenálezen|nenájden|neexist/i);
  });

  test("has correct meta tags for SEO", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const title = await page.title();
    expect(title.length).toBeGreaterThan(10);
    // Title should contain the company name or IČO
    expect(title).toMatch(/MOZET|36000019/i);

    const metaDescription = await page.locator('meta[name="description"]').getAttribute("content");
    expect(metaDescription).toBeTruthy();
    expect(metaDescription!.length).toBeGreaterThan(50);
  });
});
