#!/usr/bin/env node
/**
 * Hub Coverage Simulation
 *
 * Queries DB to calculate exactly how many unique sitemap companies
 * would be reachable with different hub configurations:
 *
 * Config A: NACE(10) + Kraj(8) = 18 hubs
 * Config B: NACE(10) + Kraj(8) + NACE×Kraj(80) = 98 hubs
 * Config C: NACE(10) + Kraj(8) + NACE×Kraj(80) + Okres(79) = 177 hubs
 * Config D: NACE(10) + Kraj(8) + NACE×Kraj(80) + Okres(79) + City(top 200) = 377 hubs
 * Config E: All above + NACE 2-digit (~100) = 477 hubs
 *
 * For each config, calculates:
 *  - Unique companies reachable (top N per hub, paginated)
 *  - Orphan rate
 *  - Total hub pages (with pagination)
 */

import { writeFileSync } from "fs";
import { execSync } from "child_process";

const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";

function sshQuery(sql) {
  const tmpFile = `/tmp/coverage_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/coverage.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/coverage.sql'`,
      { timeout: 300000, encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.split("|"));
  } catch (e) {
    console.error(`  Query failed: ${e.message.split("\n")[0]}`);
    return [];
  }
}

async function main() {
  console.log("=== Hub Coverage Simulation ===\n");
  console.log("Calculating unique companies reachable with different hub configs...\n");

  // Total sitemap companies
  const totalRows = sshQuery(`
    SELECT COUNT(*) FROM "Company" c
    WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2;
  `);
  const sitemapTotal = parseInt(totalRows[0]?.[0] || "0");
  console.log(`Sitemap companies: ${sitemapTotal.toLocaleString()}\n`);

  // For each config, we calculate unique companies reachable
  // Each hub page shows top 50 companies (by revenue DESC)
  // With pagination: 10 pages per hub = 500 companies max per hub
  // Google realistically crawls ~5 pages per hub = 250 companies per hub

  const COMPANIES_PER_HUB_GOOGLE = 250; // realistic Google crawl per hub

  // ── Config A: NACE(10) + Kraj(8) ────────────────────────────────────
  console.log("── Config A: NACE sections + Kraj regions ──");

  const configARows = sshQuery(`
    WITH sitemap_firms AS (
      SELECT c.ico, c."naceCode", c.kraj, c."latestRevenue"
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    nace_top AS (
      SELECT DISTINCT ON (ico) ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
    ),
    kraj_top AS (
      SELECT DISTINCT ON (ico) ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
    )
    SELECT
      (SELECT COUNT(*) FROM nace_top) as nace_reachable,
      (SELECT COUNT(*) FROM kraj_top) as kraj_reachable,
      (SELECT COUNT(DISTINCT ico) FROM (SELECT ico FROM nace_top UNION SELECT ico FROM kraj_top) u) as total_unique;
  `);

  const configA = configARows[0] || ["0", "0", "0"];
  const aUnique = parseInt(configA[2]);
  const aOrphan = sitemapTotal - aUnique;
  console.log(`  NACE hubs (10):   ${parseInt(configA[0]).toLocaleString()} companies reachable`);
  console.log(`  Kraj hubs (8):    ${parseInt(configA[1]).toLocaleString()} companies reachable`);
  console.log(`  Unique total:     ${aUnique.toLocaleString()}`);
  console.log(`  Orphan:           ${aOrphan.toLocaleString()} (${(aOrphan / sitemapTotal * 100).toFixed(1)}%)`);
  console.log();

  // ── Config B: + NACE×Kraj (80 combos) ───────────────────────────────
  console.log("── Config B: + NACE×Kraj sub-hubs ──");

  const configBRows = sshQuery(`
    WITH sitemap_firms AS (
      SELECT c.ico, c."naceCode", c.kraj, c."latestRevenue"
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    all_reachable AS (
      -- NACE section top
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      -- Kraj top
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      -- NACE×Kraj top
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
    )
    SELECT COUNT(DISTINCT ico) FROM all_reachable;
  `);

  const bUnique = parseInt(configBRows[0]?.[0] || "0");
  const bOrphan = sitemapTotal - bUnique;
  console.log(`  NACE×Kraj hubs (~80): adds more companies`);
  console.log(`  Unique total:     ${bUnique.toLocaleString()}`);
  console.log(`  Orphan:           ${bOrphan.toLocaleString()} (${(bOrphan / sitemapTotal * 100).toFixed(1)}%)`);
  console.log();

  // ── Config C: + Okres (79) ──────────────────────────────────────────
  console.log("── Config C: + Okres hubs ──");

  const configCRows = sshQuery(`
    WITH sitemap_firms AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c."latestRevenue"
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    all_reachable AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
    )
    SELECT COUNT(DISTINCT ico) FROM all_reachable;
  `);

  const cUnique = parseInt(configCRows[0]?.[0] || "0");
  const cOrphan = sitemapTotal - cUnique;
  console.log(`  Okres hubs (79): adds more companies`);
  console.log(`  Unique total:     ${cUnique.toLocaleString()}`);
  console.log(`  Orphan:           ${cOrphan.toLocaleString()} (${(cOrphan / sitemapTotal * 100).toFixed(1)}%)`);
  console.log();

  // ── Config D: + City (top 200) ──────────────────────────────────────
  console.log("── Config D: + City hubs (top 200 cities) ──");

  const configDRows = sshQuery(`
    WITH sitemap_firms AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue"
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 200
    ),
    all_reachable AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
    )
    SELECT COUNT(DISTINCT ico) FROM all_reachable;
  `);

  const dUnique = parseInt(configDRows[0]?.[0] || "0");
  const dOrphan = sitemapTotal - dUnique;
  console.log(`  City hubs (200): adds more companies`);
  console.log(`  Unique total:     ${dUnique.toLocaleString()}`);
  console.log(`  Orphan:           ${dOrphan.toLocaleString()} (${(dOrphan / sitemapTotal * 100).toFixed(1)}%)`);
  console.log();

  // ── Config E: + NACE 2-digit (~100 subsections) ─────────────────────
  console.log("── Config E: + NACE 2-digit subsections ──");

  const configERows = sshQuery(`
    WITH sitemap_firms AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue"
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 200
    ),
    all_reachable AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND LENGTH("naceCode") >= 2
      ) sub WHERE rn <= ${COMPANIES_PER_HUB_GOOGLE}
    )
    SELECT COUNT(DISTINCT ico) FROM all_reachable;
  `);

  const eUnique = parseInt(configERows[0]?.[0] || "0");
  const eOrphan = sitemapTotal - eUnique;
  console.log(`  NACE 2-digit hubs (~100): adds more companies`);
  console.log(`  Unique total:     ${eUnique.toLocaleString()}`);
  console.log(`  Orphan:           ${eOrphan.toLocaleString()} (${(eOrphan / sitemapTotal * 100).toFixed(1)}%)`);
  console.log();

  // ── Config F: + RelatedFirms from all reachable ─────────────────────
  console.log("── Config F: Config E + RelatedFirms from reachable companies ──");

  // RelatedFirms links from all companies reachable in Config E
  // would add more companies at depth 5
  // Each company page has ~12 RelatedFirms links (6 regional + 6 national)
  // But many of these are already reachable via hubs
  // Estimate: RelatedFirms adds ~10% more unique companies

  const fUniqueEstimate = Math.min(eUnique + Math.round(eUnique * 0.1), sitemapTotal);
  const fOrphan = sitemapTotal - fUniqueEstimate;
  console.log(`  RelatedFirms from ${eUnique.toLocaleString()} reachable companies`);
  console.log(`  Estimated unique: ${fUniqueEstimate.toLocaleString()}`);
  console.log(`  Orphan:           ${fOrphan.toLocaleString()} (${(fOrphan / sitemapTotal * 100).toFixed(1)}%)`);
  console.log();

  // ── Config G: All cities (1129) + more pagination ───────────────────
  console.log("── Config G: All cities with ≥20 firms + 500 companies per hub ──");

  const configGRows = sshQuery(`
    WITH sitemap_firms AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue"
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC
    ),
    all_reachable AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= 500
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= 500
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= 250
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= 250
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= 250
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND LENGTH("naceCode") >= 2
      ) sub WHERE rn <= 250
    )
    SELECT COUNT(DISTINCT ico) FROM all_reachable;
  `);

  const gUnique = parseInt(configGRows[0]?.[0] || "0");
  const gOrphan = sitemapTotal - gUnique;
  console.log(`  All cities (1,129) + higher pagination`);
  console.log(`  Unique total:     ${gUnique.toLocaleString()}`);
  console.log(`  Orphan:           ${gOrphan.toLocaleString()} (${(gOrphan / sitemapTotal * 100).toFixed(1)}%)`);
  console.log();

  // ── Summary table ───────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  HUB COVERAGE SIMULATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("  Config | Hubs  | Reachable | Orphan   | Orphan %");
  console.log("  -------|-------|-----------|----------|---------");
  console.log(`  A      |    18 | ${aUnique.toLocaleString().padStart(9)} | ${aOrphan.toLocaleString().padStart(8)} | ${(aOrphan / sitemapTotal * 100).toFixed(1)}%`);
  console.log(`  B      |    98 | ${bUnique.toLocaleString().padStart(9)} | ${bOrphan.toLocaleString().padStart(8)} | ${(bOrphan / sitemapTotal * 100).toFixed(1)}%`);
  console.log(`  C      |   177 | ${cUnique.toLocaleString().padStart(9)} | ${cOrphan.toLocaleString().padStart(8)} | ${(cOrphan / sitemapTotal * 100).toFixed(1)}%`);
  console.log(`  D      |   377 | ${dUnique.toLocaleString().padStart(9)} | ${dOrphan.toLocaleString().padStart(8)} | ${(dOrphan / sitemapTotal * 100).toFixed(1)}%`);
  console.log(`  E      |   477 | ${eUnique.toLocaleString().padStart(9)} | ${eOrphan.toLocaleString().padStart(8)} | ${(eOrphan / sitemapTotal * 100).toFixed(1)}%`);
  console.log(`  F (+RF)|   477 | ${fUniqueEstimate.toLocaleString().padStart(9)} | ${fOrphan.toLocaleString().padStart(8)} | ${(fOrphan / sitemapTotal * 100).toFixed(1)}%`);
  console.log(`  G      | ~1700| ${gUnique.toLocaleString().padStart(9)} | ${gOrphan.toLocaleString().padStart(8)} | ${(gOrphan / sitemapTotal * 100).toFixed(1)}%`);
  console.log();

  console.log("  Config details:");
  console.log("    A: NACE(10) + Kraj(8)");
  console.log("    B: A + NACE×Kraj(80)");
  console.log("    C: B + Okres(79)");
  console.log("    D: C + City top 200");
  console.log("    E: D + NACE 2-digit(100)");
  console.log("    F: E + RelatedFirms (estimated +10%)");
  console.log("    G: All cities(1129) + higher pagination (500/hub)");
  console.log();

  // ── Recommendation ──────────────────────────────────────────────────
  console.log("  RECOMMENDATION:\n");

  // Find the config that gets orphan rate below 20% with fewest hubs
  const configs = [
    { name: "A", hubs: 18, orphan: aOrphan, orphanPct: aOrphan / sitemapTotal * 100 },
    { name: "B", hubs: 98, orphan: bOrphan, orphanPct: bOrphan / sitemapTotal * 100 },
    { name: "C", hubs: 177, orphan: cOrphan, orphanPct: cOrphan / sitemapTotal * 100 },
    { name: "D", hubs: 377, orphan: dOrphan, orphanPct: dOrphan / sitemapTotal * 100 },
    { name: "E", hubs: 477, orphan: eOrphan, orphanPct: eOrphan / sitemapTotal * 100 },
    { name: "F", hubs: 477, orphan: fOrphan, orphanPct: fOrphan / sitemapTotal * 100 },
    { name: "G", hubs: 1700, orphan: gOrphan, orphanPct: gOrphan / sitemapTotal * 100 },
  ];

  const bestConfig = configs.find((c) => c.orphanPct < 20) || configs[configs.length - 1];
  console.log(`  Best config: ${bestConfig.name} (${bestConfig.hubs} hubs, ${bestConfig.orphanPct.toFixed(1)}% orphan)`);
  console.log();

  if (gOrphan / sitemapTotal * 100 > 20) {
    console.log("  ⚠️  Even with all hub configs, orphan rate stays above 20%.");
    console.log("     This means sitemap will remain the primary discovery mechanism");
    console.log("     for a significant portion of company pages.");
    console.log();
    console.log("  STRATEGY:");
    console.log("     1. Implement Config D or E (377-477 hubs) for best ROI");
    console.log("     2. Sitemap handles the rest (Google does crawl sitemaps)");
    console.log("     3. Monitor GSC for 'Discovered - currently not indexed'");
    console.log("     4. Consider noindex for lowest-quality orphans if needed");
  }

  writeFileSync("/tmp/hub-coverage.json", JSON.stringify({
    sitemapTotal,
    configs: configs.map((c) => ({ ...c, reachable: sitemapTotal - c.orphan })),
  }, null, 2));
  console.log("\n  Full JSON report: /tmp/hub-coverage.json");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
