#!/usr/bin/env node
/**
 * Crawl Depth & Internal Linking Audit
 *
 * Analyzes how deep company pages are from the homepage,
 * based on the internal link architecture:
 *
 *  Depth 0: Homepage (/)
 *  Depth 1: /firmy, /screener, /slovnik, static pages
 *  Depth 2: /firmy?page=1..N (paginated list pages)
 *  Depth 3: Company pages linked from /firmy pages
 *  Depth 4: Company pages linked from RelatedFirms on other company pages
 *
 * Key questions:
 *  1. How many /firmy pages are there? (total / page_size)
 *  2. How many company URLs are reachable from /firmy pagination?
 *  3. How many are ONLY reachable via sitemap (orphan pages)?
 *  4. What's the max crawl depth for an average company?
 *  5. How many internal links point to each company (RelatedFirms)?
 *
 * Also checks:
 *  - Homepage links to /firmy
 *  - /firmy pagination depth (how many pages to click through)
 *  - RelatedFirms coverage (what % of companies get links)
 */

import { writeFileSync } from "fs";
import { execSync } from "child_process";

const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";
const BASE = "https://verifa.sk";
const FIRMY_PAGE_SIZE = 50; // companies per /firmy page

function sshQuery(sql) {
  const tmpFile = `/tmp/crawl_query_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/crawl_query.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/crawl_query.sql'`,
      { timeout: 120000, encoding: "utf-8" }
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
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  };
}

function extractLinks(html, pattern = /href="([^"]+)"/g) {
  return [...html.matchAll(pattern)].map((m) => m[1]);
}

