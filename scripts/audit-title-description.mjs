#!/usr/bin/env node
/**
 * Title & Description Length Analysis
 *
 * Fetches 200 random /firma/ URLs from sitemap and checks:
 *  - Title length (ideal: 30-60 chars, max 70)
 *  - Description length (ideal: 120-160 chars, max 180)
 *  - Title pattern (company name + suffix)
 *  - Description pattern (company name + financial data)
 *
 * Also queries DB for all company names to do a deterministic analysis
 * of what titles/descriptions would look like across the full dataset.
 */

import { writeFileSync } from "fs";
import { execSync } from "child_process";

const BASE = "https://verifa.sk";
const SSH_HOST = "root@89.185.250.213";
const CONTAINER = "verifa_postgres";

function sshQuery(sql) {
  const tmpFile = `/tmp/title_query_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execSync(`scp ${tmpFile} ${SSH_HOST}:/tmp/title_query.sql 2>/dev/null`, { timeout: 15000 });
    const output = execSync(
      `ssh ${SSH_HOST} 'docker exec -i ${CONTAINER} psql -U verifa -d verifa -t -A -F"|" < /tmp/title_query.sql'`,
      { timeout: 120000, encoding: "utf-8" }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.split("|"));
  } catch (e) {
    return [];
  }
}

async function fetchRaw(url) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body };
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractDescription(html) {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function main() {
  console.log("=== Title & Description Length Analysis ===\n");

  // ── 1. DB-based analysis: title/description length distribution ─────
  console.log("── 1. DB-Based Title Length Distribution ──");
  console.log("  (Simulated: '{name} — finančné výsledky, zisk, súvaha | Verifa')\n");

  // Title template: "{name} — finančné výsledky, zisk, súvaha | Verifa"
  // Let's check what template is used
  const titleTemplate = "{name} — finančné výsledky, zisk, súvaha | Verifa";
  const titleSuffix = " — finančné výsledky, zisk, súvaha | Verifa";
  const descTemplate = "Finančné dáta firmy {name} (IČO {ico}){city}. Tržby, zisk, súvaha, zamestnanci, bonita a riziko.";

  const titleRows = sshQuery(`
    SELECT
      CASE
        WHEN LENGTH(COALESCE(name, 'IČO ' || ico)) + ${titleSuffix.length} < 30 THEN 'too_short (<30)'
        WHEN LENGTH(COALESCE(name, 'IČO ' || ico)) + ${titleSuffix.length} <= 60 THEN 'ideal (30-60)'
        WHEN LENGTH(COALESCE(name, 'IČO ' || ico)) + ${titleSuffix.length} <= 70 THEN 'acceptable (61-70)'
        WHEN LENGTH(COALESCE(name, 'IČO ' || ico)) + ${titleSuffix.length} <= 80 THEN 'long (71-80)'
        ELSE 'too_long (>80)'
      END as title_bucket,
      COUNT(*) as cnt,
      ROUND(AVG(LENGTH(COALESCE(name, 'IČO ' || ico)) + ${titleSuffix.length})::numeric, 1) as avg_len,
      MAX(LENGTH(COALESCE(name, 'IČO ' || ico)) + ${titleSuffix.length}) as max_len
    FROM "Company" c
    WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)
    GROUP BY title_bucket
    ORDER BY title_bucket;
  `);

  const titleDist = titleRows.map(([bucket, count, avgLen, maxLen]) => ({
    bucket, count: parseInt(count), avgLen: parseFloat(avgLen), maxLen: parseInt(maxLen)
  }));

  const totalWithTitle = titleDist.reduce((sum, r) => sum + r.count, 0);
  for (const r of titleDist) {
    const pct = (r.count / totalWithTitle * 100).toFixed(1);
    console.log(`  ${r.bucket.padEnd(20)} ${r.count.toLocaleString().padStart(8)} (${pct}%)  avg=${r.avgLen} max=${r.maxLen}`);
  }
  console.log();

  // ── 2. DB-based description length distribution ─────────────────────
  console.log("── 2. DB-Based Description Length Distribution ──");
  console.log("  (Simulated: 'Finančné dáta firmy {name} (IČO {ico}){city}. Tržby, zisk...')\n");

  const descRows = sshQuery(`
    SELECT
      CASE
        WHEN desc_len < 120 THEN 'too_short (<120)'
        WHEN desc_len <= 160 THEN 'ideal (120-160)'
        WHEN desc_len <= 180 THEN 'acceptable (161-180)'
        WHEN desc_len <= 200 THEN 'long (181-200)'
        ELSE 'too_long (>200)'
      END as desc_bucket,
      COUNT(*) as cnt,
      ROUND(AVG(desc_len)::numeric, 1) as avg_len,
      MAX(desc_len) as max_len
    FROM (
      SELECT
        LENGTH(
          'Finančné dáta firmy ' || COALESCE(name, 'IČO ' || ico) ||
          ' (IČO ' || ico || ')' ||
          CASE WHEN city IS NOT NULL THEN ', ' || city ELSE '' END ||
          '. Tržby, zisk, súvaha, zamestnanci, bonita a riziko.'
        ) as desc_len
      FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico)
    ) sub
    GROUP BY desc_bucket
    ORDER BY desc_bucket;
  `);

  const descDist = descRows.map(([bucket, count, avgLen, maxLen]) => ({
    bucket, count: parseInt(count), avgLen: parseFloat(avgLen), maxLen: parseInt(maxLen)
  }));

  const totalWithDesc = descDist.reduce((sum, r) => sum + r.count, 0);
  for (const r of descDist) {
    const pct = (r.count / totalWithDesc * 100).toFixed(1);
    console.log(`  ${r.bucket.padEnd(20)} ${r.count.toLocaleString().padStart(8)} (${pct}%)  avg=${r.avgLen} max=${r.maxLen}`);
  }
  console.log();

  // ── 3. Live sample: 50 random URLs ──────────────────────────────────
  console.log("── 3. Live Sample: 50 Random URLs ──\n");

  // Fetch sitemap and sample
  const idxRes = await fetchRaw(`${BASE}/sitemap.xml`);
  const shardUrls = extractLocs(idxRes.body);

  // Sample from 3 shards
  const firmaUrls = [];
  for (const shardId of [1, 15, 30]) {
    const shardRes = await fetchRaw(`${BASE}/sitemap/${shardId}.xml`);
    const urls = extractLocs(shardRes.body).filter((u) => u.includes("/firma/"));
    const step = Math.max(1, Math.floor(urls.length / 17));
    for (let i = 0; i < urls.length && firmaUrls.length < 50; i += step) {
      firmaUrls.push(urls[i]);
    }
  }

  const samples = firmaUrls.slice(0, 50);
  console.log(`  Sampling ${samples.length} URLs...\n`);

  const liveStats = {
    tested: 0,
    titleLens: [],
    descLens: [],
    titleTooShort: 0,
    titleIdeal: 0,
    titleAcceptable: 0,
    titleLong: 0,
    titleTooLong: 0,
    descTooShort: 0,
    descIdeal: 0,
    descAcceptable: 0,
    descLong: 0,
    descTooLong: 0,
    noTitle: 0,
    noDesc: 0,
  };

  for (let i = 0; i < samples.length; i++) {
    const url = samples[i];
    process.stdout.write(`  [${i + 1}] ${url.slice(0, 60)}...`);

    try {
      const res = await fetchRaw(url);
      liveStats.tested++;

      const title = extractTitle(res.body);
      const desc = extractDescription(res.body);

      if (title) {
        liveStats.titleLens.push(title.length);
        if (title.length < 30) liveStats.titleTooShort++;
        else if (title.length <= 60) liveStats.titleIdeal++;
        else if (title.length <= 70) liveStats.titleAcceptable++;
        else if (title.length <= 80) liveStats.titleLong++;
        else liveStats.titleTooLong++;
      } else {
        liveStats.noTitle++;
      }

      if (desc) {
        liveStats.descLens.push(desc.length);
        if (desc.length < 120) liveStats.descTooShort++;
        else if (desc.length <= 160) liveStats.descIdeal++;
        else if (desc.length <= 180) liveStats.descAcceptable++;
        else if (desc.length <= 200) liveStats.descLong++;
        else liveStats.descTooLong++;
      } else {
        liveStats.noDesc++;
      }

      console.log(` title=${title?.length || 0} desc=${desc?.length || 0}`);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  // ── 4. Live sample statistics ───────────────────────────────────────
  console.log("\n── 4. Live Sample Statistics ──\n");

  const avgTitleLen = liveStats.titleLens.length > 0
    ? liveStats.titleLens.reduce((a, b) => a + b, 0) / liveStats.titleLens.length
    : 0;
  const avgDescLen = liveStats.descLens.length > 0
    ? liveStats.descLens.reduce((a, b) => a + b, 0) / liveStats.descLens.length
    : 0;

  console.log(`  Tested:              ${liveStats.tested}`);
  console.log(`  No title:            ${liveStats.noTitle}`);
  console.log(`  No description:      ${liveStats.noDesc}`);
  console.log();
  console.log("  Title length:");
  console.log(`    Too short (<30):   ${liveStats.titleTooShort}`);
  console.log(`    Ideal (30-60):     ${liveStats.titleIdeal} (${Math.round(liveStats.titleIdeal / liveStats.tested * 100)}%)`);
  console.log(`    Acceptable (61-70): ${liveStats.titleAcceptable} (${Math.round(liveStats.titleAcceptable / liveStats.tested * 100)}%)`);
  console.log(`    Long (71-80):      ${liveStats.titleLong}`);
  console.log(`    Too long (>80):    ${liveStats.titleTooLong}`);
  console.log(`    Avg length:        ${avgTitleLen.toFixed(1)} chars`);
  console.log();
  console.log("  Description length:");
  console.log(`    Too short (<120):  ${liveStats.descTooShort}`);
  console.log(`    Ideal (120-160):   ${liveStats.descIdeal} (${Math.round(liveStats.descIdeal / liveStats.tested * 100)}%)`);
  console.log(`    Acceptable (161-180): ${liveStats.descAcceptable} (${Math.round(liveStats.descAcceptable / liveStats.tested * 100)}%)`);
  console.log(`    Long (181-200):    ${liveStats.descLong}`);
  console.log(`    Too long (>200):   ${liveStats.descTooLong}`);
  console.log(`    Avg length:        ${avgDescLen.toFixed(1)} chars`);

  // ── 5. Summary ──────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  TITLE & DESCRIPTION ANALYSIS SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("  DB-based (all companies with FS):");
  console.log("  Title length distribution:");
  for (const r of titleDist) {
    const pct = (r.count / totalWithTitle * 100).toFixed(1);
    console.log(`    ${r.bucket.padEnd(20)} ${r.count.toLocaleString().padStart(8)} (${pct}%)  avg=${r.avgLen} max=${r.maxLen}`);
  }
  console.log();
  console.log("  Description length distribution:");
  for (const r of descDist) {
    const pct = (r.count / totalWithDesc * 100).toFixed(1);
    console.log(`    ${r.bucket.padEnd(20)} ${r.count.toLocaleString().padStart(8)} (${pct}%)  avg=${r.avgLen} max=${r.maxLen}`);
  }
  console.log();

  console.log("  Live sample (50 URLs):");
  console.log(`    Title:   ${liveStats.titleIdeal + liveStats.titleAcceptable}/${liveStats.tested} in range (${Math.round((liveStats.titleIdeal + liveStats.titleAcceptable) / liveStats.tested * 100)}%)`);
  console.log(`    Desc:    ${liveStats.descIdeal + liveStats.descAcceptable}/${liveStats.tested} in range (${Math.round((liveStats.descIdeal + liveStats.descAcceptable) / liveStats.tested * 100)}%)`);
  console.log();

  // Find the longest company names
  const longestNames = sshQuery(`
    SELECT name, LENGTH(name) as name_len
    FROM "Company"
    WHERE name IS NOT NULL
      AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = "Company".ico)
    ORDER BY name_len DESC
    LIMIT 10;
  `);

  console.log("  Top 10 longest company names (title will be too long):");
  for (const [name, len] of longestNames) {
    console.log(`    ${len.padStart(3)} chars: ${name.slice(0, 80)}`);
  }

  writeFileSync("/tmp/title-desc-analysis.json", JSON.stringify({
    titleDist,
    descDist,
    liveStats,
    avgTitleLen,
    avgDescLen,
  }, null, 2));
  console.log("\n  Full JSON report: /tmp/title-desc-analysis.json");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
