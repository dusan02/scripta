#!/usr/bin/env node
/**
 * Post-deploy hub coverage audit.
 *
 * Measures how many sitemap companies are now reachable via hub pages
 * (depth ≤4: homepage → hub → company, or homepage → hub → sub-hub → company).
 *
 * Hub pages:
 *   /odvetvie/[section]       — 21 NACE sections (top 500 companies each)
 *   /kraj/[kraj]              — 8 regions (top 500 companies each)
 *   /odvetvie/[section]/[kraj] — ~168 NACE×region sub-hubs (top 500 each)
 *   /okres/[okres]            — 79 districts (top 500 each)
 *   /mesto/[city-slug]        — ~1129 cities (top 500 each)
 *
 * Each hub page links to top 50 companies per page, up to 10 pages = 500 companies.
 * Sub-hub links are also present on large hubs (hierarchical discovery).
 */

import { writeFileSync } from "fs";
import { execSync } from "child_process";

const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";
const BASE = "https://verifa.sk";
const HUB_PAGE_SIZE = 50;
const HUB_MAX_PAGES = 10;
const HUB_MAX_COMPANIES = HUB_PAGE_SIZE * HUB_MAX_PAGES; // 500

function sshQuery(sql) {
  const tmpFile = `/tmp/hub_query_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/hub_query.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/hub_query.sql'`,
      { timeout: 120000, encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.split("|"));
  } catch (e) {
    console.error(`  Query failed: ${e.message.split("\n")[0]}`);
    return [];
  }
}

console.log("=== Post-Deploy Hub Coverage Audit ===\n");

// 1. Total sitemap companies (≥2 FS)
console.log("── 1. Sitemap Companies ──");
const totalRows = sshQuery(`
  SELECT COUNT(*) FROM "Company" c
  WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
`);
const totalSitemap = parseInt(totalRows[0]?.[0] || "0", 10);
console.log(`  Total sitemap companies: ${totalSitemap.toLocaleString("en-US")}`);

// 2. Companies reachable from each hub type (top 500 by revenue)
console.log("\n── 2. Hub Coverage (top 500 by revenue per hub) ──");

// NACE section hubs: 21 sections × 500 = max 10,500 slots
const naceRows = sshQuery(`
  WITH ranked AS (
    SELECT c.ico, c."naceCode", c."latestRevenue",
           ROW_NUMBER() OVER (PARTITION BY LEFT(c."naceCode", 2) ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
    FROM "Company" c
    WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
  )
  SELECT COUNT(DISTINCT ico) FROM ranked WHERE rn <= ${HUB_MAX_COMPANIES}
`);
const naceCovered = parseInt(naceRows[0]?.[0] || "0", 10);
console.log(`  NACE section hubs (21): ${naceCovered.toLocaleString("en-US")} companies covered`);

// Kraj hubs: 8 regions × 500 = max 4,000 slots
const krajRows = sshQuery(`
  WITH ranked AS (
    SELECT c.ico, c.kraj, c."latestRevenue",
           ROW_NUMBER() OVER (PARTITION BY c.kraj ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
    FROM "Company" c
    WHERE c.kraj IS NOT NULL
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
  )
  SELECT COUNT(DISTINCT ico) FROM ranked WHERE rn <= ${HUB_MAX_COMPANIES}
`);
const krajCovered = parseInt(krajRows[0]?.[0] || "0", 10);
console.log(`  Kraj hubs (8): ${krajCovered.toLocaleString("en-US")} companies covered`);

// Okres hubs: 79 districts × 500 = max 39,500 slots
const okresRows = sshQuery(`
  WITH ranked AS (
    SELECT c.ico, c.okres, c."latestRevenue",
           ROW_NUMBER() OVER (PARTITION BY c.okres ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
    FROM "Company" c
    WHERE c.okres IS NOT NULL
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
  )
  SELECT COUNT(DISTINCT ico) FROM ranked WHERE rn <= ${HUB_MAX_COMPANIES}
`);
const okresCovered = parseInt(okresRows[0]?.[0] || "0", 10);
console.log(`  Okres hubs (79): ${okresCovered.toLocaleString("en-US")} companies covered`);

