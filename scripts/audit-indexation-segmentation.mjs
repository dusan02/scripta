#!/usr/bin/env node
/**
 * Indexation Segmentation Audit
 *
 * Queries the production DB to segment all company URLs by:
 *  - Financial statement count (0, 1, 2-3, 4-5, 6+)
 *  - Legal status (ACTIVE, LIQUIDATION, BANKRUPT, DISSOLVED, UNKNOWN)
 *  - Company age (0-2, 3-5, 6-10, 11-20, 21+ years)
 *  - NACE section (A-U)
 *  - Region (kraj)
 *  - Company size (micro, small, medium, large, unknown)
 *  - Employee count (0, 1-10, 11-50, 51-250, 251+)
 *  - Content completeness (name, city, NACE, ORSR, employees, revenue)
 *  - Audit verdict, vestnik events, company persons
 *
 * Calculates an indexationQualityScore for each company and produces:
 *  - PRIME / GOOD / WEAK / THIN / NOINDEX-CANDIDATE distribution
 *  - Full JSON report
 */

import { writeFileSync, writeFileSync as wf } from "fs";
import { execSync } from "child_process";

const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";

/**
 * Execute SQL on the remote DB by writing it to a temp file,
 * scp-ing it, and piping it to psql inside the container.
 */
function sshQuery(sql) {
  const tmpFile = `/tmp/audit_query_${Date.now()}.sql`;
  wf(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/audit_query.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/audit_query.sql'`,
      { timeout: 120000, encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.split("|"));
  } catch (e) {
    console.error(`  Query failed: ${e.message.split("\n")[0]}`);
    return [];
  }
}

