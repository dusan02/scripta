#!/usr/bin/env node
/**
 * Depth distribution fix — separate queries for each depth level
 */
import { writeFileSync } from "fs";
import { execSync } from "child_process";

const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";
const PER_HUB = 250;

function sshQuery(sql) {
  const tmpFile = `/tmp/depth_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/depth.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/depth.sql'`,
      { timeout: 300000, encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.split("|"));
  } catch (e) {
    console.error(`  Query failed: ${e.message.split("\n")[0]}`);
    return [];
  }
}

const SCORE_SQL = `
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
`;

async function main() {
  console.log("=== Depth Distribution (Config C — 377 hubs, SEO-ordered) ===\n");

  // Depth ≤2: companies from NACE section + Kraj hubs
  const d2Rows = sshQuery(`
    WITH sf AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue",
        (${SCORE_SQL}) as qs,
        CASE WHEN (${SCORE_SQL}) >= 90 THEN 'PRIME' ELSE 'OTHER' END as tier
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    reachable AS (
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sf WHERE "naceCode" IS NOT NULL
      ) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (
        SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn
        FROM sf WHERE kraj IS NOT NULL
      ) sub WHERE rn <= ${PER_HUB}
    )
    SELECT
      COUNT(DISTINCT r.ico) as total,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime
    FROM reachable r JOIN sf ON sf.ico = r.ico;
  `);
  const d2 = d2Rows[0] || ["0", "0"];
  console.log(`  Depth ≤2:  ${parseInt(d2[0]).toLocaleString()} firms (${parseInt(d2[1]).toLocaleString()} PRIME)`);

  // Depth ≤3: + NACE×Kraj + Okres
  const d3Rows = sshQuery(`
    WITH sf AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue",
        (${SCORE_SQL}) as qs,
        CASE WHEN (${SCORE_SQL}) >= 90 THEN 'PRIME' ELSE 'OTHER' END as tier
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    reachable AS (
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE okres IS NOT NULL) sub WHERE rn <= ${PER_HUB}
    )
    SELECT
      COUNT(DISTINCT r.ico) as total,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime
    FROM reachable r JOIN sf ON sf.ico = r.ico;
  `);
  const d3 = d3Rows[0] || ["0", "0"];
  console.log(`  Depth ≤3:  ${parseInt(d3[0]).toLocaleString()} firms (${parseInt(d3[1]).toLocaleString()} PRIME)`);

  // Depth ≤4: + City (top 200)
  const d4Rows = sshQuery(`
    WITH sf AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue",
        (${SCORE_SQL}) as qs,
        CASE WHEN (${SCORE_SQL}) >= 90 THEN 'PRIME' ELSE 'OTHER' END as tier
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    top_cities AS (
      SELECT city FROM sf WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC LIMIT 200
    ),
    reachable AS (
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE okres IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE city IN (SELECT city FROM top_cities)) sub WHERE rn <= ${PER_HUB}
    )
    SELECT
      COUNT(DISTINCT r.ico) as total,
      COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime
    FROM reachable r JOIN sf ON sf.ico = r.ico;
  `);
  const d4 = d4Rows[0] || ["0", "0"];
  console.log(`  Depth ≤4:  ${parseInt(d4[0]).toLocaleString()} firms (${parseInt(d4[1]).toLocaleString()} PRIME)`);
  console.log();

  // ── Config D depth ──────────────────────────────────────────────────
  console.log("=== Depth Distribution (Config D — ~1300 hubs, SEO-ordered) ===\n");

  const dD2Rows = sshQuery(`
    WITH sf AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue",
        (${SCORE_SQL}) as qs,
        CASE WHEN (${SCORE_SQL}) >= 90 THEN 'PRIME' ELSE 'OTHER' END as tier
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    reachable AS (
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
    )
    SELECT COUNT(DISTINCT r.ico) as total, COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime
    FROM reachable r JOIN sf ON sf.ico = r.ico;
  `);
  const dD2 = dD2Rows[0] || ["0", "0"];
  console.log(`  Depth ≤2:  ${parseInt(dD2[0]).toLocaleString()} firms (${parseInt(dD2[1]).toLocaleString()} PRIME)`);

  const dD3Rows = sshQuery(`
    WITH sf AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue",
        (${SCORE_SQL}) as qs,
        CASE WHEN (${SCORE_SQL}) >= 90 THEN 'PRIME' ELSE 'OTHER' END as tier
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    reachable AS (
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE okres IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL AND LENGTH("naceCode") >= 2) sub WHERE rn <= ${PER_HUB}
    )
    SELECT COUNT(DISTINCT r.ico) as total, COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime
    FROM reachable r JOIN sf ON sf.ico = r.ico;
  `);
  const dD3 = dD3Rows[0] || ["0", "0"];
  console.log(`  Depth ≤3:  ${parseInt(dD3[0]).toLocaleString()} firms (${parseInt(dD3[1]).toLocaleString()} PRIME)`);

  const dD4Rows = sshQuery(`
    WITH sf AS (
      SELECT c.ico, c."naceCode", c.kraj, c.okres, c.city, c."latestRevenue",
        (${SCORE_SQL}) as qs,
        CASE WHEN (${SCORE_SQL}) >= 90 THEN 'PRIME' ELSE 'OTHER' END as tier
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
    ),
    top_cities AS (
      SELECT city FROM sf WHERE city IS NOT NULL
      GROUP BY city HAVING COUNT(*) >= 20 ORDER BY COUNT(*) DESC
    ),
    reachable AS (
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 1), kraj ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL AND kraj IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY okres ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE okres IS NOT NULL) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY LEFT("naceCode", 2) ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE "naceCode" IS NOT NULL AND LENGTH("naceCode") >= 2) sub WHERE rn <= ${PER_HUB}
      UNION
      SELECT ico FROM (SELECT ico, ROW_NUMBER() OVER (PARTITION BY city ORDER BY qs DESC, "latestRevenue" DESC NULLS LAST) as rn FROM sf WHERE city IN (SELECT city FROM top_cities)) sub WHERE rn <= ${PER_HUB}
    )
    SELECT COUNT(DISTINCT r.ico) as total, COUNT(DISTINCT r.ico) FILTER (WHERE sf.tier = 'PRIME') as prime
    FROM reachable r JOIN sf ON sf.ico = r.ico;
  `);
  const dD4 = dD4Rows[0] || ["0", "0"];
  console.log(`  Depth ≤4:  ${parseInt(dD4[0]).toLocaleString()} firms (${parseInt(dD4[1]).toLocaleString()} PRIME)`);
  console.log();

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  DEPTH DISTRIBUTION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("  Config C (377 hubs):");
  console.log(`    Depth ≤2:  ${parseInt(d2[0]).toLocaleString()} firms (${parseInt(d2[1]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤3:  ${parseInt(d3[0]).toLocaleString()} firms (${parseInt(d3[1]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤4:  ${parseInt(d4[0]).toLocaleString()} firms (${parseInt(d4[1]).toLocaleString()} PRIME)`);
  console.log();
  console.log("  Config D (~1300 hubs):");
  console.log(`    Depth ≤2:  ${parseInt(dD2[0]).toLocaleString()} firms (${parseInt(dD2[1]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤3:  ${parseInt(dD3[0]).toLocaleString()} firms (${parseInt(dD3[1]).toLocaleString()} PRIME)`);
  console.log(`    Depth ≤4:  ${parseInt(dD4[0]).toLocaleString()} firms (${parseInt(dD4[1]).toLocaleString()} PRIME)`);
  console.log();

  const primeTotal = 265119;
  console.log(`  PRIME coverage at depth ≤4:`);
  console.log(`    Config C: ${parseInt(d4[1]).toLocaleString()} / ${primeTotal.toLocaleString()} (${(parseInt(d4[1]) / primeTotal * 100).toFixed(1)}%)`);
  console.log(`    Config D: ${parseInt(dD4[1]).toLocaleString()} / ${primeTotal.toLocaleString()} (${(parseInt(dD4[1]) / primeTotal * 100).toFixed(1)}%)`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
