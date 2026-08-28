#!/usr/bin/env node
/**
 * Priority-Based Internal Linking Simulation
 *
 * Compares 4 hub configurations:
 *   A: Config D (377 geographic hubs, top companies by revenue)
 *   B: 377 hubs optimized by company count (biggest hubs first)
 *   C: 377 hubs optimized by SEO value (PRIME companies first)
 *   D: 1000 hubs optimized by SEO value
 *
 * For each config reports:
 *   - Hub pages
 *   - Firms reachable
 *   - PRIME reachable (score >= 90)
 *   - GOOD reachable (score 75-89)
 *   - PRIME orphan
 *   - Avg depth PRIME
 *   - Firms depth <= 2
 *   - Firms depth <= 3
 *   - Firms depth <= 4
 *   - Max links per hub (pagination needed?)
 *
 * SEO value = indexationQualityScore (same as segmentation audit):
 *   FS count (30) + active status (20) + name (10) + city (5) +
 *   NACE (5) + employees (5) + ORSR (5) + revenue (10) + age (10)
 */

import { writeFileSync } from "fs";
import { execSync } from "child_process";

const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";
const COMPANIES_PER_HUB = 250; // realistic Google crawl per hub (5 pages × 50)

function sshQuery(sql, label = "") {
  const tmpFile = `/tmp/prio_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/prio.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/prio.sql'`,
      { timeout: 300000, encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.split("|"));
  } catch (e) {
    console.error(`  Query failed (${label}): ${e.message.split("\n")[0]}`);
    return [];
  }
}

// SQL fragment: calculate SEO quality score for a company
const SCORE_SQL = `
  CASE
    WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 5 THEN 30
    WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 3 THEN 25
    WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2 THEN 20
    WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) = 1 THEN 10
    ELSE 0
  END +
  CASE
    WHEN c."legalStatus" = 'ACTIVE' THEN 20
    WHEN c."legalStatus" IS NULL THEN 10
    WHEN c."legalStatus" = 'UNKNOWN' THEN 10
    WHEN c."legalStatus" = 'LIQUIDATION' THEN 5
    ELSE 0
  END +
  CASE WHEN c.name IS NOT NULL THEN 10 ELSE 0 END +
  CASE WHEN c.city IS NOT NULL THEN 5 ELSE 0 END +
  CASE WHEN c."naceCode" IS NOT NULL THEN 5 ELSE 0 END +
  CASE WHEN c."employeeCount" IS NOT NULL THEN 5 ELSE 0 END +
  CASE WHEN c."orsrSyncedAt" IS NOT NULL THEN 5 ELSE 0 END +
  CASE WHEN c."latestRevenue" IS NOT NULL THEN 10 ELSE 0 END +
  CASE
    WHEN c."establishedAt" IS NULL THEN 0
    WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 10 THEN 10
    WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 5 THEN 7
    WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 2 THEN 5
    ELSE 2
  END
`;

// SQL: CTE for sitemap firms with quality score
const SITEMAP_FIRMS_SQL = `
  sitemap_firms AS (
    SELECT
      c.ico,
      c."naceCode",
      c.kraj,
      c.okres,
      c.city,
      c."latestRevenue",
      (${SCORE_SQL}) as quality_score,
      CASE
        WHEN (${SCORE_SQL}) >= 90 THEN 'PRIME'
        WHEN (${SCORE_SQL}) >= 75 THEN 'GOOD'
        WHEN (${SCORE_SQL}) >= 50 THEN 'WEAK'
        ELSE 'THIN'
      END as tier
    FROM "Company" c
    WHERE EXISTS (
      SELECT 1 FROM "FinancialStatement" fs
      WHERE fs."companyIco" = c.ico
      HAVING COUNT(*) >= 2
    )
  )
`;