async function main() {
  console.log("=== Indexation Segmentation Audit ===\n");

  // ── 1. Total company count ──────────────────────────────────────────
  const totalRows = sshQuery(`SELECT COUNT(*) FROM "Company";`);
  const totalCompanies = parseInt(totalRows[0]?.[0] || "0");
  console.log(`Total companies in DB: ${totalCompanies.toLocaleString()}`);

  // ── 2. Companies in sitemap (≥2 FS) ─────────────────────────────────
  const sitemapRows = sshQuery(`
    SELECT COUNT(*) FROM "Company" c
    WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2;
  `);
  const sitemapCompanies = parseInt(sitemapRows[0]?.[0] || "0");
  console.log(`Companies in sitemap (≥2 FS): ${sitemapCompanies.toLocaleString()}`);
  console.log(`Sitemap URLs (×6 langs): ${(sitemapCompanies * 6).toLocaleString()}`);
  console.log();

  // ── 3. Financial statement count distribution ───────────────────────
  console.log("── Financial Statement Count Distribution ──");
  const fsRows = sshQuery(`
    SELECT
      CASE
        WHEN fs_count = 0 THEN '0 (no FS)'
        WHEN fs_count = 1 THEN '1'
        WHEN fs_count BETWEEN 2 AND 3 THEN '2-3'
        WHEN fs_count BETWEEN 4 AND 5 THEN '4-5'
        WHEN fs_count BETWEEN 6 AND 10 THEN '6-10'
        WHEN fs_count > 10 THEN '11+'
      END as fs_bucket,
      COUNT(*) as company_count
    FROM (
      SELECT c.ico, COUNT(fs."companyIco") as fs_count
      FROM "Company" c
      LEFT JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
      GROUP BY c.ico
    ) sub
    GROUP BY fs_bucket
    ORDER BY MIN(fs_count);
  `);
  const fsDistribution = fsRows.map(([bucket, count]) => ({ bucket, count: parseInt(count) }));
  for (const r of fsDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.bucket.padEnd(12)} ${r.count.toLocaleString().padStart(8)} (${pct}%)`);
  }
  console.log();

  // ── 4. Legal status distribution ────────────────────────────────────
  console.log("── Legal Status Distribution ──");
  const lsRows = sshQuery(`
    SELECT COALESCE("legalStatus", 'UNKNOWN') as status, COUNT(*) as cnt
    FROM "Company"
    GROUP BY "legalStatus"
    ORDER BY cnt DESC;
  `);
  const lsDistribution = lsRows.map(([status, count]) => ({ status, count: parseInt(count) }));
  for (const r of lsDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.status.padEnd(20)} ${r.count.toLocaleString().padStart(8)} (${pct}%)`);
  }
  console.log();

  // ── 5. Company age distribution ─────────────────────────────────────
  console.log("── Company Age Distribution ──");
  const ageRows = sshQuery(`
    SELECT
      CASE
        WHEN "establishedAt" IS NULL THEN 'unknown'
        WHEN EXTRACT(YEAR FROM age("establishedAt")) < 3 THEN '0-2 years'
        WHEN EXTRACT(YEAR FROM age("establishedAt")) < 6 THEN '3-5 years'
        WHEN EXTRACT(YEAR FROM age("establishedAt")) < 11 THEN '6-10 years'
        WHEN EXTRACT(YEAR FROM age("establishedAt")) < 21 THEN '11-20 years'
        ELSE '21+ years'
      END as age_bucket,
      COUNT(*) as cnt
    FROM "Company"
    GROUP BY age_bucket
    ORDER BY age_bucket;
  `);
  const ageDistribution = ageRows.map(([bucket, count]) => ({ bucket, count: parseInt(count) }));
  for (const r of ageDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.bucket.padEnd(15)} ${r.count.toLocaleString().padStart(8)} (${pct}%)`);
  }
  console.log();

  // ── 6. NACE section distribution ────────────────────────────────────
  console.log("── NACE Section Distribution (top 10) ──");
  const naceRows = sshQuery(`
    SELECT LEFT("naceCode", 1) as nace_section, COUNT(*) as cnt
    FROM "Company"
    WHERE "naceCode" IS NOT NULL
    GROUP BY nace_section
    ORDER BY cnt DESC
    LIMIT 10;
  `);
  const naceDistribution = naceRows.map(([section, count]) => ({ section, count: parseInt(count) }));
  for (const r of naceDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.section.padEnd(5)} ${r.count.toLocaleString().padStart(8)} (${pct}%)`);
  }
  const noNaceRows = sshQuery(`SELECT COUNT(*) FROM "Company" WHERE "naceCode" IS NULL;`);
  const noNace = parseInt(noNaceRows[0]?.[0] || "0");
  console.log(`  N/A   ${noNace.toLocaleString().padStart(8)} (no NACE)`);
  console.log();

  // ── 7. Region (kraj) distribution ───────────────────────────────────
  console.log("── Region (kraj) Distribution ──");
  const krajRows = sshQuery(`
    SELECT COALESCE("kraj", 'unknown') as kraj, COUNT(*) as cnt
    FROM "Company"
    GROUP BY "kraj"
    ORDER BY cnt DESC;
  `);
  const krajDistribution = krajRows.map(([kraj, count]) => ({ kraj, count: parseInt(count) }));
  for (const r of krajDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.kraj.padEnd(10)} ${r.count.toLocaleString().padStart(8)} (${pct}%)`);
  }
  console.log();

  // ── 8. Company size distribution ────────────────────────────────────
  console.log("── Company Size Distribution ──");
  const sizeRows = sshQuery(`
    SELECT COALESCE("sizeCategoryNormalized", 'unknown') as size, COUNT(*) as cnt
    FROM "Company"
    GROUP BY "sizeCategoryNormalized"
    ORDER BY cnt DESC;
  `);
  const sizeDistribution = sizeRows.map(([size, count]) => ({ size, count: parseInt(count) }));
  for (const r of sizeDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.size.padEnd(10)} ${r.count.toLocaleString().padStart(8)} (${pct}%)`);
  }
  console.log();

  // ── 9. Employee count distribution ──────────────────────────────────
  console.log("── Employee Count Distribution ──");
  const empRows = sshQuery(`
    SELECT
      CASE
        WHEN "employeeCount" IS NULL THEN 'unknown'
        WHEN "employeeCount" = 0 THEN '0'
        WHEN "employeeCount" BETWEEN 1 AND 10 THEN '1-10'
        WHEN "employeeCount" BETWEEN 11 AND 50 THEN '11-50'
        WHEN "employeeCount" BETWEEN 51 AND 250 THEN '51-250'
        ELSE '251+'
      END as emp_bucket,
      COUNT(*) as cnt
    FROM "Company"
    GROUP BY emp_bucket
    ORDER BY emp_bucket;
  `);
  const empDistribution = empRows.map(([bucket, count]) => ({ bucket, count: parseInt(count) }));
  for (const r of empDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.bucket.padEnd(10)} ${r.count.toLocaleString().padStart(8)} (${pct}%)`);
  }
  console.log();

  // ── 10. Content completeness ────────────────────────────────────────
  console.log("── Content Completeness ──");
  const completenessRows = sshQuery(`
    SELECT
      SUM(CASE WHEN "name" IS NOT NULL THEN 1 ELSE 0 END) as has_name,
      SUM(CASE WHEN "city" IS NOT NULL THEN 1 ELSE 0 END) as has_city,
      SUM(CASE WHEN "naceCode" IS NOT NULL THEN 1 ELSE 0 END) as has_nace,
      SUM(CASE WHEN "naceText" IS NOT NULL THEN 1 ELSE 0 END) as has_nace_text,
      SUM(CASE WHEN "businessActivity" IS NOT NULL THEN 1 ELSE 0 END) as has_activity,
      SUM(CASE WHEN "employeeCount" IS NOT NULL THEN 1 ELSE 0 END) as has_employees,
      SUM(CASE WHEN "legalForm" IS NOT NULL THEN 1 ELSE 0 END) as has_legal_form,
      SUM(CASE WHEN "shareCapital" IS NOT NULL THEN 1 ELSE 0 END) as has_share_capital,
      SUM(CASE WHEN "orsrSyncedAt" IS NOT NULL THEN 1 ELSE 0 END) as has_orsr,
      SUM(CASE WHEN "ruzSyncedAt" IS NOT NULL THEN 1 ELSE 0 END) as has_ruz,
      SUM(CASE WHEN "latestRevenue" IS NOT NULL THEN 1 ELSE 0 END) as has_revenue,
      SUM(CASE WHEN "kraj" IS NOT NULL THEN 1 ELSE 0 END) as has_kraj,
      COUNT(*) as total
    FROM "Company";
  `);
  const completeness = completenessRows[0] || [];
  const fields = ["name", "city", "naceCode", "naceText", "businessActivity", "employees", "legalForm", "shareCapital", "orsr", "ruz", "revenue", "kraj"];
  const completenessObj = {};
  for (let i = 0; i < fields.length; i++) {
    const count = parseInt(completeness[i] || "0");
    const pct = (count / totalCompanies * 100).toFixed(1);
    console.log(`  has_${fields[i].padEnd(18)} ${count.toLocaleString().padStart(8)} (${pct}%)`);
    completenessObj[fields[i]] = count;
  }
  console.log();

  // ── 11. Audit verdict + vestnik events + persons ────────────────────
  console.log("── Audit Verdict + Vestník Events + Persons ──");
  const auditRows = sshQuery(`SELECT COUNT(*) FROM "Company" c WHERE EXISTS (SELECT 1 FROM "AuditVerdict" av WHERE av."companyIco" = c.ico);`);
  const auditCount = parseInt(auditRows[0]?.[0] || "0");
  console.log(`  Has audit verdict:     ${auditCount.toLocaleString()}`);

  const vestnikRows = sshQuery(`SELECT COUNT(*) FROM "Company" c WHERE EXISTS (SELECT 1 FROM "VestnikEvent" ve WHERE ve."companyIco" = c.ico);`);
  const vestnikCount = parseInt(vestnikRows[0]?.[0] || "0");
  console.log(`  Has vestník events:    ${vestnikCount.toLocaleString()}`);

  const eventsRows = sshQuery(`SELECT COUNT(*) FROM "Company" c WHERE EXISTS (SELECT 1 FROM "CompanyEvent" ce WHERE ce."companyIco" = c.ico);`);
  const eventsCount = parseInt(eventsRows[0]?.[0] || "0");
  console.log(`  Has company events:    ${eventsCount.toLocaleString()}`);

  const personsRows = sshQuery(`SELECT COUNT(*) FROM "Company" c WHERE EXISTS (SELECT 1 FROM "CompanyPerson" cp WHERE cp."companyIco" = c.ico);`);
  const personsCount = parseInt(personsRows[0]?.[0] || "0");
  console.log(`  Has company persons:   ${personsCount.toLocaleString()}`);
  console.log();

  // ── 12. Indexation Quality Score (ALL companies) ────────────────────
  console.log("── Indexation Quality Score Distribution (ALL companies) ──");
  console.log("  Scoring: FS count (30) + active status (20) + name (10) + city (5) +");
  console.log("           NACE (5) + employees (5) + ORSR (5) + revenue (10) + age (10)");
  console.log();

  const scoreRows = sshQuery(`
    WITH company_scores AS (
      SELECT
        c.ico,
        CASE
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 5 THEN 30
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 3 THEN 25
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2 THEN 20
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) = 1 THEN 10
          ELSE 0
        END as fs_score,
        CASE
          WHEN c."legalStatus" = 'ACTIVE' THEN 20
          WHEN c."legalStatus" IS NULL THEN 10
          WHEN c."legalStatus" = 'UNKNOWN' THEN 10
          WHEN c."legalStatus" = 'LIQUIDATION' THEN 5
          WHEN c."legalStatus" = 'DISSOLVED' THEN 0
          WHEN c."legalStatus" = 'BANKRUPT' THEN 0
          ELSE 5
        END as status_score,
        CASE WHEN c.name IS NOT NULL THEN 10 ELSE 0 END as name_score,
        CASE WHEN c.city IS NOT NULL THEN 5 ELSE 0 END as city_score,
        CASE WHEN c."naceCode" IS NOT NULL THEN 5 ELSE 0 END as nace_score,
        CASE WHEN c."employeeCount" IS NOT NULL THEN 5 ELSE 0 END as emp_score,
        CASE WHEN c."orsrSyncedAt" IS NOT NULL THEN 5 ELSE 0 END as orsr_score,
        CASE WHEN c."latestRevenue" IS NOT NULL THEN 10 ELSE 0 END as revenue_score,
        CASE
          WHEN c."establishedAt" IS NULL THEN 0
          WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 10 THEN 10
          WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 5 THEN 7
          WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 2 THEN 5
          ELSE 2
        END as age_score
      FROM "Company" c
    )
    SELECT
      CASE
        WHEN total >= 90 THEN 'PRIME (90-100)'
        WHEN total >= 75 THEN 'GOOD (75-89)'
        WHEN total >= 50 THEN 'WEAK (50-74)'
        WHEN total >= 25 THEN 'THIN (25-49)'
        ELSE 'NOINDEX-CANDIDATE (0-24)'
      END as quality_tier,
      COUNT(*) as cnt,
      ROUND(AVG(total)::numeric, 1) as avg_score
    FROM (
      SELECT ico, fs_score + status_score + name_score + city_score + nace_score + emp_score + orsr_score + revenue_score + age_score as total
      FROM company_scores
    ) scored
    GROUP BY quality_tier
    ORDER BY quality_tier DESC;
  `);

  const scoreDistribution = scoreRows.map(([tier, count, avg]) => ({ tier, count: parseInt(count), avgScore: parseFloat(avg) }));
  for (const r of scoreDistribution) {
    const pct = (r.count / totalCompanies * 100).toFixed(1);
    console.log(`  ${r.tier.padEnd(25)} ${r.count.toLocaleString().padStart(8)} (${pct}%) avg=${r.avgScore}`);
  }
  console.log();

  // ── 13. Sitemap-only score distribution (≥2 FS) ─────────────────────
  console.log("── Indexation Quality Score (sitemap only, ≥2 FS) ──");
  const sitemapScoreRows = sshQuery(`
    WITH company_scores AS (
      SELECT
        c.ico,
        CASE
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 5 THEN 30
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 3 THEN 25
          WHEN (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2 THEN 20
          ELSE 10
        END as fs_score,
        CASE
          WHEN c."legalStatus" = 'ACTIVE' THEN 20
          WHEN c."legalStatus" IS NULL THEN 10
          WHEN c."legalStatus" = 'UNKNOWN' THEN 10
          WHEN c."legalStatus" = 'LIQUIDATION' THEN 5
          ELSE 0
        END as status_score,
        CASE WHEN c.name IS NOT NULL THEN 10 ELSE 0 END as name_score,
        CASE WHEN c.city IS NOT NULL THEN 5 ELSE 0 END as city_score,
        CASE WHEN c."naceCode" IS NOT NULL THEN 5 ELSE 0 END as nace_score,
        CASE WHEN c."employeeCount" IS NOT NULL THEN 5 ELSE 0 END as emp_score,
        CASE WHEN c."orsrSyncedAt" IS NOT NULL THEN 5 ELSE 0 END as orsr_score,
        CASE WHEN c."latestRevenue" IS NOT NULL THEN 10 ELSE 0 END as revenue_score,
        CASE
          WHEN c."establishedAt" IS NULL THEN 0
          WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 10 THEN 10
          WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 5 THEN 7
          WHEN EXTRACT(YEAR FROM age(c."establishedAt")) >= 2 THEN 5
          ELSE 2
        END as age_score
      FROM "Company" c
      WHERE (SELECT COUNT(*) FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico) >= 2
    )
    SELECT
      CASE
        WHEN total >= 90 THEN 'PRIME (90-100)'
        WHEN total >= 75 THEN 'GOOD (75-89)'
        WHEN total >= 50 THEN 'WEAK (50-74)'
        WHEN total >= 25 THEN 'THIN (25-49)'
        ELSE 'NOINDEX-CANDIDATE (0-24)'
      END as quality_tier,
      COUNT(*) as cnt,
      ROUND(AVG(total)::numeric, 1) as avg_score
    FROM (
      SELECT ico, fs_score + status_score + name_score + city_score + nace_score + emp_score + orsr_score + revenue_score + age_score as total
      FROM company_scores
    ) scored
    GROUP BY quality_tier
    ORDER BY quality_tier DESC;
  `);

  const sitemapScoreDist = sitemapScoreRows.map(([tier, count, avg]) => ({ tier, count: parseInt(count), avgScore: parseFloat(avg) }));
  for (const r of sitemapScoreDist) {
    const pct = (r.count / sitemapCompanies * 100).toFixed(1);
    console.log(`  ${r.tier.padEnd(25)} ${r.count.toLocaleString().padStart(8)} (${pct}%) avg=${r.avgScore}`);
  }
  console.log();

  // ── 14. Cross-tab: FS count × legal status (sitemap only) ───────────
  console.log("── Cross-tab: FS Count × Legal Status (sitemap, ≥2 FS) ──");
  const crossRows = sshQuery(`
    SELECT
      CASE
        WHEN fs_count BETWEEN 2 AND 3 THEN '2-3 FS'
        WHEN fs_count BETWEEN 4 AND 5 THEN '4-5 FS'
        WHEN fs_count BETWEEN 6 AND 10 THEN '6-10 FS'
        WHEN fs_count > 10 THEN '11+ FS'
      END as fs_bucket,
      COALESCE("legalStatus", 'UNKNOWN') as status,
      COUNT(*) as cnt
    FROM (
      SELECT c.ico, c."legalStatus", COUNT(fs."companyIco") as fs_count
      FROM "Company" c
      JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
      GROUP BY c.ico, c."legalStatus"
      HAVING COUNT(fs."companyIco") >= 2
    ) sub
    GROUP BY fs_bucket, status
    ORDER BY fs_bucket, cnt DESC;
  `);

  let currentBucket = "";
  const crossTab = [];
  for (const [bucket, status, count] of crossRows) {
    if (bucket !== currentBucket) {
      currentBucket = bucket;
      console.log(`  ${bucket}:`);
    }
    console.log(`    ${status.padEnd(15)} ${parseInt(count).toLocaleString().padStart(8)}`);
    crossTab.push({ bucket, status, count: parseInt(count) });
  }
  console.log();

  // ── 15. Summary ─────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  INDEXATION SEGMENTATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`  Total companies:        ${totalCompanies.toLocaleString()}`);
  console.log(`  In sitemap (≥2 FS):     ${sitemapCompanies.toLocaleString()} (${(sitemapCompanies / totalCompanies * 100).toFixed(1)}%)`);
  console.log(`  Sitemap URLs (×6):      ${(sitemapCompanies * 6).toLocaleString()}`);
  console.log();

  console.log("  Quality tiers (all companies):");
  for (const r of scoreDistribution) {
    console.log(`    ${r.tier.padEnd(25)} ${r.count.toLocaleString().padStart(8)} (${(r.count / totalCompanies * 100).toFixed(1)}%)`);
  }
  console.log();

  console.log("  Quality tiers (sitemap only, ≥2 FS):");
  for (const r of sitemapScoreDist) {
    console.log(`    ${r.tier.padEnd(25)} ${r.count.toLocaleString().padStart(8)} (${(r.count / sitemapCompanies * 100).toFixed(1)}%)`);
  }

  // Write JSON
  const report = {
    timestamp: new Date().toISOString(),
    totalCompanies,
    sitemapCompanies,
    sitemapUrls: sitemapCompanies * 6,
    fsDistribution,
    lsDistribution,
    ageDistribution,
    naceDistribution,
    noNace,
    krajDistribution,
    sizeDistribution,
    empDistribution,
    completeness: completenessObj,
    auditVerdictCount: auditCount,
    vestnikEventsCount: vestnikCount,
    companyEventsCount: eventsCount,
    companyPersonsCount: personsCount,
    scoreDistribution,
    sitemapScoreDist,
    crossTab,
  };
  writeFileSync("/tmp/indexation-segmentation.json", JSON.stringify(report, null, 2));
  console.log("\n  Full JSON report: /tmp/indexation-segmentation.json");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
