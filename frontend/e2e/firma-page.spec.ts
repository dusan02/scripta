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

// Company where latest year has null totalAssets but older years have it
// (NOVMANN s. r. o. — 2025 has null totalAssets, 2021-2024 have values)
const BALANCE_FALLBACK_ICO = "52967921";

// Company with very small profit relative to revenue (dual-axis chart test)
// (EXTEC s. r. o. — revenue ~270M, profit ~39K)
const DUAL_AXIS_ICO = "48180297";

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

  // ═══════════════════════════════════════════════════════════════
  // Data mapping & consistency tests (based on audit findings)
  // ═══════════════════════════════════════════════════════════════

  test("P&L table contains all expected row labels", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const plCard = page.locator("text=Výkaz ziskov a strát").locator("..");
    await expect(plCard).toBeVisible({ timeout: 10_000 });

    const expectedPLRows = [
      "Tržby",
      "Prevádzkové náklady",
      "Hrubá marža",
      "Osobné náklady",
      "Odpisy",
      "Zisk pred zdanením",
      "Úroky",
      "Daň z príjmu",
      "Zisk/Strata",
      "Cash flow",
    ];

    for (const label of expectedPLRows) {
      await expect(plCard.locator(`text=${label}`).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("Balance Sheet table contains all expected row labels", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const balanceCard = page.locator("text=/Súvaha.*v tis/").locator("..");
    await expect(balanceCard).toBeVisible({ timeout: 10_000 });

    const expectedBalanceRows = [
      "Celkové aktíva",
      "Neobežný majetok",
      "Obežný majetok",
      "Zásoby",
      "Pohľadávky",
      "Cash a ekvivalenty",
      "Vlastné imanie",
      "Základné imanie",
      "Krátkodobé záväzky",
      "Záväzky z obchodného styku",
      "Dlhodobé záväzky",
    ];

    for (const label of expectedBalanceRows) {
      await expect(balanceCard.locator(`text=${label}`).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("Balance Sheet section visible when latest year has null totalAssets", async ({ page }) => {
    // Regression test: previously the entire Balance Sheet section was hidden
    // when the latest year's totalAssets was null, even if older years had values.
    await page.goto(`/firma/${BALANCE_FALLBACK_ICO}`, { waitUntil: "networkidle" });

    // Súvaha section should be visible (using fallback to older year with totalAssets)
    await expect(page.locator("text=/Súvaha.*v tis/").first()).toBeVisible({ timeout: 15_000 });

    // Balance Sheet table should contain rows with actual values (not all "—")
    const balanceCard = page.locator("text=/Súvaha.*v tis/").locator("..");
    const celkoveAktivaRow = balanceCard.locator("tr").filter({ hasText: "Celkové aktíva" }).first();
    await expect(celkoveAktivaRow).toBeVisible({ timeout: 5_000 });

    // At least one cell should have a numeric value (not "—")
    const cells = celkoveAktivaRow.locator("td");
    const cellCount = await cells.count();
    let hasNumericValue = false;
    for (let i = 0; i < cellCount; i++) {
      const text = await cells.nth(i).textContent();
      if (text && text !== "—" && /\d/.test(text)) {
        hasNumericValue = true;
        break;
      }
    }
    expect(hasNumericValue).toBe(true);
  });

  test("Sankey chart tooltip does not show lone colon", async ({ page }) => {
    // Regression test: tooltip formatter returned ["",""] which Recharts
    // rendered as just a colon. Now returns null to hide the tooltip.
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const sankeyCard = page.locator("text=Štruktúra súvahy").locator("..");
    await expect(sankeyCard).toBeVisible({ timeout: 10_000 });

    // Hover over the Sankey chart area
    const sankeySvg = sankeyCard.locator("svg").first();
    await expect(sankeySvg).toBeVisible({ timeout: 5_000 });

    // Get the bounding box and hover over center
    const box = await sankeySvg.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

      // Wait briefly for tooltip to potentially appear
      await page.waitForTimeout(500);

      // Check that no tooltip shows just a colon
      const tooltipContent = await page.locator(".recharts-tooltip-wrapper").allTextContents();
      for (const text of tooltipContent) {
        // A lone colon or ": " with no meaningful content should not appear
        expect(text.trim()).not.toBe(":");
        expect(text.trim()).not.toBe(": ");
      }
    }
  });

  test("MetricCards show all 4 key metrics with values", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const expectedMetrics = ["Tržby", "Zisk / Strata", "Celkové aktíva", "Vlastné imanie"];

    for (const metric of expectedMetrics) {
      // Each metric label is a <p> with uppercase class
      const label = page.locator(`p`, { hasText: metric }).first();
      await expect(label).toBeVisible({ timeout: 10_000 });

      // The card container (parent of <p>) should contain a value div with currency or dash
      const cardDiv = label.locator("..");
      const allText = await cardDiv.textContent();
      expect(allText).toBeTruthy();
      // Should contain a currency indicator or dash (null values) in the card
      expect(allText!).toMatch(/€|mil|tis|—/);
    }
  });

  test("P&L table values are numeric or dash (not empty)", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const plCard = page.locator("text=Výkaz ziskov a strát").locator("..");
    await expect(plCard).toBeVisible({ timeout: 10_000 });

    // Get all data cells (not header cells)
    const dataCells = plCard.locator("tbody td:not(:first-child)");
    const count = await dataCells.count();

    // Should have at least some cells
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = (await dataCells.nth(i).textContent())?.trim();
      // Each cell should be either a number or "—" (never empty or undefined)
      expect(text).toBeTruthy();
      expect(text === "—" || /\d/.test(text!)).toBe(true);
    }
  });

  test("Balance Sheet table values are numeric or dash (not empty)", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    const balanceCard = page.locator("text=/Súvaha.*v tis/").locator("..");
    await expect(balanceCard).toBeVisible({ timeout: 10_000 });

    const dataCells = balanceCard.locator("tbody td:not(:first-child)");
    const count = await dataCells.count();

    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = (await dataCells.nth(i).textContent())?.trim();
      expect(text).toBeTruthy();
      expect(text === "—" || /\d/.test(text!)).toBe(true);
    }
  });

  test("revenue/profit chart has dual Y-axes", async ({ page }) => {
    // Regression test: profit was invisible when revenue was 1000x larger.
    // Now uses ComposedChart with dual-axis (left=revenue/tax, right=profit/loss).
    // Profit/loss is a Bar with green (profit) or red (loss) color.
    await page.goto(`/firma/${DUAL_AXIS_ICO}`, { waitUntil: "networkidle" });

    // The chart title is in an <h3> — find the card by looking for the heading
    const chartHeading = page.locator("h3", { hasText: "Tržby a zisk v čase" }).first();
    await expect(chartHeading).toBeVisible({ timeout: 15_000 });

    // Navigate up to the card container, then find the SVG chart
    const chartContainer = chartHeading.locator("xpath=ancestor::div[contains(@class, 'print-section') or contains(@class, 'grid')]").first();

    // Should have two YAxis elements (left and right)
    const yAxisElements = page.locator(".recharts-yAxis");
    await expect(yAxisElements.first()).toBeVisible({ timeout: 10_000 });
    const axisCount = await yAxisElements.count();
    expect(axisCount).toBeGreaterThanOrEqual(2);

    // Should have bar rectangles (Recharts renders bars as <rect>)
    const svgRects = page.locator(".recharts-surface rect");
    await expect(svgRects.first()).toBeVisible({ timeout: 10_000 });
    const rectCount = await svgRects.count();
    expect(rectCount).toBeGreaterThan(0);
  });

  test("financial ratios table has expected rows", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    // Ratios section should be visible on the page
    await expect(page.locator("text=/Finančné ukazovatele/i").first()).toBeVisible({ timeout: 10_000 });

    // Should contain zadĺženosť and bežná likvidita rows somewhere on the page
    await expect(page.locator("text=/Zadĺženosť|zadĺženost/i").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=/Bežná likvidita|bežná likvidita/i").first()).toBeVisible({ timeout: 5_000 });
  });

  test("table year columns match available statements", async ({ page }) => {
    await page.goto(`/firma/${VALID_ICO}`, { waitUntil: "networkidle" });

    // Get the P&L table header to extract year columns
    const plCard = page.locator("text=Výkaz ziskov a strát").locator("..");
    const headerCells = plCard.locator("thead th:not(:first-child)");
    const headerCount = await headerCells.count();

    // Should have at least 2 year columns (company has multiple statements)
    expect(headerCount).toBeGreaterThanOrEqual(2);

    // Each header should be a 4-digit year
    for (let i = 0; i < headerCount; i++) {
      const text = (await headerCells.nth(i).textContent())?.trim();
      expect(text).toMatch(/^\d{4}$/);
    }

    // P&L and Balance Sheet should have the same number of year columns
    // Balance Sheet has 2 sub-tables (Aktíva + Pasíva), each with same year headers
    const balanceCard = page.locator("text=/Súvaha.*v tis/").locator("..");
    const balanceHeaders = balanceCard.locator("thead th:not(:first-child)");
    const balanceHeaderCount = await balanceHeaders.count();
    // Balance has 2 sub-tables, so total headers = 2 * P&L headers
    expect(balanceHeaderCount).toBe(headerCount * 2);
  });
});