// NACE×kraj sub-hubs: ~168 combos × 500 = max 84,000 slots
const naceKrajRows = sshQuery(`
  WITH ranked AS (
    SELECT c.ico, c."naceCode", c.kraj, c."latestRevenue",
           ROW_NUMBER() OVER (PARTITION BY LEFT(c."naceCode", 2), c.kraj ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
    FROM "Company" c
    WHERE c.kraj IS NOT NULL AND c."naceCode" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
  )
  SELECT COUNT(DISTINCT ico) FROM ranked WHERE rn <= ${HUB_MAX_COMPANIES}
`);
const naceKrajCovered = parseInt(naceKrajRows[0]?.[0] || "0", 10);
console.log(`  NACE×kraj sub-hubs (~168): ${naceKrajCovered.toLocaleString("en-US")} companies covered`);

// City hubs: ~1129 cities × 500 = max 564,500 slots
const cityRows = sshQuery(`
  WITH ranked AS (
    SELECT c.ico, c.city, c."latestRevenue",
           ROW_NUMBER() OVER (PARTITION BY c.city ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
    FROM "Company" c
    WHERE c.city IS NOT NULL AND c.city != ''
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
  )
  SELECT COUNT(DISTINCT ico) FROM ranked WHERE rn <= ${HUB_MAX_COMPANIES}
`);
const cityCovered = parseInt(cityRows[0]?.[0] || "0", 10);
console.log(`  City hubs (~1129): ${cityCovered.toLocaleString("en-US")} companies covered`);

// 3. Total unique companies covered by ALL hubs combined
console.log("\n── 3. Combined Coverage (all hubs) ──");
const combinedRows = sshQuery(`
  WITH all_hub_companies AS (
    -- NACE section hubs
    SELECT ico FROM (
      SELECT c.ico, ROW_NUMBER() OVER (PARTITION BY LEFT(c."naceCode", 2) ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
    ) t WHERE rn <= ${HUB_MAX_COMPANIES}
    UNION
    -- Kraj hubs
    SELECT ico FROM (
      SELECT c.ico, ROW_NUMBER() OVER (PARTITION BY c.kraj ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
      FROM "Company" c
      WHERE c.kraj IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
    ) t WHERE rn <= ${HUB_MAX_COMPANIES}
    UNION
    -- Okres hubs
    SELECT ico FROM (
      SELECT c.ico, ROW_NUMBER() OVER (PARTITION BY c.okres ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
      FROM "Company" c
      WHERE c.okres IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
    ) t WHERE rn <= ${HUB_MAX_COMPANIES}
    UNION
    -- NACE×kraj sub-hubs
    SELECT ico FROM (
      SELECT c.ico, ROW_NUMBER() OVER (PARTITION BY LEFT(c."naceCode", 2), c.kraj ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
      FROM "Company" c
      WHERE c.kraj IS NOT NULL AND c."naceCode" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
    ) t WHERE rn <= ${HUB_MAX_COMPANIES}
    UNION
    -- City hubs
    SELECT ico FROM (
      SELECT c.ico, ROW_NUMBER() OVER (PARTITION BY c.city ORDER BY c."latestRevenue" DESC NULLS LAST) as rn
      FROM "Company" c
      WHERE c.city IS NOT NULL AND c.city != ''
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
    ) t WHERE rn <= ${HUB_MAX_COMPANIES}
  )
  SELECT COUNT(*) FROM all_hub_companies
`);
const combinedCovered = parseInt(combinedRows[0]?.[0] || "0", 10);
const coveragePct = totalSitemap > 0 ? (combinedCovered / totalSitemap * 100).toFixed(1) : "0";
console.log(`  Total unique companies covered: ${combinedCovered.toLocaleString("en-US")}`);
console.log(`  Coverage: ${coveragePct}% of ${totalSitemap.toLocaleString("en-US")} sitemap companies`);