async function main() {
  console.log("=== Crawl Depth & Internal Linking Audit ===\n");

  // ── 1. Homepage link analysis ───────────────────────────────────────
  console.log("── 1. Homepage Link Analysis ──");
  const homepage = await fetchRaw(`${BASE}/`);
  const homepageLinks = extractLinks(homepage.body);
  const internalLinks = homepageLinks.filter((l) => l.startsWith("/") || l.includes("verifa.sk"));
  const firmaLinks = homepageLinks.filter((l) => l.includes("/firmy"));
  const screenerLinks = homepageLinks.filter((l) => l.includes("/screener"));
  const slovnikLinks = homepageLinks.filter((l) => l.includes("/slovnik"));

  console.log(`  Total links on homepage:     ${homepageLinks.length}`);
  console.log(`  Internal links:              ${internalLinks.length}`);
  console.log(`  Links to /firmy:             ${firmaLinks.length} ${firmaLinks.length > 0 ? "✅" : "❌"}`);
  console.log(`  Links to /screener:          ${screenerLinks.length} ${screenerLinks.length > 0 ? "✅" : "❌"}`);
  console.log(`  Links to /slovnik:           ${slovnikLinks.length}`);
  console.log();

  // ── 2. /firmy pagination depth ──────────────────────────────────────
  console.log("── 2. /firmy Pagination Depth ──");

  // Total companies in /firmy (all companies, since /firmy shows all)
  const totalRows = sshQuery(`SELECT COUNT(*) FROM "Company";`);
  const totalCompanies = parseInt(totalRows[0]?.[0] || "0");

  // Companies with FS (these appear in /firmy with revenue data)
  const withFsRows = sshQuery(`
    SELECT COUNT(*) FROM "Company" c
    WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico);
  `);
  const withFs = parseInt(withFsRows[0]?.[0] || "0");

  const firmyPages = Math.ceil(totalCompanies / FIRMY_PAGE_SIZE);
  const firmyPagesWithFs = Math.ceil(withFs / FIRMY_PAGE_SIZE);

  console.log(`  Total companies:           ${totalCompanies.toLocaleString()}`);
  console.log(`  Companies with FS:         ${withFs.toLocaleString()}`);
  console.log(`  Page size:                 ${FIRMY_PAGE_SIZE}`);
  console.log(`  Total /firmy pages:        ${firmyPages.toLocaleString()}`);
  console.log(`  Max pagination depth:      ${firmyPages.toLocaleString()} clicks from /firmy`);
  console.log();

  // ── 3. Crawl depth distribution ─────────────────────────────────────
  console.log("── 3. Crawl Depth Distribution ──");
  console.log("  (Theoretical — based on link architecture)\n");

  // Depth 0: Homepage
  // Depth 1: /firmy (linked from homepage)
  // Depth 2: /firmy?page=N (paginated)
  // Depth 3: Company pages (linked from /firmy list)
  // Depth 4: Company pages (linked from RelatedFirms on other company pages)

  // But /firmy only shows companies sorted by revenue DESC.
  // Companies with no revenue (no FS) won't appear at the top.
  // Let's check: does /firmy show ALL companies or only those with FS?

  // Check /firmy page 1 — count company links
  const firmy1 = await fetchRaw(`${BASE}/firmy`);
  const firmy1CompanyLinks = extractLinks(firmy1.body).filter((l) => l.includes("/firma/"));
  console.log(`  /firmy page 1: ${firmy1CompanyLinks.length} company links`);

  // Check last page
  const lastPage = Math.min(firmyPages, 10000); // cap at 10k for testing
  const firmyLast = await fetchRaw(`${BASE}/firmy?page=${lastPage}`);
  const firmyLastCompanyLinks = extractLinks(firmyLast.body).filter((l) => l.includes("/firma/"));
  console.log(`  /firmy page ${lastPage}: ${firmyLastCompanyLinks.length} company links`);
  console.log();

  // ── 4. Orphan page analysis ─────────────────────────────────────────
  console.log("── 4. Orphan Page Analysis ──");
  console.log("  Companies reachable from /firmy pagination:\n");

  // /firmy shows ALL companies sorted by revenue DESC
  // Companies with NULL revenue are at the end
  // Total pages = ceil(total / 50)
  // All companies ARE reachable from /firmy pagination (in theory)
  // But Google won't crawl 10,000+ paginated pages

  // The real question: how many companies have RelatedFirms links pointing to them?
  // RelatedFirms links to companies with: same NACE + same kraj + has FS + has revenue
  // Only top 6 by revenue in each NACE+kraj group get links

  const relatedFirmsCoverageRows = sshQuery(`
    WITH linked_companies AS (
      SELECT DISTINCT c.ico
      FROM "Company" c
      WHERE c."naceCode" IS NOT NULL
        AND c."latestRevenue" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)
        AND (
          -- Top 6 by revenue in same NACE + kraj
          c.ico IN (
            SELECT ico FROM (
              SELECT c2.ico, c2."naceCode", c2.kraj,
                     ROW_NUMBER() OVER (PARTITION BY c2."naceCode", c2.kraj ORDER BY c2."latestRevenue" DESC) as rn
              FROM "Company" c2
              WHERE c2."naceCode" IS NOT NULL
                AND c2."latestRevenue" IS NOT NULL
                AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c2.ico)
            ) ranked
            WHERE rn <= 6
          )
          OR
          -- Top 6 by revenue in same NACE (national)
          c.ico IN (
            SELECT ico FROM (
              SELECT c2.ico, c2."naceCode",
                     ROW_NUMBER() OVER (PARTITION BY c2."naceCode" ORDER BY c2."latestRevenue" DESC) as rn
              FROM "Company" c2
              WHERE c2."naceCode" IS NOT NULL
                AND c2."latestRevenue" IS NOT NULL
                AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c2.ico)
            ) ranked
            WHERE rn <= 6
          )
        )
    )
    SELECT COUNT(*) FROM linked_companies;
  `);
  const relatedFirmsCoverage = parseInt(relatedFirmsCoverageRows[0]?.[0] || "0");

  // Total companies in sitemap
  const sitemapRows = sshQuery(`
    SELECT COUNT(*) FROM "Company" c
    WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2;
  `);
  const sitemapCompanies = parseInt(sitemapRows[0]?.[0] || "0");

  console.log(`  Companies in sitemap:              ${sitemapCompanies.toLocaleString()}`);
  console.log(`  Companies with RelatedFirms links: ${relatedFirmsCoverage.toLocaleString()} (${(relatedFirmsCoverage / sitemapCompanies * 100).toFixed(1)}%)`);
  console.log(`  Orphan pages (no RelatedFirms):    ${(sitemapCompanies - relatedFirmsCoverage).toLocaleString()} (${((sitemapCompanies - relatedFirmsCoverage) / sitemapCompanies * 100).toFixed(1)}%)`);
  console.log();

  // ── 5. Internal link count per company (inbound) ────────────────────
  console.log("── 5. Inbound Link Distribution (RelatedFirms) ──");

  // How many inbound links does each company get from RelatedFirms?
  // A company gets linked from other companies in the same NACE+kraj group
  // and from companies in the same NACE (national)
  // Each company page has up to 12 RelatedFirms links (6 regional + 6 national)
  // So inbound links = number of other companies in same NACE(+kraj) that show this company in their top 6

  const inboundLinkRows = sshQuery(`
    WITH link_counts AS (
      SELECT linked.ico, COUNT(*) as inbound_count
      FROM "Company" linker
      CROSS JOIN LATERAL (
        SELECT c.ico
        FROM "Company" c
        WHERE c."naceCode" = linker."naceCode"
          AND c.kraj = linker.kraj
          AND c.ico != linker.ico
          AND c."latestRevenue" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)
        ORDER BY c."latestRevenue" DESC
        LIMIT 6
      ) linked
      WHERE linker."naceCode" IS NOT NULL
        AND linker.kraj IS NOT NULL
        AND linker."latestRevenue" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = linker.ico)
      GROUP BY linked.ico
    )
    SELECT
      CASE
        WHEN inbound_count = 0 THEN '0 links'
        WHEN inbound_count BETWEEN 1 AND 5 THEN '1-5 links'
        WHEN inbound_count BETWEEN 6 AND 20 THEN '6-20 links'
        WHEN inbound_count BETWEEN 21 AND 100 THEN '21-100 links'
        WHEN inbound_count > 100 THEN '100+ links'
      END as link_bucket,
      COUNT(*) as company_count
    FROM link_counts
    GROUP BY link_bucket
    ORDER BY MIN(inbound_count);
  `);

  // Also count companies with 0 inbound links
  const zeroInboundRows = sshQuery(`
    SELECT COUNT(*) FROM "Company" c
    WHERE c."latestRevenue" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)
      AND c.ico NOT IN (
        SELECT DISTINCT linked.ico
        FROM "Company" linker
        CROSS JOIN LATERAL (
          SELECT c2.ico
          FROM "Company" c2
          WHERE c2."naceCode" = linker."naceCode"
            AND c2.kraj = linker.kraj
            AND c2.ico != linker.ico
            AND c2."latestRevenue" IS NOT NULL
            AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c2.ico)
          ORDER BY c2."latestRevenue" DESC
          LIMIT 6
        ) linked
        WHERE linker."naceCode" IS NOT NULL
          AND linker.kraj IS NOT NULL
          AND linker."latestRevenue" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = linker.ico)
      );
  `);
  const zeroInbound = parseInt(zeroInboundRows[0]?.[0] || "0");

  console.log(`  Companies with 0 inbound links:   ${zeroInbound.toLocaleString()}`);
  const inboundDist = inboundLinkRows.map(([bucket, count]) => ({ bucket, count: parseInt(count) }));
  for (const r of inboundDist) {
    console.log(`  ${r.bucket.padEnd(15)} ${r.count.toLocaleString().padStart(8)}`);
  }
  console.log();

  // ── 6. Crawl depth summary ──────────────────────────────────────────
  console.log("── 6. Theoretical Crawl Depth Summary ──");
  console.log();

  // Depth 0: Homepage (1 page)
  // Depth 1: /firmy, /screener, /slovnik, etc. (~10 pages)
  // Depth 2: /firmy?page=1..N (N = firmyPages)
  // Depth 3: Company pages linked from /firmy (up to 50 per page × N pages)
  // Depth 4: Company pages linked from RelatedFirms (only top companies by NACE+kraj)

  // But Google won't crawl all 10,000+ /firmy pages
  // Realistic crawl depth:
  // - Top 1000 companies (by revenue): Depth 3 (from /firmy pages 1-20)
  // - Top 10,000 companies: Depth 3 (from /firmy pages 1-200)
  // - Remaining companies: Depth 4+ (only via RelatedFirms or sitemap)

  const top1000 = Math.min(1000, sitemapCompanies);
  const top10k = Math.min(10000, sitemapCompanies);
  const restFromSitemap = sitemapCompanies - top10k;

  console.log(`  Depth 0 (homepage):              1 page`);
  console.log(`  Depth 1 (hub pages):             ~10 pages (/firmy, /screener, /slovnik)`);
  console.log(`  Depth 2 (/firmy pagination):     ${firmyPages.toLocaleString()} pages`);
  console.log(`  Depth 3 (from /firmy):           up to ${sitemapCompanies.toLocaleString()} company pages`);
  console.log(`    - But Google crawls ~first 100 /firmy pages`);
  console.log(`    - Realistic Depth 3 coverage:  ${Math.min(100 * FIRMY_PAGE_SIZE, sitemapCompanies).toLocaleString()} companies`);
  console.log(`  Depth 4 (from RelatedFirms):     ${relatedFirmsCoverage.toLocaleString()} companies get inbound links`);
  console.log(`  Sitemap-only (orphan):           ${(sitemapCompanies - relatedFirmsCoverage - Math.min(100 * FIRMY_PAGE_SIZE, sitemapCompanies)).toLocaleString()} companies`);
  console.log();

  // ── 7. NACE diversity in RelatedFirms ───────────────────────────────
  console.log("── 7. NACE Group Coverage ──");
  const naceGroupRows = sshQuery(`
    SELECT
      COUNT(DISTINCT "naceCode") as nace_groups,
      COUNT(DISTINCT CONCAT("naceCode", '|', kraj)) as nace_kraj_groups,
      COUNT(*) as companies_with_revenue
    FROM "Company"
    WHERE "naceCode" IS NOT NULL
      AND "latestRevenue" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = "Company".ico);
  `);
  const naceGroups = naceGroupRows[0] || [];
  console.log(`  NACE groups:              ${parseInt(naceGroups[0] || "0").toLocaleString()}`);
  console.log(`  NACE+kraj groups:         ${parseInt(naceGroups[1] || "0").toLocaleString()}`);
  console.log(`  Companies with revenue:   ${parseInt(naceGroups[2] || "0").toLocaleString()}`);
  console.log(`  Max inbound links/group:  6 (top 6 by revenue)`);
  console.log(`  Total RelatedFirms slots: ${(parseInt(naceGroups[1] || "0") * 6).toLocaleString()} regional + ${(parseInt(naceGroups[0] || "0") * 6).toLocaleString()} national`);
  console.log();

  // ── 8. Summary & recommendations ────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CRAWL DEPTH & INTERNAL LINKING SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`  Homepage → /firmy link:        ${firmaLinks.length > 0 ? "✅ YES" : "❌ NO"}`);
  console.log(`  Homepage → /screener link:     ${screenerLinks.length > 0 ? "✅ YES" : "❌ NO"}`);
  console.log(`  /firmy pagination:             ${firmyPages.toLocaleString()} pages (${FIRMY_PAGE_SIZE}/page)`);
  console.log(`  RelatedFirms coverage:         ${relatedFirmsCoverage.toLocaleString()} / ${sitemapCompanies.toLocaleString()} (${(relatedFirmsCoverage / sitemapCompanies * 100).toFixed(1)}%)`);
  console.log(`  Orphan pages (sitemap-only):   ${(sitemapCompanies - relatedFirmsCoverage).toLocaleString()} (${((sitemapCompanies - relatedFirmsCoverage) / sitemapCompanies * 100).toFixed(1)}%)`);
  console.log();

  console.log("  KEY FINDINGS:");
  if (firmaLinks.length === 0) {
    console.log("  ❌ Homepage does NOT link to /firmy — companies are unreachable without sitemap");
  } else {
    console.log("  ✅ Homepage links to /firmy");
  }
  if (firmyPages > 1000) {
    console.log(`  ⚠️  /firmy has ${firmyPages.toLocaleString()} paginated pages — Google won't crawl all`);
    console.log(`     Only first ~100 pages (${(100 * FIRMY_PAGE_SIZE).toLocaleString()} companies) are realistically crawlable`);
  }
  if (relatedFirmsCoverage / sitemapCompanies < 0.1) {
    console.log(`  ⚠️  Only ${relatedFirmsCoverage.toLocaleString()} companies get RelatedFirms inbound links`);
    console.log(`     ${((sitemapCompanies - relatedFirmsCoverage) / sitemapCompanies * 100).toFixed(1)}% of sitemap URLs are orphans (only reachable via sitemap)`);
  }
  console.log();

  console.log("  RECOMMENDATIONS:");
  console.log("  1. Add NACE section hub pages (/odvetvie/A, /odvetvie/B, etc.) with top companies per section");
  console.log("  2. Add region hub pages (/kraj/SK010, etc.) with top companies per region");
  console.log("  3. Add city hub pages (/mesto/Bratislava, etc.) with companies per city");
  console.log("  4. Increase RelatedFirms from 6 to 10-20 per group");
  console.log("  5. Add 'recent companies' or 'trending' section on homepage");
  console.log("  6. Consider XML sitemap as primary discovery mechanism (already done)");

  // Write JSON
  const report = {
    timestamp: new Date().toISOString(),
    homepage: {
      totalLinks: homepageLinks.length,
      internalLinks: internalLinks.length,
      hasFirmyLink: firmaLinks.length > 0,
      hasScreenerLink: screenerLinks.length > 0,
      hasSlovnikLink: slovnikLinks.length > 0,
    },
    firmy: {
      totalCompanies,
      companiesWithFs: withFs,
      pageSize: FIRMY_PAGE_SIZE,
      totalPages: firmyPages,
    },
    relatedFirms: {
      coverage: relatedFirmsCoverage,
      sitemapTotal: sitemapCompanies,
      orphanPages: sitemapCompanies - relatedFirmsCoverage,
      orphanPct: (sitemapCompanies - relatedFirmsCoverage) / sitemapCompanies * 100,
    },
    inboundLinks: {
      zeroInbound,
      distribution: inboundDist,
    },
    naceGroups: {
      naceCount: parseInt(naceGroups[0] || "0"),
      naceKrajCount: parseInt(naceGroups[1] || "0"),
      companiesWithRevenue: parseInt(naceGroups[2] || "0"),
    },
  };
  writeFileSync("/tmp/crawl-depth-audit.json", JSON.stringify(report, null, 2));
  console.log("\n  Full JSON report: /tmp/crawl-depth-audit.json");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
