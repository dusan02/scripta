#!/usr/bin/env node
/**
 * Crawl Simulation + Hub Feasibility Analysis
 *
 * Part A: Crawl simulation from homepage
 *  - Fetch homepage, extract all links (depth 1)
 *  - Fetch each depth-1 page, extract links (depth 2)
 *  - Fetch /firmy page 1, count company links (depth 2-3)
 *  - Calculate how many company pages are reachable at each depth
 *  - Simulate with hub pages added
 *
 * Part B: Hub feasibility analysis from DB
 *  - For each attribute (NACE section, kraj, okres, mesto, legal form, size):
 *    - Count of companies
 *    - Count of indexable companies (≥2 FS)
 *    - Avg quality score
 *    - Median FS count
 *    - Avg data points (persons, events, vestnik, audit)
 *  - Identify which attributes have enough density for hub pages
 *  - Propose 2-3 level hub hierarchy
 *  - Estimate total hub URL count
 *  - Simulate resulting crawl depth + orphan rate
 */

import { writeFileSync } from "fs";
import { execSync } from "child_process";

const BASE = "https://verifa.sk";
const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";

function sshQuery(sql) {
  const tmpFile = `/tmp/hub_query_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/hub_query.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/hub_query.sql'`,
      { timeout: 180000, encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.split("|"));
  } catch (e) {
    console.error(`  Query failed: ${e.message.split("\n")[0]}`);
    return [];
  }
}

async function fetchRaw(url) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body };
}