// 4. Orphan rate
const orphanCount = totalSitemap - combinedCovered;
const orphanPct = totalSitemap > 0 ? (orphanCount / totalSitemap * 100).toFixed(1) : "0";
console.log(`\n── 4. Orphan Rate ──`);
console.log(`  Orphan pages (not reachable from any hub): ${orphanCount.toLocaleString("en-US")} (${orphanPct}%)`);
console.log(`  Previous orphan rate: 100.0% (before hub pages)`);
console.log(`  Improvement: ${(100 - parseFloat(orphanPct)).toFixed(1)}pp reduction`);

// 5. PRIME companies coverage (companies with revenue > 1M EUR)
console.log("\n── 5. PRIME Companies (revenue > 1M EUR) ──");
const primeRows = sshQuery(`
  WITH prime AS (
    SELECT c.ico, c."latestRevenue", c."naceCode", c.kraj, c.okres, c.city
    FROM "Company" c
    WHERE c."latestRevenue" >= 1000000
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico GROUP BY fs."companyIco" HAVING COUNT(*) >= 2)
  ),
  prime_in_hubs AS (
    SELECT DISTINCT ico FROM (
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2) ORDER BY "latestRevenue" DESC) rn FROM prime) t WHERE rn <= ${HUB_MAX_COMPANIES}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC) rn FROM prime WHERE kraj IS NOT NULL) t WHERE rn <= ${HUB_MAX_COMPANIES}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY "latestRevenue" DESC) rn FROM prime WHERE okres IS NOT NULL) t WHERE rn <= ${HUB_MAX_COMPANIES}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2), kraj ORDER BY "latestRevenue" DESC) rn FROM prime WHERE kraj IS NOT NULL AND "naceCode" IS NOT NULL) t WHERE rn <= ${HUB_MAX_COMPANIES}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY "latestRevenue" DESC) rn FROM prime WHERE city IS NOT NULL AND city != '') t WHERE rn <= ${HUB_MAX_COMPANIES}
    ) all_hubs
  )
  SELECT (SELECT COUNT(*) FROM prime), (SELECT COUNT(*) FROM prime_in_hubs)
`);
const totalPrime = parseInt(primeRows[0]?.[0] || "0", 10);
const primeCovered = parseInt(primeRows[0]?.[1] || "0", 10);
const primePct = totalPrime > 0 ? (primeCovered / totalPrime * 100).toFixed(1) : "0";
console.log(`  Total PRIME companies: ${totalPrime.toLocaleString("en-US")}`);
console.log(`  PRIME companies in hubs: ${primeCovered.toLocaleString("en-US")} (${primePct}%)`);

// 6. Crawl depth summary
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  HUB COVERAGE SUMMARY");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`  Total sitemap companies:    ${totalSitemap.toLocaleString("en-US")}`);
console.log(`  Companies reachable (≤4):   ${combinedCovered.toLocaleString("en-US")} (${coveragePct}%)`);
console.log(`  Orphan pages:               ${orphanCount.toLocaleString("en-US")} (${orphanPct}%)`);
console.log(`  PRIME companies reachable:  ${primeCovered.toLocaleString("en-US")} / ${totalPrime.toLocaleString("en-US")} (${primePct}%)`);
console.log(`  Hub pages deployed:         ~1300 (21 NACE + 8 kraj + 168 NACE×kraj + 79 okres + ~1129 mesto)`);
console.log(`  Sitemap URLs:               8579 (sitemap/0.xml)`);
console.log("");

// Save JSON report
const report = {
  timestamp: new Date().toISOString(),
  totalSitemapCompanies: totalSitemap,
  hubCoverage: {
    naceSections: naceCovered,
    kraje: krajCovered,
    okresy: okresCovered,
    naceKraj: naceKrajCovered,
    cities: cityCovered,
    combined: combinedCovered,
    coveragePct: parseFloat(coveragePct),
  },
  orphanPages: {
    count: orphanCount,
    pct: parseFloat(orphanPct),
    improvement: 100 - parseFloat(orphanPct),
  },
  primeCompanies: {
    total: totalPrime,
    covered: primeCovered,
    pct: parseFloat(primePct),
  },
};
writeFileSync("/tmp/hub-coverage-audit.json", JSON.stringify(report, null, 2));
console.log("  Full JSON report: /tmp/hub-coverage-audit.json");
