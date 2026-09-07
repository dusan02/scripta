#!/usr/bin/env node
/**
 * Verifa.sk — Weekly SEO Snapshot
 *
 * Captures GSC metrics into a structured JSON snapshot for trend tracking.
 * Run weekly. Store snapshots in docs/seo-snapshots/.
 *
 * Usage:
 *   GSC_SERVICE_ACCOUNT_FILE=/path/to/key.json node scripts/seo-snapshot.mjs
 *
 * Without GSC API (manual mode — prints template for manual data entry):
 *   node scripts/seo-snapshot.mjs --manual
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const SITE_URL = "https://verifa.sk";

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function snapshotFilename() {
  const now = new Date();
  const week = getWeekNumber(now);
  return `snapshot-${now.getFullYear()}-W${String(week).padStart(2, "0")}.json`;
}

async function main() {
  const manual = process.argv.includes("--manual");
  const date = new Date().toISOString().slice(0, 10);
  const week = getWeekNumber(new Date());

  console.log(`=== Verifa.sk SEO Weekly Snapshot ===`);
  console.log(`Date: ${date} (Week ${week})\n`);

  if (manual) {
    const template = {
      date,
      week,
      source: "manual",
      gsc: {
        indexed: null,
        notIndexed: null,
        impressionsAvg: null,
        clicksTotal: null,
        ctr: null,
        avgPosition: null,
        sitemapSubmitted: 278000,
        sitemapProcessed: null,
        redirectPages: null,
        robotsBlocked: null,
        noindexExcluded: null,
        canonicalIssues: null,
        crawledNotIndexed: null,
        errors404: null,
        errors5xx: null,
      },
      urlFamilyBreakdown: {
        firmyNace: { indexed: null, impressions: null, clicks: null },
        firmyNaceRegion: { indexed: null, impressions: null, clicks: null },
        firmyNaceCity: { indexed: null, impressions: null, clicks: null },
        firma: { indexed: null, impressions: null, clicks: null },
        kraj: { indexed: null, impressions: null, clicks: null },
        okres: { indexed: null, impressions: null, clicks: null },
        mesto: { indexed: null, impressions: null, clicks: null },
        slovnik: { indexed: null, impressions: null, clicks: null },
        screener: { indexed: null, impressions: null, clicks: null },
        odvetvieLegacy: { indexed: null, impressions: null, clicks: null },
      },
      topQueries: [],
      topPages: [],
      notes: "",
    };

    const filename = snapshotFilename();
    const outPath = path.join(__dirname, "..", "docs", "seo-snapshots", filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(template, null, 2));
    console.log(`Template written to: ${outPath}`);
    console.log(`\nFill in the values from GSC and re-run to compare.`);
    console.log(`\nFields to fill from GSC:`);
    console.log(`  1. Indexing → Pages → indexed / not indexed counts`);
    console.log(`  2. Performance → Search results → impressions, clicks, CTR, position`);
    console.log(`  3. Sitemaps → processed URLs count`);
    console.log(`  4. Performance → filter by URL prefix for family breakdown`);
    console.log(`  5. Performance → Queries tab for top queries`);
    console.log(`  6. Performance → Pages tab for top pages`);
    return;
  }

  const serviceAccountFile = process.env.GSC_SERVICE_ACCOUNT_FILE;
  if (!serviceAccountFile) {
    console.error("ERROR: Set GSC_SERVICE_ACCOUNT_FILE env var or use --manual");
    process.exit(1);
  }

  // ... automated GSC API fetching would go here
  // For now, use --manual mode
  console.error("Automated mode not yet implemented. Use --manual for now.");
  console.error("Run: node scripts/seo-snapshot.mjs --manual");
  process.exit(1);
}

main();
