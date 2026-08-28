#!/usr/bin/env node
/**
 * GSC (Google Search Console) Monitoring Script
 *
 * Fetches real data from Google Search Console API for verifa.sk.
 * Reports: indexing status, search performance, coverage issues, sitemap status.
 *
 * Requirements:
 *   - Google service account JSON key with Search Console API access
 *   - Service account email added as property user in GSC
 *   - Env vars:
 *     GSC_SERVICE_ACCOUNT_FILE — path to service account JSON
 *     GSC_PROPERTY_URL — e.g. "https://verifa.sk/" (must match GSC property)
 *
 * Usage:
 *   node scripts/gsc-monitor.mjs                    # Full report
 *   node scripts/gsc-monitor.mjs --json             # JSON output
 *   node scripts/gsc-monitor.mjs --section=indexing # Specific section
 *
 * No fake data — all metrics come from the live GSC API.
 */

import { google } from "googleapis";
import { readFileSync } from "fs";

const PROPERTY_URL = process.env.GSC_PROPERTY_URL || "https://verifa.sk/";
const KEY_FILE = process.env.GSC_SERVICE_ACCOUNT_FILE;

if (!KEY_FILE) {
  console.error("Error: GSC_SERVICE_ACCOUNT_FILE env var not set.");
  console.error("Set it to the path of your Google service account JSON key file.");
  console.error("");
  console.error("Setup:");
  console.error("  1. Create a service account in Google Cloud Console");
  console.error("  2. Enable Search Console API");
  console.error("  3. Download JSON key");
  console.error("  4. Add service account email as user in GSC property settings");
  console.error("  5. Export GSC_SERVICE_ACCOUNT_FILE=/path/to/key.json");
  process.exit(1);
}

// Initialize auth
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ["https://www.googleapis.com/auth/webmasters"],
});

const searchconsole = google.searchconsole("v1");

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

function getLastNDays(n) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - n);
  return { start: formatDate(start), end: formatDate(end) };
}

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Reports ──────────────────────────────────────────────────────────

/** Search performance — clicks, impressions, CTR, position */
async function searchPerformance() {
  const { start, end } = getLastNDays(28);
  const res = await searchconsole.searchanalytics.query({
    siteUrl: PROPERTY_URL,
    requestBody: {
      startDate: start,
      endDate: end,
      dimensions: [],
      rowLimit: 1,
    },
  });

  const row = res.data.rows?.[0];
  if (!row) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0, period: `${start}..${end}` };
  }

  return {
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: parseFloat((row.ctr * 100).toFixed(2)),
    position: parseFloat(row.position.toFixed(1)),
    period: `${start}..${end}`,
  };
}

/** Search performance by page — top pages */
async function topPages(limit = 20) {
  const { start, end } = getLastNDays(28);
  const res = await searchconsole.searchanalytics.query({
    siteUrl: PROPERTY_URL,
    requestBody: {
      startDate: start,
      endDate: end,
      dimensions: ["page"],
      rowLimit: limit,
    },
  });

  return (res.data.rows || []).map((r) => ({
    url: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: parseFloat((r.ctr * 100).toFixed(2)),
    position: parseFloat(r.position.toFixed(1)),
  }));
}

/** Search performance by query — top queries */
async function topQueries(limit = 30) {
  const { start, end } = getLastNDays(28);
  const res = await searchconsole.searchanalytics.query({
    siteUrl: PROPERTY_URL,
    requestBody: {
      startDate: start,
      endDate: end,
      dimensions: ["query"],
      rowLimit: limit,
    },
  });

  return (res.data.rows || []).map((r) => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: parseFloat((r.ctr * 100).toFixed(2)),
    position: parseFloat(r.position.toFixed(1)),
  }));
}

/** URL inspection — check indexing status for a specific URL */
async function inspectUrl(url) {
  try {
    const res = await searchconsole.urlInspection.index.inspect({
      siteUrl: PROPERTY_URL,
      requestBody: { inspectionUrl: url, languageCode: "sk" },
    });
    const d = res.data.inspectionResult;
    return {
      url,
      verdict: d.indexStatusResult?.verdict,
      coverageState: d.indexStatusResult?.coverageState,
      robotsTxtState: d.indexStatusResult?.robotsTxtState,
      indexingState: d.indexStatusResult?.indexingState,
      lastCrawlTime: d.indexStatusResult?.lastCrawlTime,
      googleCanonical: d.indexStatusResult?.googleCanonical,
      userCanonical: d.indexStatusResult?.userCanonical,
      sitemap: d.indexStatusResult?.sitemap,
      crawledAs: d.indexStatusResult?.crawledAs,
      pageFetchState: d.indexStatusResult?.pageFetchState,
    };
  } catch (err) {
    return { url, error: err.message };
  }
}