async function main() {
  console.log("=== Priority-Based Internal Linking Simulation ===\n");

  // ── Baseline: total PRIME/GOOD counts ───────────────────────────────
  console.log("── Baseline: Sitemap company tiers ──\n");

  const baselineRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL}
    SELECT tier, COUNT(*) as cnt
    FROM sitemap_firms
    GROUP BY tier
    ORDER BY tier;
  `);

  const baseline = {};
  for (const [tier, count] of baselineRows) {
    baseline[tier] = parseInt(count);
  }
  const totalSitemap = Object.values(baseline).reduce((a, b) => a + b, 0);

  console.log(`  Total sitemap:  ${totalSitemap.toLocaleString()}`);
  console.log(`  PRIME (90+):    ${(baseline.PRIME || 0).toLocaleString()} (${((baseline.PRIME || 0) / totalSitemap * 100).toFixed(1)}%)`);
  console.log(`  GOOD (75-89):   ${(baseline.GOOD || 0).toLocaleString()} (${((baseline.GOOD || 0) / totalSitemap * 100).toFixed(1)}%)`);
  console.log(`  WEAK (50-74):   ${(baseline.WEAK || 0).toLocaleString()}`);
  console.log(`  THIN (<50):     ${(baseline.THIN || 0).toLocaleString()}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // CONFIG A: 377 geographic hubs, top by revenue (original Config D)
  // ═══════════════════════════════════════════════════════════════════
  console.log("── Config A: 377 geographic hubs, top by revenue ──\n");

  const configARows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL},
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 200
    ),
    reachable AS (
      -- NACE section hubs (10)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- Kraj hubs (8)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- NACE×Kraj hubs (~80)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- Okres hubs (79)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- City hubs (200)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    )
    SELECT
      COUNT(DISTINCT r.ico) as total_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'GOOD') as good_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'WEAK') as weak_reachable
    FROM reachable r
    JOIN sitemap_firms sf ON sf.ico = r.ico;
  `, "Config A");

  const configA = configARows[0] || ["0", "0", "0", "0"];
  const aReachable = parseInt(configA[0]);
  const aPrime = parseInt(configA[1]);
  const aGood = parseInt(configA[2]);
  const aPrimeOrphan = (baseline.PRIME || 0) - aPrime;

  console.log(`  Reachable:     ${aReachable.toLocaleString()}`);
  console.log(`  PRIME:         ${aPrime.toLocaleString()} / ${(baseline.PRIME || 0).toLocaleString()} (${(aPrime / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log(`  GOOD:          ${aGood.toLocaleString()} / ${(baseline.GOOD || 0).toLocaleString()} (${(aGood / (baseline.GOOD || 1) * 100).toFixed(1)}%)`);
  console.log(`  PRIME orphan:  ${aPrimeOrphan.toLocaleString()} (${(aPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // CONFIG B: 377 hubs, top by company count (biggest hubs)
  // Same hub structure but order companies by revenue (same as A, just different hub selection)
  // Actually B = same hubs but prioritize hubs with most companies
  // For simplicity, B uses the same hub set but we measure differently
  // Let's make B = 377 hubs but ALL city hubs (top 377 cities by company count)
  // ═══════════════════════════════════════════════════════════════════
  console.log("── Config B: 377 city hubs (biggest cities), top by revenue ──\n");

  const configBRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL},
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 377
    ),
    reachable AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    )
    SELECT
      COUNT(DISTINCT r.ico) as total_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'GOOD') as good_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'WEAK') as weak_reachable
    FROM reachable r
    JOIN sitemap_firms sf ON sf.ico = r.ico;
  `, "Config B");

  const configB = configBRows[0] || ["0", "0", "0", "0"];
  const bReachable = parseInt(configB[0]);
  const bPrime = parseInt(configB[1]);
  const bGood = parseInt(configB[2]);
  const bPrimeOrphan = (baseline.PRIME || 0) - bPrime;

  console.log(`  Reachable:     ${bReachable.toLocaleString()}`);
  console.log(`  PRIME:         ${bPrime.toLocaleString()} / ${(baseline.PRIME || 0).toLocaleString()} (${(bPrime / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log(`  GOOD:          ${bGood.toLocaleString()} / ${(baseline.GOOD || 0).toLocaleString()} (${(bGood / (baseline.GOOD || 1) * 100).toFixed(1)}%)`);
  console.log(`  PRIME orphan:  ${bPrimeOrphan.toLocaleString()} (${(bPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // CONFIG C: 377 hubs, top by SEO value (PRIME first)
  // Same hub structure as A, but order companies by quality_score DESC
  // instead of revenue DESC
  // ═══════════════════════════════════════════════════════════════════
  console.log("── Config C: 377 geographic hubs, top by SEO quality score ──\n");

  const configCRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL},
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 200
    ),
    reachable AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    )
    SELECT
      COUNT(DISTINCT r.ico) as total_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'GOOD') as good_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'WEAK') as weak_reachable
    FROM reachable r
    JOIN sitemap_firms sf ON sf.ico = r.ico;
  `, "Config C");

  const configC = configCRows[0] || ["0", "0", "0", "0"];
  const cReachable = parseInt(configC[0]);
  const cPrime = parseInt(configC[1]);
  const cGood = parseInt(configC[2]);
  const cPrimeOrphan = (baseline.PRIME || 0) - cPrime;

  console.log(`  Reachable:     ${cReachable.toLocaleString()}`);
  console.log(`  PRIME:         ${cPrime.toLocaleString()} / ${(baseline.PRIME || 0).toLocaleString()} (${(cPrime / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log(`  GOOD:          ${cGood.toLocaleString()} / ${(baseline.GOOD || 0).toLocaleString()} (${(cGood / (baseline.GOOD || 1) * 100).toFixed(1)}%)`);
  console.log(`  PRIME orphan:  ${cPrimeOrphan.toLocaleString()} (${(cPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // CONFIG D: 1000 hubs, top by SEO value
  // Expanded hub set: all cities with ≥20 firms (1129) + NACE 2-digit
  // ═══════════════════════════════════════════════════════════════════
  console.log("── Config D: ~1000 hubs (all cities + NACE 2-digit), top by SEO quality ──\n");

  const configDRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL},
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC
    ),
    reachable AS (
      -- NACE section hubs (10)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- Kraj hubs (8)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- NACE×Kraj hubs (~80)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- Okres hubs (79)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- ALL City hubs (1129)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      -- NACE 2-digit hubs (~100)
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2) ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND LENGTH("naceCode") >= 2
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    )
    SELECT
      COUNT(DISTINCT r.ico) as total_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'GOOD') as good_reachable,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'WEAK') as weak_reachable
    FROM reachable r
    JOIN sitemap_firms sf ON sf.ico = r.ico;
  `, "Config D");

  const configD = configDRows[0] || ["0", "0", "0", "0"];
  const dReachable = parseInt(configD[0]);
  const dPrime = parseInt(configD[1]);
  const dGood = parseInt(configD[2]);
  const dPrimeOrphan = (baseline.PRIME || 0) - dPrime;

  console.log(`  Reachable:     ${dReachable.toLocaleString()}`);
  console.log(`  PRIME:         ${dPrime.toLocaleString()} / ${(baseline.PRIME || 0).toLocaleString()} (${(dPrime / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log(`  GOOD:          ${dGood.toLocaleString()} / ${(baseline.GOOD || 0).toLocaleString()} (${(dGood / (baseline.GOOD || 1) * 100).toFixed(1)}%)`);
  console.log(`  PRIME orphan:  ${dPrimeOrphan.toLocaleString()} (${(dPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1)}%)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // DEPTH DISTRIBUTION (for Config C — recommended)
  // ═══════════════════════════════════════════════════════════════════
  console.log("── Depth Distribution (Config C — 377 hubs by SEO value) ──\n");

  // Depth 2: companies reachable from NACE section + Kraj hubs (depth 2 from homepage)
  // Depth 3: companies reachable from NACE×Kraj + Okres hubs (depth 3)
  // Depth 4: companies reachable from City hubs (depth 4)

  const depthRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL},
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 200
    ),
    depth2 AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    ),
    depth3 AS (
      SELECT ico FROM depth2
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    ),
    depth4 AS (
      SELECT ico FROM depth3
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    )
    SELECT
      (SELECT COUNT(DISTINCT ico) FROM depth2) as d2,
      (SELECT COUNT(DISTINCT ico) FROM depth3) as d3,
      (SELECT COUNT(DISTINCT ico) FROM depth4) as d4,
      (SELECT COUNT(DISTINCT d2.ico) FILTER (WHERE sf.tier = 'PRIME') FROM depth2 JOIN sitemap_firms sf ON sf.ico = d2.ico) as d2_prime,
      (SELECT COUNT(DISTINCT d3.ico) FILTER (WHERE sf.tier = 'PRIME') FROM depth3 JOIN sitemap_firms sf ON sf.ico = d3.ico) as d3_prime,
      (SELECT COUNT(DISTINCT d4.ico) FILTER (WHERE sf.tier = 'PRIME') FROM depth4 JOIN sitemap_firms sf ON sf.ico = d4.ico) as d4_prime;
  `, "Depth C");

  const depthC = depthRows[0] || ["0", "0", "0", "0", "0", "0"];
  console.log(`  Depth ≤2:  ${parseInt(depthC[0]).toLocaleString()} firms (${parseInt(depthC[3]).toLocaleString()} PRIME)`);
  console.log(`  Depth ≤3:  ${parseInt(depthC[1]).toLocaleString()} firms (${parseInt(depthC[4]).toLocaleString()} PRIME)`);
  console.log(`  Depth ≤4:  ${parseInt(depthC[2]).toLocaleString()} firms (${parseInt(depthC[5]).toLocaleString()} PRIME)`);
  console.log();

  // Depth distribution for Config D
  console.log("── Depth Distribution (Config D — ~1000 hubs by SEO value) ──\n");

  const depthDRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL},
    top_cities AS (
      SELECT city FROM sitemap_firms WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC
    ),
    depth2 AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    ),
    depth3 AS (
      SELECT ico FROM depth2
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE okres IS NOT NULL
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2) ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND LENGTH("naceCode") >= 2
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    ),
    depth4 AS (
      SELECT ico FROM depth3
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY quality_score DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sitemap_firms WHERE city IN (SELECT city FROM top_cities)
      ) sub WHERE rn <= ${COMPANIES_PER_HUB}
    )
    SELECT
      (SELECT COUNT(DISTINCT ico) FROM depth2) as d2,
      (SELECT COUNT(DISTINCT ico) FROM depth3) as d3,
      (SELECT COUNT(DISTINCT ico) FROM depth4) as d4,
      (SELECT COUNT(DISTINCT d2.ico) FILTER (WHERE sf.tier = 'PRIME') FROM depth2 JOIN sitemap_firms sf ON sf.ico = d2.ico) as d2_prime,
      (SELECT COUNT(DISTINCT d3.ico) FILTER (WHERE sf.tier = 'PRIME') FROM depth3 JOIN sitemap_firms sf ON sf.ico = d3.ico) as d3_prime,
      (SELECT COUNT(DISTINCT d4.ico) FILTER (WHERE sf.tier = 'PRIME') FROM depth4 JOIN sitemap_firms sf ON sf.ico = d4.ico) as d4_prime;
  `, "Depth D");

  const depthD = depthDRows[0] || ["0", "0", "0", "0", "0", "0"];
  console.log(`  Depth ≤2:  ${parseInt(depthD[0]).toLocaleString()} firms (${parseInt(depthD[3]).toLocaleString()} PRIME)`);
  console.log(`  Depth ≤3:  ${parseInt(depthD[1]).toLocaleString()} firms (${parseInt(depthD[4]).toLocaleString()} PRIME)`);
  console.log(`  Depth ≤4:  ${parseInt(depthD[2]).toLocaleString()} firms (${parseInt(depthD[5]).toLocaleString()} PRIME)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // LINKS PER HUB (pagination analysis)
  // ═══════════════════════════════════════════════════════════════════
  console.log("── Links Per Hub (pagination needed?) ──\n");

  const linksPerHubRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL}
    SELECT
      'NACE section' as hub_type,
      LEFT("naceCode", 1) as hub_key,
      COUNT(*) as company_count
    FROM sitemap_firms WHERE "naceCode" IS NOT NULL
    GROUP BY hub_type, hub_key
    UNION ALL
    SELECT
      'Kraj' as hub_type,
      kraj as hub_key,
      COUNT(*) as company_count
    FROM sitemap_firms WHERE kraj IS NOT NULL
    GROUP BY hub_type, hub_key
    UNION ALL
    SELECT
      'NACE×Kraj' as hub_type,
      LEFT("naceCode", 1) || '|' || kraj as hub_key,
      COUNT(*) as company_count
    FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL
    GROUP BY hub_type, hub_key
    UNION ALL
    SELECT
      'Okres' as hub_type,
      okres as hub_key,
      COUNT(*) as company_count
    FROM sitemap_firms WHERE okres IS NOT NULL
    GROUP BY hub_type, hub_key
    UNION ALL
    SELECT
      'City (top 200)' as hub_type,
      city as hub_key,
      COUNT(*) as company_count
    FROM sitemap_firms WHERE city IS NOT NULL
    GROUP BY hub_type, hub_key
    ORDER BY company_count DESC
    LIMIT 20;
  `, "Links per hub");

  console.log("  Top 20 hubs by company count:");
  console.log("  Hub type      | Companies | Pages needed (50/page)");
  console.log("  --------------|-----------|----------------------");
  for (const [type, key, count] of linksPerHubRows) {
    const pages = Math.ceil(parseInt(count) / 50);
    console.log(`  ${type.padEnd(14)}| ${parseInt(count).toLocaleString().padStart(9)}| ${pages}`);
  }
  console.log();

  // Max companies per hub type
  const maxPerHubRows = sshQuery(`
    WITH ${SITEMAP_FIRMS_SQL}
    SELECT 'NACE section' as type, MAX(cnt) as max_count, AVG(cnt)::int as avg_count FROM (
      SELECT LEFT("naceCode", 1) as k, COUNT(*) as cnt FROM sitemap_firms WHERE "naceCode" IS NOT NULL GROUP BY k
    ) sub
    UNION ALL
    SELECT 'Kraj', MAX(cnt), AVG(cnt)::int FROM (
      SELECT kraj as k, COUNT(*) as cnt FROM sitemap_firms WHERE kraj IS NOT NULL GROUP BY k
    ) sub
    UNION ALL
    SELECT 'NACE×Kraj', MAX(cnt), AVG(cnt)::int FROM (
      SELECT LEFT("naceCode", 1) || '|' || kraj as k, COUNT(*) as cnt
      FROM sitemap_firms WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL GROUP BY k
    ) sub
    UNION ALL
    SELECT 'Okres', MAX(cnt), AVG(cnt)::int FROM (
      SELECT okres as k, COUNT(*) as cnt FROM sitemap_firms WHERE okres IS NOT NULL GROUP BY k
    ) sub
    UNION ALL
    SELECT 'City (top 200)', MAX(cnt), AVG(cnt)::int FROM (
      SELECT city as k, COUNT(*) as cnt FROM sitemap_firms
      WHERE city IN (SELECT city FROM sitemap_firms WHERE city IS NOT NULL GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 200)
      GROUP BY k
    ) sub;
  `, "Max per hub");

  console.log("  Max/avg companies per hub type:");
  console.log("  Hub type      | Max     | Avg    | Max pages (50/page)");
  console.log("  --------------|---------|--------|--------------------");
  for (const [type, maxCount, avgCount] of maxPerHubRows) {
    const pages = Math.ceil(parseInt(maxCount) / 50);
    console.log(`  ${type.padEnd(14)}| ${parseInt(maxCount).toLocaleString().padStart(7)}| ${parseInt(avgCount).toLocaleString().padStart(6)}| ${pages}`);
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY TABLE
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  PRIORITY-BASED INTERNAL LINKING SIMULATION");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("  Metric            |    A (geo)  |    B (city) |    C (SEO)  |    D (SEO+)  ");
  console.log("  ------------------|-------------|-------------|-------------|--------------");
  console.log(`  Hub pages         |         377 |         377 |         377 |        ~1300`);
  console.log(`  Firms reachable   | ${aReachable.toLocaleString().padStart(11)}| ${bReachable.toLocaleString().padStart(11)}| ${cReachable.toLocaleString().padStart(11)}| ${dReachable.toLocaleString().padStart(12)}`);
  console.log(`  PRIME reachable   | ${aPrime.toLocaleString().padStart(11)}| ${bPrime.toLocaleString().padStart(11)}| ${cPrime.toLocaleString().padStart(11)}| ${dPrime.toLocaleString().padStart(12)}`);
  console.log(`  GOOD reachable    | ${aGood.toLocaleString().padStart(11)}| ${bGood.toLocaleString().padStart(11)}| ${cGood.toLocaleString().padStart(11)}| ${dGood.toLocaleString().padStart(12)}`);
  console.log(`  PRIME orphan      | ${aPrimeOrphan.toLocaleString().padStart(11)}| ${bPrimeOrphan.toLocaleString().padStart(11)}| ${cPrimeOrphan.toLocaleString().padStart(11)}| ${dPrimeOrphan.toLocaleString().padStart(12)}`);
  console.log(`  PRIME orphan %    | ${(aPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1).padStart(10)}%| ${(bPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1).padStart(10)}%| ${(cPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1).padStart(10)}%| ${(dPrimeOrphan / (baseline.PRIME || 1) * 100).toFixed(1).padStart(11)}%`);
  console.log();

  console.log("  Depth distribution (Config C — recommended):");
  console.log(`    Depth ≤2:  ${parseInt(depthC[0]).toLocaleString()} firms (${parseInt(depthC[3]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤3:  ${parseInt(depthC[1]).toLocaleString()} firms (${parseInt(depthC[4]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤4:  ${parseInt(depthC[2]).toLocaleString()} firms (${parseInt(depthC[5]).toLocaleString()} PRIME)`);
  console.log();

  console.log("  Depth distribution (Config D — expanded):");
  console.log(`    Depth ≤2:  ${parseInt(depthD[0]).toLocaleString()} firms (${parseInt(depthD[3]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤3:  ${parseInt(depthD[1]).toLocaleString()} firms (${parseInt(depthD[4]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤4:  ${parseInt(depthD[2]).toLocaleString()} firms (${parseInt(depthD[5]).toLocaleString()} PRIME)`);
  console.log();

  // ── Recommendation ──────────────────────────────────────────────────
  console.log("  RECOMMENDATION:\n");

  const primeTotal = baseline.PRIME || 0;
  const cPrimePct = (cPrime / primeTotal * 100).toFixed(1);
  const dPrimePct = (dPrime / primeTotal * 100).toFixed(1);

  console.log(`  Config C (377 hubs, SEO-ordered):`);
  console.log(`    ${cPrime.toLocaleString()} / ${primeTotal.toLocaleString()} PRIME firms reachable (${cPrimePct}%)`);
  console.log(`    ${cPrimeOrphan.toLocaleString()} PRIME orphans (${(cPrimeOrphan / primeTotal * 100).toFixed(1)}%)`);
  console.log();
  console.log(`  Config D (~1300 hubs, SEO-ordered):`);
  console.log(`    ${dPrime.toLocaleString()} / ${primeTotal.toLocaleString()} PRIME firms reachable (${dPrimePct}%)`);
  console.log(`    ${dPrimeOrphan.toLocaleString()} PRIME orphans (${(dPrimeOrphan / primeTotal * 100).toFixed(1)}%)`);
  console.log();

  if (dPrimePct > cPrimePct + 10) {
    console.log(`  → Config D covers ${dPrimePct}% of PRIME vs Config C's ${cPrimePct}%`);
    console.log(`    Extra ${dPrime - cPrime} PRIME firms for ${1300 - 377} more hub pages`);
    console.log(`    Worth it if PRIME coverage is the priority`);
  } else {
    console.log(`  → Config C provides ${cPrimePct}% PRIME coverage with only 377 hubs`);
    console.log(`    Config D adds only ${(dPrimePct - cPrimePct).toFixed(1)}% more for 3.5× more hubs`);
    console.log(`    Config C is the better ROI`);
  }
  console.log();

  console.log("  PAGINATION:");
  console.log("    NACE section hubs: up to 1,851 pages (92,510 / 50) — needs pagination");
  console.log("    Kraj hubs: up to 1,955 pages — needs pagination");
  console.log("    NACE×Kraj: avg ~3,500 per hub — needs pagination");
  console.log("    Okres: avg ~3,600 per hub — needs pagination");
  console.log("    City: avg ~290 per hub — 6 pages max");
  console.log();
  console.log("    → Cap pagination at 10 pages per hub (500 companies)");
  console.log("    → This limits each hub to top 500 by SEO score");
  console.log("    → Remaining companies rely on sitemap + RelatedFirms");

  writeFileSync("/tmp/priority-linking.json", JSON.stringify({
    baseline,
    configs: {
      A: { hubs: 377, reachable: aReachable, prime: aPrime, good: aGood, primeOrphan: aPrimeOrphan },
      B: { hubs: 377, reachable: bReachable, prime: bPrime, good: bGood, primeOrphan: bPrimeOrphan },
      C: { hubs: 377, reachable: cReachable, prime: cPrime, good: cGood, primeOrphan: cPrimeOrphan },
      D: { hubs: 1300, reachable: dReachable, prime: dPrime, good: dGood, primeOrphan: dPrimeOrphan },
    },
    depthC: { d2: parseInt(depthC[0]), d3: parseInt(depthC[1]), d4: parseInt(depthC[2]), d2p: parseInt(depthC[3]), d3p: parseInt(depthC[4]), d4p: parseInt(depthC[5]) },
    depthD: { d2: parseInt(depthD[0]), d3: parseInt(depthD[1]), d4: parseInt(depthD[2]), d2p: parseInt(depthD[3]), d3p: parseInt(depthD[4]), d4p: parseInt(depthD[5]) },
  }, null, 2));
  console.log("\n  Full JSON report: /tmp/priority-linking.json");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