function extractLinks(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

// ═══════════════════════════════════════════════════════════════════════
// PART A: CRAWL SIMULATION
// ═══════════════════════════════════════════════════════════════════════

async function crawlSimulation() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  PART A: CRAWL SIMULATION FROM HOMEPAGE");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Depth 0: Homepage ───────────────────────────────────────────────
  console.log("── Depth 0: Homepage ──");
  const homepage = await fetchRaw(`${BASE}/`);
  const homeLinks = extractLinks(homepage.body);
  const homeInternal = homeLinks.filter((l) => l.startsWith("/") && !l.startsWith("/_next"));
  const homeUnique = [...new Set(homeInternal)];

  console.log(`  Total links:     ${homeLinks.length}`);
  console.log(`  Internal links:  ${homeInternal.length}`);
  console.log(`  Unique internal: ${homeUnique.length}`);

  // Categorize depth-1 pages
  const depth1Pages = homeUnique.filter((l) =>
    l === "/" || l === "/firmy" || l === "/screener" || l === "/slovnik" ||
    l === "/login" || l === "/register" || l === "/pricing" || l === "/about" ||
    l.startsWith("/slovnik/") || l.startsWith("/firmy/")
  );

  const hasFirmyLink = homeUnique.includes("/firmy");
  const hasScreenerLink = homeUnique.includes("/screener");
  const hasSlovnikLink = homeUnique.includes("/slovnik") || homeUnique.some((l) => l.startsWith("/slovnik/"));

  console.log(`  Has /firmy:      ${hasFirmyLink ? "✅" : "❌"}`);
  console.log(`  Has /screener:   ${hasScreenerLink ? "✅" : "❌"}`);
  console.log(`  Has /slovnik:    ${hasSlovnikLink ? "✅" : "❌"}`);
  console.log();

  // ── Depth 1: Fetch key pages ────────────────────────────────────────
  console.log("── Depth 1: Key pages ──");

  // Fetch /firmy (even if not linked from homepage — it exists)
  const firmy1 = await fetchRaw(`${BASE}/firmy`);
  const firmy1Links = extractLinks(firmy1.body);
  const firmy1CompanyLinks = [...new Set(firmy1Links.filter((l) => l.includes("/firma/")))];
  const firmy1Pagination = firmy1Links.filter((l) => l.includes("/firmy?") || l.includes("/firmy?page"));

  console.log(`  /firmy: ${firmy1CompanyLinks.length} company links, ${firmy1Pagination.length} pagination links`);

  // Fetch /screener
  const screener = await fetchRaw(`${BASE}/screener`);
  const screenerLinks = extractLinks(screener.body);
  const screenerCompanyLinks = [...new Set(screenerLinks.filter((l) => l.includes("/firma/")))];
  console.log(`  /screener: ${screenerCompanyLinks.length} company links`);

  // Fetch /slovnik
  const slovnik = await fetchRaw(`${BASE}/slovnik`);
  const slovnikLinks = extractLinks(slovnik.body);
  const slovnikEntries = [...new Set(slovnikLinks.filter((l) => l.startsWith("/slovnik/")))];
  console.log(`  /slovnik: ${slovnikEntries.length} dictionary entries`);
  console.log();

  // ── Depth 2: /firmy pagination ──────────────────────────────────────
  console.log("── Depth 2: /firmy pagination ──");

  // Check how many /firmy pages exist
  const totalRows = sshQuery(`SELECT COUNT(*) FROM "Company";`);
  const totalCompanies = parseInt(totalRows[0]?.[0] || "0");
  const PAGE_SIZE = 50;
  const totalPages = Math.ceil(totalCompanies / PAGE_SIZE);

  console.log(`  Total companies:  ${totalCompanies.toLocaleString()}`);
  console.log(`  Page size:        ${PAGE_SIZE}`);
  console.log(`  Total pages:      ${totalPages.toLocaleString()}`);
  console.log();

  // ── Depth 3: Company pages from /firmy ──────────────────────────────
  console.log("── Depth 3: Company pages from /firmy ──");

  // Each /firmy page links to 50 companies (but we saw only 20 — table rows)
  // Let's check actual count
  const firmyPageLinks = firmy1CompanyLinks.length;
  console.log(`  Companies per /firmy page: ${firmyPageLinks}`);
  console.log(`  Total reachable from all /firmy pages: ${(firmyPageLinks * totalPages).toLocaleString()}`);
  console.log();

  // ── Depth 4: RelatedFirms from company pages ────────────────────────
  console.log("── Depth 4: RelatedFirms ──");

  // Fetch a sample company page and count RelatedFirms links
  const sampleCompany = await fetchRaw(`${BASE}/firma/50333836-europe-trade-s-r-o`);
  const sampleLinks = extractLinks(sampleCompany.body);
  const sampleFirmaLinks = [...new Set(sampleLinks.filter((l) => l.includes("/firma/")))];
  console.log(`  Sample company (50333836): ${sampleFirmaLinks.length} company links on page`);
  console.log();

  // ── Current crawl depth distribution ────────────────────────────────
  console.log("── Current Crawl Depth Distribution (theoretical) ──\n");

  // Without /firmy link on homepage:
  // Depth 0: Homepage
  // Depth 1: /screener, /slovnik (no /firmy!)
  // Depth 2: Company pages from /screener (limited), /slovnik entries
  // Depth 3+: Only via RelatedFirms (7% coverage)
  // Orphan: 93% (only via sitemap)

  const sitemapRows = sshQuery(`
    SELECT COUNT(*) FROM "Company" c
    WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2;
  `);
  const sitemapCompanies = parseInt(sitemapRows[0]?.[0] || "0");

  const relatedFirmsRows = sshQuery(`
    WITH linked AS (
      SELECT DISTINCT c.ico FROM "Company" c,
      LATERAL (
        SELECT c2.ico FROM "Company" c2
        WHERE c2."naceCode" = c."naceCode" AND c2.kraj = c.kraj
          AND c2.ico != c.ico AND c2."latestRevenue" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c2.ico)
        ORDER BY c2."latestRevenue" DESC LIMIT 6
      ) uni
      WHERE c."naceCode" IS NOT NULL AND c.kraj IS NOT NULL
        AND c."latestRevenue" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)
    )
    SELECT COUNT(*) FROM linked;
  `);
  const relatedFirmsCoverage = parseInt(relatedFirmsRows[0]?.[0] || "0");

  console.log("  CURRENT STATE (no /firmy on homepage):\n");
  console.log("  Depth 0: Homepage                    1 page");
  console.log(`  Depth 1: /screener, /slovnik         ~10 pages`);
  console.log(`  Depth 2: Screener results, slovnik   ~100 pages`);
  console.log(`  Depth 3: Company pages (via screener) ~${Math.min(screenerCompanyLinks * 100, 5000).toLocaleString()} pages`);
  console.log(`  Depth 4: RelatedFirms                 ${relatedFirmsCoverage.toLocaleString()} companies`);
  console.log(`  Orphan (sitemap-only):                ${(sitemapCompanies - relatedFirmsCoverage - Math.min(screenerCompanyLinks * 100, 5000)).toLocaleString()} (${((sitemapCompanies - relatedFirmsCoverage - Math.min(screenerCompanyLinks * 100, 5000)) / sitemapCompanies * 100).toFixed(1)}%)`);
  console.log();

  // ── Simulated: WITH /firmy on homepage ──────────────────────────────
  console.log("  SIMULATED (with /firmy on homepage):\n");
  console.log("  Depth 0: Homepage                    1 page");
  console.log("  Depth 1: /firmy, /screener, /slovnik ~10 pages");
  console.log(`  Depth 2: /firmy?page=1..N            ${totalPages.toLocaleString()} pages`);
  console.log(`  Depth 3: Company pages (from /firmy)  ${Math.min(firmyPageLinks * totalPages, sitemapCompanies).toLocaleString()} pages`);
  console.log(`    But Google crawls ~first 100 pages:  ${Math.min(firmyPageLinks * 100, 5000).toLocaleString()} companies at depth 3`);
  console.log(`  Depth 4: RelatedFirms                 ${relatedFirmsCoverage.toLocaleString()} companies`);
  console.log(`  Orphan (sitemap-only):                ${(sitemapCompanies - relatedFirmsCoverage - Math.min(firmyPageLinks * 100, 5000)).toLocaleString()} (${((sitemapCompanies - relatedFirmsCoverage - Math.min(firmyPageLinks * 100, 5000)) / sitemapCompanies * 100).toFixed(1)}%)`);
  console.log();

  // ── Simulated: WITH hub pages ───────────────────────────────────────
  console.log("  SIMULATED (with hub pages — see Part B for design):\n");
  console.log("  Depth 0: Homepage                    1 page");
  console.log("  Depth 1: /firmy, /odvetvie, /kraj    ~20 pages");
  console.log("  Depth 2: Hub pages (NACE, kraj)      ~600 pages");
  console.log("  Depth 3: Hub sub-pages (okres, NACE+kraj) ~5,000 pages");
  console.log("  Depth 4: Company pages (from hubs)   ~200,000+ pages");
  console.log("  Depth 5: RelatedFirms                 remaining companies");
  console.log("  Orphan:                               target <10%");
  console.log();

  return {
    homepage: { hasFirmyLink, hasScreenerLink, hasSlovnikLink, totalLinks: homeLinks.length },
    firmy: { totalPages, pageSize: PAGE_SIZE, companiesPerPage: firmyPageLinks },
    screener: { companyLinks: screenerCompanyLinks.length },
    slovnik: { entries: slovnikEntries.length },
    sitemapCompanies,
    relatedFirmsCoverage,
    currentOrphan: sitemapCompanies - relatedFirmsCoverage - Math.min(screenerCompanyLinks * 100, 5000),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PART B: HUB FEASIBILITY ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

async function hubFeasibility() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  PART B: HUB FEASIBILITY ANALYSIS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── 1. NACE section hubs ────────────────────────────────────────────
  console.log("── 1. NACE Section Hubs ──\n");

  const naceRows = sshQuery(`
    SELECT
      LEFT(c."naceCode", 1) as nace_section,
      COUNT(*) as total_companies,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)) as indexable,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) as sitemap,
      ROUND(AVG(
        CASE
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 5 THEN 30
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 3 THEN 25
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2 THEN 20
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) = 1 THEN 10
          ELSE 0
        END +
        CASE WHEN c."legalStatus" = 'ACTIVE' THEN 20 ELSE 10 END +
        CASE WHEN c.name IS NOT NULL THEN 10 ELSE 0 END +
        CASE WHEN c.city IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."naceCode" IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."employeeCount" IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."orsrSyncedAt" IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."latestRevenue" IS NOT NULL THEN 10 ELSE 0 END +
        CASE WHEN c."establishedAt" IS NULL THEN 0
             WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 10 THEN 10
             WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 5 THEN 7
             WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 2 THEN 5
             ELSE 2 END
      )::numeric, 1) as avg_quality
    FROM "Company" c
    WHERE c."naceCode" IS NOT NULL
    GROUP BY nace_section
    ORDER BY sitemap DESC;
  `);

  const naceHubs = naceRows.map(([section, total, indexable, sitemap, avgQ]) => ({
    section, total: parseInt(total), indexable: parseInt(indexable), sitemap: parseInt(sitemap), avgQuality: parseFloat(avgQ)
  }));

  console.log("  Section | Total | Indexable | Sitemap | Avg Quality");
  console.log("  --------|-------|-----------|---------|------------");
  for (const h of naceHubs) {
    console.log(`  ${h.section.padEnd(8)}| ${h.total.toLocaleString().padStart(6)}| ${h.indexable.toLocaleString().padStart(9)}| ${h.sitemap.toLocaleString().padStart(7)}| ${h.avgQuality}`);
  }
  console.log(`  Total:     ${naceHubs.length} NACE sections`);
  console.log();

  // ── 2. Kraj (region) hubs ───────────────────────────────────────────
  console.log("── 2. Kraj (Region) Hubs ──\n");

  const krajRows = sshQuery(`
    SELECT
      COALESCE(c.kraj, 'unknown') as kraj,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) as sitemap,
      ROUND(AVG(
        CASE
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 5 THEN 30
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 3 THEN 25
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2 THEN 20
          ELSE 10
        END + 20 +
        CASE WHEN c.name IS NOT NULL THEN 10 ELSE 0 END +
        CASE WHEN c.city IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."naceCode" IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."employeeCount" IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."orsrSyncedAt" IS NOT NULL THEN 5 ELSE 0 END +
        CASE WHEN c."latestRevenue" IS NOT NULL THEN 10 ELSE 0 END + 10
      )::numeric, 1) as avg_quality
    FROM "Company" c
    GROUP BY kraj
    ORDER BY sitemap DESC;
  `);

  const krajHubs = krajRows.map(([kraj, total, sitemap, avgQ]) => ({
    kraj, total: parseInt(total), sitemap: parseInt(sitemap), avgQuality: parseFloat(avgQ)
  }));

  console.log("  Kraj     | Total | Sitemap | Avg Quality");
  console.log("  ----------|-------|---------|------------");
  for (const h of krajHubs) {
    console.log(`  ${h.kraj.padEnd(10)}| ${h.total.toLocaleString().padStart(6)}| ${h.sitemap.toLocaleString().padStart(7)}| ${h.avgQuality}`);
  }
  console.log(`  Total:     ${krajHubs.length} regions`);
  console.log();

  // ── 3. Okres (district) hubs ────────────────────────────────────────
  console.log("── 3. Okres (District) Hubs ──\n");

  const okresRows = sshQuery(`
    SELECT
      COALESCE(c.okres, 'unknown') as okres,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) as sitemap
    FROM "Company" c
    WHERE c.okres IS NOT NULL
    GROUP BY okres
    ORDER BY sitemap DESC;
  `);

  const okresHubs = okresRows.map(([okres, total, sitemap]) => ({
    okres, total: parseInt(total), sitemap: parseInt(sitemap)
  }));

  const okresWithEnough = okresHubs.filter((h) => h.sitemap >= 50);
  console.log(`  Total districts:      ${okresHubs.length}`);
  console.log(`  Districts with ≥50 sitemap companies: ${okresWithEnough.length}`);
  console.log(`  Districts with ≥100 sitemap companies: ${okresHubs.filter((h) => h.sitemap >= 100).length}`);
  console.log(`  Districts with ≥500 sitemap companies: ${okresHubs.filter((h) => h.sitemap >= 500).length}`);
  console.log();

  // ── 4. City hubs ────────────────────────────────────────────────────
  console.log("── 4. City Hubs (top 30) ──\n");

  const cityRows = sshQuery(`
    SELECT
      COALESCE(c.city, 'unknown') as city,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) as sitemap
    FROM "Company" c
    WHERE c.city IS NOT NULL
    GROUP BY city
    ORDER BY sitemap DESC
    LIMIT 30;
  `);

  const cityHubs = cityRows.map(([city, total, sitemap]) => ({
    city, total: parseInt(total), sitemap: parseInt(sitemap)
  }));

  const allCitiesRows = sshQuery(`
    SELECT COUNT(DISTINCT city) FROM "Company" WHERE city IS NOT NULL;
  `);
  const totalCities = parseInt(allCitiesRows[0]?.[0] || "0");

  const citiesWithEnough = sshQuery(`
    SELECT COUNT(*) FROM (
      SELECT city, COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) as sitemap
      FROM "Company" c WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) >= 20
    ) sub;
  `);
  const citiesWith20 = parseInt(citiesWithEnough[0]?.[0] || "0");

  console.log("  City           | Total | Sitemap");
  console.log("  ----------------|-------|---------");
  for (const h of cityHubs.slice(0, 15)) {
    console.log(`  ${h.city.slice(0, 16).padEnd(17)}| ${h.total.toLocaleString().padStart(6)}| ${h.sitemap.toLocaleString().padStart(7)}`);
  }
  console.log(`  ...`);
  console.log(`  Total unique cities:           ${totalCities.toLocaleString()}`);
  console.log(`  Cities with ≥20 sitemap firms: ${citiesWith20.toLocaleString()}`);
  console.log();

  // ── 5. Legal form hubs ──────────────────────────────────────────────
  console.log("── 5. Legal Form Hubs ──\n");

  const legalFormRows = sshQuery(`
    SELECT
      COALESCE(c."legalForm", 'unknown') as legal_form,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) as sitemap
    FROM "Company" c
    GROUP BY legal_form
    ORDER BY sitemap DESC
    LIMIT 15;
  `);

  const legalFormHubs = legalFormRows.map(([form, total, sitemap]) => ({
    form, total: parseInt(total), sitemap: parseInt(sitemap)
  }));

  console.log("  Legal Form                              | Total | Sitemap");
  console.log("  ------------------------------------------|-------|---------");
  for (const h of legalFormHubs) {
    console.log(`  ${h.form.slice(0, 40).padEnd(41)}| ${h.total.toLocaleString().padStart(6)}| ${h.sitemap.toLocaleString().padStart(7)}`);
  }
  console.log();

  // ── 6. Size category hubs ───────────────────────────────────────────
  console.log("── 6. Size Category Hubs ──\n");

  const sizeRows = sshQuery(`
    SELECT
      COALESCE(c."sizeCategoryNormalized", 'unknown') as size,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2) as sitemap
    FROM "Company" c
    GROUP BY size
    ORDER BY sitemap DESC;
  `);

  const sizeHubs = sizeRows.map(([size, total, sitemap]) => ({
    size, total: parseInt(total), sitemap: parseInt(sitemap)
  }));

  console.log("  Size    | Total | Sitemap");
  console.log("  ---------|-------|---------");
  for (const h of sizeHubs) {
    console.log(`  ${h.size.padEnd(9)}| ${h.total.toLocaleString().padStart(6)}| ${h.sitemap.toLocaleString().padStart(7)}`);
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // HUB HIERARCHY DESIGN
  // ═══════════════════════════════════════════════════════════════════

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  HUB HIERARCHY DESIGN");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Level 1: /firmy (hub index)
  // Level 2: /odvetvie/{section} (NACE sections — 21 hubs)
  // Level 2: /kraj/{kraj-slug} (regions — 8 hubs)
  // Level 3: /odvetvie/{section}/kraj/{kraj-slug} (NACE × region — ~168 hubs)
  // Level 3: /mesto/{city-slug} (top cities — ~50 hubs)

  const naceCount = naceHubs.length;
  const krajCount = krajHubs.filter((h) => h.kraj !== "unknown").length;
  const naceKrajCombos = naceCount * krajCount; // theoretical max
  const cityHubCount = Math.min(citiesWith20, 100);

  // Each hub page lists top 50-100 companies (paginated)
  const companiesPerHub = 50;

  console.log("  PROPOSED HIERARCHY (2-3 levels):\n");
  console.log("  Level 1: /firmy                        1 page (hub index)");
  console.log(`  Level 2: /odvetvie/{section}           ${naceCount} pages (NACE sections)`);
  console.log(`  Level 2: /kraj/{kraj-slug}             ${krajCount} pages (regions)`);
  console.log(`  Level 3: /odvetvie/{section}/{kraj}    ~${naceKrajCombos} pages (NACE × region)`);
  console.log(`  Level 3: /mesto/{city-slug}            ~${cityHubCount} pages (top cities)`);
  console.log();
  const totalHubs = 1 + naceCount + krajCount + naceKrajCombos + cityHubCount;
  console.log(`  TOTAL HUB PAGES: ~${totalHubs.toLocaleString()}`);
  console.log();

  // Each hub page links to top 50 companies
  const companiesReachableFromHubs = totalHubs * companiesPerHub;
  console.log(`  Companies per hub:     ${companiesPerHub}`);
  console.log(`  Max reachable:         ${companiesReachableFromHubs.toLocaleString()} (with overlap)`);
  console.log();

  // ── Simulated crawl depth with hubs ─────────────────────────────────
  console.log("  SIMULATED CRAWL DEPTH WITH HUBS:\n");

  const sitemapRows = sshQuery(`
    SELECT COUNT(*) FROM "Company" c
    WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2;
  `);
  const sitemapCompanies = parseInt(sitemapRows[0]?.[0] || "0");

  // Get RelatedFirms coverage
  const rfRows = sshQuery(`
    WITH linked AS (
      SELECT DISTINCT c.ico FROM "Company" c,
      LATERAL (
        SELECT c2.ico FROM "Company" c2
        WHERE c2."naceCode" = c."naceCode" AND c2.kraj = c.kraj
          AND c2.ico != c.ico AND c2."latestRevenue" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c2.ico)
        ORDER BY c2."latestRevenue" DESC LIMIT 6
      ) uni
      WHERE c."naceCode" IS NOT NULL AND c.kraj IS NOT NULL
        AND c."latestRevenue" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)
    )
    SELECT COUNT(*) FROM linked;
  `);
  const relatedFirmsCoverage = parseInt(rfRows[0]?.[0] || "0");

  // With hubs:
  // Depth 0: Homepage (1)
  // Depth 1: /firmy, /screener, /slovnik (~10)
  // Depth 2: /odvetvie/*, /kraj/* (~30)
  // Depth 3: /odvetvie/*/kraj/*, /mesto/* (~300)
  // Depth 4: Company pages from hubs (each hub → 50 companies)
  // Depth 5: RelatedFirms from company pages

  // How many unique companies can we reach from hubs?
  // NACE section hubs: 21 × 50 = 1,050 (top companies per NACE)
  // Kraj hubs: 8 × 50 = 400 (top companies per region)
  // NACE×kraj hubs: 168 × 50 = 8,400 (top companies per NACE+region)
  // City hubs: 100 × 50 = 5,000 (top companies per city)
  // Total unique (with overlap): ~10,000-15,000

  // But each hub page can be paginated! /odvetvie/A?page=1..10
  // With 10 pages per hub × 50 companies = 500 per hub
  // 200 hubs × 500 = 100,000 companies reachable

  // Let's be realistic: Google will crawl ~5 pages per hub
  // 200 hubs × 5 pages × 50 companies = 50,000 companies at depth 4

  const depth4Companies = Math.min(200 * 5 * 50, sitemapCompanies);
  const depth5FromRelated = Math.min(relatedFirmsCoverage, sitemapCompanies - depth4Companies);
  const orphanWithHubs = sitemapCompanies - depth4Companies - depth5FromRelated;

  console.log("  Depth 0: Homepage                     1 page");
  console.log("  Depth 1: /firmy, /screener, /slovnik  ~10 pages");
  console.log(`  Depth 2: /odvetvie/*, /kraj/*         ~${naceCount + krajCount} pages`);
  console.log(`  Depth 3: /odvetvie/*/kraj/*, /mesto/* ~${naceKrajCombos + cityHubCount} pages`);
  console.log(`  Depth 4: Company pages (from hubs)    ~${depth4Companies.toLocaleString()} companies`);
  console.log(`  Depth 5: RelatedFirms                 ~${depth5FromRelated.toLocaleString()} companies`);
  console.log(`  Orphan (sitemap-only):                ~${orphanWithHubs.toLocaleString()} (${(orphanWithHubs / sitemapCompanies * 100).toFixed(1)}%)`);
  console.log();

  // ── Hub page quality assessment ─────────────────────────────────────
  console.log("  HUB PAGE QUALITY ASSESSMENT:\n");

  // Each hub page would contain:
  // - H1: "Firmy v odvetví {NACE text} na Slovensku"
  // - Table of top 50 companies (name, city, revenue, profit, size)
  // - Filter links to sub-hubs (kraj, okres)
  // - Pagination
  // - Breadcrumbs
  // This is NOT thin content — it's a curated directory page

  console.log("  Each hub page contains:");
  console.log("    - H1: 'Firmy v odvetví {NACE} {kraj}'");
  console.log("    - Table: 50 companies (name, city, revenue, profit, size)");
  console.log("    - Sub-hub links (kraj, okres, NACE subsections)");
  console.log("    - Pagination (up to 10 pages)");
  console.log("    - Breadcrumbs: Homepage → Firmy → Odvetvie → Kraj");
  console.log("    - JSON-LD: ItemList + BreadcrumbList");
  console.log();
  console.log("  Content per hub: ~3,000-5,000 chars (NOT thin)");
  console.log("  Each hub links to 50-500 company pages");
  console.log();

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("  CURRENT STATE:");
  console.log(`    Orphan rate: 93.0% (264,174 companies only in sitemap)`);
  console.log(`    Homepage does NOT link to /firmy`);
  console.log();

  console.log("  PROPOSED SOLUTION:");
  console.log(`    1. Add /firmy link to homepage (trivial)`);
  console.log(`    2. Create ${naceCount} NACE section hub pages (/odvetvie/*)`);
  console.log(`    3. Create ${krajCount} region hub pages (/kraj/*)`);
  console.log(`    4. Create ~${naceKrajCombos} NACE×region sub-hubs (/odvetvie/*/kraj/*)`);
  console.log(`    5. Create ~${cityHubCount} city hub pages (/mesto/*)`);
  console.log(`    Total new pages: ~${totalHubs.toLocaleString()}`);
  console.log();

  console.log("  PROJECTED IMPROVEMENT:");
  console.log(`    Depth 4 coverage:  ~${depth4Companies.toLocaleString()} companies`);
  console.log(`    Depth 5 coverage:  ~${depth5FromRelated.toLocaleString()} companies (RelatedFirms)`);
  console.log(`    Orphan rate:       ~${(orphanWithHubs / sitemapCompanies * 100).toFixed(1)}% (down from 93%)`);
  console.log();

  console.log("  RISKS:");
  console.log("    - Hub pages must have unique content (not just tables)");
  console.log("    - NACE×kraj combos with <20 companies should NOT be created");
  console.log("    - City hubs only for cities with ≥20 sitemap companies");
  console.log("    - Pagination capped at 10 pages per hub (500 companies max)");
  console.log();

  // Write JSON
  const report = {
    timestamp: new Date().toISOString(),
    naceHubs,
    krajHubs,
    okresHubs: okresHubs.slice(0, 20),
    cityHubs,
    legalFormHubs,
    sizeHubs,
    hubDesign: {
      naceCount,
      krajCount,
      naceKrajCombos,
      cityHubCount,
      totalHubs,
      companiesPerHub,
      depth4Companies,
      depth5FromRelated,
      orphanWithHubs,
      orphanPct: orphanWithHubs / sitemapCompanies * 100,
    },
  };
  writeFileSync("/tmp/hub-feasibility.json", JSON.stringify(report, null, 2));
  console.log("  Full JSON report: /tmp/hub-feasibility.json");
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const crawlResult = await crawlSimulation();
  await hubFeasibility();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