/** Sitemap status — list submitted sitemaps and their status */
async function sitemapStatus() {
  const res = await searchconsole.sitemaps.list({ siteUrl: PROPERTY_URL });
  return (res.data.sitemap || []).map((s) => ({
    path: s.path,
    lastSubmitted: s.lastSubmitted,
    lastDownloaded: s.lastDownloaded,
    status: s.status,
    errors: s.errors,
    warnings: s.warnings,
    indexed: s.contents?.filter((c) => c.type === "web").map((c) => c.indexed).reduce((a, b) => a + b, 0),
    submitted: s.contents?.filter((c) => c.type === "web").map((c) => c.submitted).reduce((a, b) => a + b, 0),
  }));
}

/** Submit sitemap to GSC */
async function submitSitemap(sitemapPath) {
  try {
    await searchconsole.sitemaps.submit({ siteUrl: PROPERTY_URL, feedpath: sitemapPath });
    return { success: true, path: sitemapPath };
  } catch (err) {
    return { success: false, path: sitemapPath, error: err.message };
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const sectionArg = args.find((a) => a.startsWith("--section="));
  const section = sectionArg ? sectionArg.split("=")[1] : null;

  const report = {};

  if (!section || section === "performance") {
    console.error("Fetching search performance (last 28 days)...");
    report.performance = await searchPerformance();
  }

  if (!section || section === "pages") {
    console.error("Fetching top pages...");
    report.topPages = await topPages(20);
  }

  if (!section || section === "queries") {
    console.error("Fetching top queries...");
    report.topQueries = await topQueries(30);
  }

  if (!section || section === "sitemaps") {
    console.error("Fetching sitemap status...");
    report.sitemaps = await sitemapStatus();
  }

  if (section === "inspect") {
    const urlArg = args.find((a) => a.startsWith("--url="));
    if (!urlArg) {
      console.error("Usage: --section=inspect --url=https://verifa.sk/odvetvie/C");
      process.exit(1);
    }
    const url = urlArg.split("=")[1];
    console.error(`Inspecting ${url}...`);
    report.inspection = await inspectUrl(url);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    // Human-readable report
    if (report.performance) {
      const p = report.performance;
      console.log("\n═══ SEARCH PERFORMANCE (28 days) ═══");
      console.log(`  Period:       ${p.period}`);
      console.log(`  Clicks:       ${formatNumber(p.clicks)}`);
      console.log(`  Impressions:  ${formatNumber(p.impressions)}`);
      console.log(`  CTR:          ${p.ctr}%`);
      console.log(`  Avg position: ${p.position}`);
    }

    if (report.topPages) {
      console.log("\n═══ TOP PAGES (28 days) ═══");
      console.log("  Clicks  Impr.    CTR   Pos.  URL");
      for (const p of report.topPages.slice(0, 15)) {
        console.log(
          `  ${String(p.clicks).padStart(5)}  ${String(p.impressions).padStart(7)}  ${String(p.ctr).padStart(5)}%  ${String(p.position).padStart(4)}  ${p.url.replace("https://verifa.sk", "")}`
        );
      }
    }

    if (report.topQueries) {
      console.log("\n═══ TOP QUERIES (28 days) ═══");
      console.log("  Clicks  Impr.    CTR   Pos.  Query");
      for (const q of report.topQueries.slice(0, 15)) {
        console.log(
          `  ${String(q.clicks).padStart(5)}  ${String(q.impressions).padStart(7)}  ${String(q.ctr).padStart(5)}%  ${String(q.position).padStart(4)}  ${q.query}`
        );
      }
    }

    if (report.sitemaps) {
      console.log("\n═══ SITEMAP STATUS ═══");
      console.log("  Status   Errors  Warn.  Submitted  Indexed  Path");
      for (const s of report.sitemaps) {
        console.log(
          `  ${String(s.status).padEnd(8)} ${String(s.errors || 0).padStart(6)}  ${String(s.warnings || 0).padStart(5)}  ${String(s.submitted || "—").padStart(9)}  ${String(s.indexed || "—").padStart(7)}  ${s.path}`
        );
      }
    }

    if (report.inspection) {
      const i = report.inspection;
      console.log("\n═══ URL INSPECTION ═══");
      console.log(`  URL:             ${i.url}`);
      if (i.error) {
        console.log(`  Error:            ${i.error}`);
      } else {
        console.log(`  Verdict:          ${i.verdict}`);
        console.log(`  Coverage state:   ${i.coverageState}`);
        console.log(`  Robots.txt:       ${i.robotsTxtState}`);
        console.log(`  Indexing state:   ${i.indexingState}`);
        console.log(`  Last crawl:       ${i.lastCrawlTime}`);
        console.log(`  Google canonical: ${i.googleCanonical}`);
        console.log(`  User canonical:   ${i.userCanonical}`);
        console.log(`  Sitemap:          ${i.sitemap}`);
        console.log(`  Crawled as:       ${i.crawledAs}`);
        console.log(`  Page fetch:       ${i.pageFetchState}`);
      }
    }

    console.log("");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
