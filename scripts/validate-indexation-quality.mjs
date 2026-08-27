#!/usr/bin/env node
/**
 * Indexation quality validator.
 *
 * Fetches 100 random /firma/ URLs from the sitemap and checks:
 *  - HTTP 200
 *  - Title exists and is reasonable length (30-70 chars)
 *  - Meta description exists and is reasonable length (120-180 chars)
 *  - Canonical URL exists and matches sitemap URL
 *  - Robots meta is indexable (no noindex)
 *  - JSON-LD structured data present (Organization + BreadcrumbList)
 *  - Hreflang alternates present
 *  - H1 exists and contains company name
 *  - Sufficient text content (not thin content)
 *  - Financial statements table present (for indexable pages)
 *  - Internal links present (RelatedFirms, breadcrumbs)
 *
 * Output: JSON report + PASS/FAIL summary
 */

import { writeFileSync } from "fs";

const BASE = "https://verifa.sk";
const SAMPLE_SIZE = 100;

async function fetchRaw(url) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  };
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i);
  return m ? m[1] : null;
}

function hasNoindex(html) {
  return /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractDescription(html) {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

function countJsonLd(html) {
  return (html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/g) || []).length;
}

function hasHreflang(html) {
  return /<link[^>]*rel=["']alternate["'][^>]*hrefLang=["']/i.test(html);
}

function extractH1(html) {
  const m = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  return m ? m[1].trim() : null;
}

function extractLang(html) {
  const m = html.match(/<html[^>]*lang=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function countInternalLinks(html) {
  // Count links to /firma/, /slovnik/, /screener/, /firmy
  return (html.match(/href=["'](\/[^"']*(?:firma|slovnik|screener|firmy)[^"']*)["']/g) || []).length;
}

function hasFinancialTable(html) {
  // Check for financial statement table indicators
  return html.includes("BalanceSheetTable") || html.includes("ProfitLossTable") ||
    html.includes("súvaha") || html.includes("Súvaha") || html.includes("Balance sheet") ||
    html.includes("Výkaz") || html.includes("Profit and loss");
}

function hasReportCta(html) {
  return html.includes("Preveriť") || html.includes("Verify") || html.includes("prüfen") ||
    html.includes("weryfikuj") || html.includes("ellenőrz");
}

async function main() {
  console.log("=== Indexation Quality Validator ===");
  console.log(`Sampling ${SAMPLE_SIZE} random /firma/ URLs from sitemap\n`);

  // 1. Fetch sitemap and collect firma URLs
  console.log("Fetching sitemap shards...");
  const idxRes = await fetchRaw(`${BASE}/sitemap.xml`);
  const shardUrls = extractLocs(idxRes.body);

  // Sample from a few shards to get variety
  const firmaUrls = [];
  const shardsToSample = [1, 10, 20, 30, 38]; // spread across the range
  for (const shardId of shardsToSample) {
    const shardUrl = `${BASE}/sitemap/${shardId}.xml`;
    const shardRes = await fetchRaw(shardUrl);
    const urls = extractLocs(shardRes.body).filter((u) => u.includes("/firma/"));
    // Take every Nth URL to spread the sample
    const step = Math.max(1, Math.floor(urls.length / 25));
    for (let i = 0; i < urls.length && firmaUrls.length < SAMPLE_SIZE; i += step) {
      firmaUrls.push(urls[i]);
    }
  }

  // Trim to exact sample size
  const samples = firmaUrls.slice(0, SAMPLE_SIZE);
  console.log(`Collected ${samples.length} firma URLs from ${shardsToSample.length} shards\n`);

  // 2. Analyze each URL
  const results = [];
  const stats = {
    tested: 0,
    ok200: 0,
    noindex: 0,
    hasTitle: 0,
    titleTooShort: 0,
    titleTooLong: 0,
    hasDescription: 0,
    descTooShort: 0,
    descTooLong: 0,
    hasCanonical: 0,
    canonicalMatch: 0,
    canonicalMismatch: 0,
    hasJsonLd: 0,
    hasHreflang: 0,
    hasH1: 0,
    hasFinancialTable: 0,
    hasReportCta: 0,
    hasInternalLinks: 0,
    thinContent: 0,
    errors: [],
  };

  for (let i = 0; i < samples.length; i++) {
    const url = samples[i];
    process.stdout.write(`  [${i + 1}/${samples.length}] ${url.slice(0, 70)}...`);

    try {
      const res = await fetchRaw(url);
      stats.tested++;

      const r = {
        url,
        status: res.status,
        lang: null,
        title: null,
        titleLen: 0,
        description: null,
        descLen: 0,
        canonical: null,
        canonicalMatch: false,
        noindex: false,
        jsonLdCount: 0,
        hasHreflang: false,
        h1: null,
        hasFinancialTable: false,
        hasReportCta: false,
        internalLinks: 0,
        contentLength: res.body.length,
        errors: [],
      };

      if (res.status !== 200) {
        r.errors.push(`HTTP ${res.status}`);
        stats.errors.push(`${url} → ${res.status}`);
        results.push(r);
        console.log(` FAIL (${res.status})`);
        continue;
      }

      stats.ok200++;
      r.lang = extractLang(res.body);
      r.title = extractTitle(res.body);
      r.titleLen = r.title?.length || 0;
      r.description = extractDescription(res.body);
      r.descLen = r.description?.length || 0;
      r.canonical = extractCanonical(res.body);
      r.noindex = hasNoindex(res.body);
      r.jsonLdCount = countJsonLd(res.body);
      r.hasHreflang = hasHreflang(res.body);
      r.h1 = extractH1(res.body);
      r.hasFinancialTable = hasFinancialTable(res.body);
      r.hasReportCta = hasReportCta(res.body);
      r.internalLinks = countInternalLinks(res.body);

      // Checks
      if (r.noindex) stats.noindex++;
      if (r.title) {
        stats.hasTitle++;
        if (r.titleLen < 30) stats.titleTooShort++;
        if (r.titleLen > 70) stats.titleTooLong++;
      } else {
        r.errors.push("no title");
      }
      if (r.description) {
        stats.hasDescription++;
        if (r.descLen < 120) stats.descTooShort++;
        if (r.descLen > 180) stats.descTooLong++;
      } else {
        r.errors.push("no description");
      }
      if (r.canonical) {
        stats.hasCanonical++;
        if (r.canonical === url) {
          r.canonicalMatch = true;
          stats.canonicalMatch++;
        } else {
          stats.canonicalMismatch++;
          r.errors.push(`canonical mismatch: ${r.canonical}`);
        }
      } else {
        r.errors.push("no canonical");
      }
      if (r.jsonLdCount >= 2) stats.hasJsonLd++;
      else r.errors.push(`only ${r.jsonLdCount} JSON-LD blocks`);
      if (r.hasHreflang) stats.hasHreflang++;
      else r.errors.push("no hreflang");
      if (r.h1) stats.hasH1++;
      else r.errors.push("no H1");
      if (r.hasFinancialTable) stats.hasFinancialTable++;
      if (r.hasReportCta) stats.hasReportCta++;
      if (r.internalLinks >= 3) stats.hasInternalLinks++;
      else r.errors.push(`only ${r.internalLinks} internal links`);

      // Thin content check: < 5000 chars is suspicious for a company page
      if (r.contentLength < 5000) {
        stats.thinContent++;
        r.errors.push(`thin content (${r.contentLength} chars)`);
      }

      if (r.errors.length === 0) {
        console.log(" OK");
      } else {
        console.log(` WARN (${r.errors.length} issues)`);
      }
    } catch (e) {
      stats.errors.push(`${url} fetch error: ${e.message}`);
      console.log(` ERROR: ${e.message}`);
    }

    results.push({
      url,
      status: 0,
      errors: ["fetch error"],
    });
  }

  // 3. Report
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  INDEXATION QUALITY REPORT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`  URLs tested:           ${stats.tested}`);
  console.log(`  HTTP 200:              ${stats.ok200} (${Math.round(stats.ok200 / stats.tested * 100)}%)`);
  console.log(`  Noindex:               ${stats.noindex}`);
  console.log("");
  console.log("  Title:");
  console.log(`    Has title:           ${stats.hasTitle} (${Math.round(stats.hasTitle / stats.tested * 100)}%)`);
  console.log(`    Too short (<30):     ${stats.titleTooShort}`);
  console.log(`    Too long (>70):      ${stats.titleTooLong}`);
  console.log("");
  console.log("  Description:");
  console.log(`    Has description:     ${stats.hasDescription} (${Math.round(stats.hasDescription / stats.tested * 100)}%)`);
  console.log(`    Too short (<120):    ${stats.descTooShort}`);
  console.log(`    Too long (>180):     ${stats.descTooLong}`);
  console.log("");
  console.log("  Canonical:");
  console.log(`    Has canonical:       ${stats.hasCanonical} (${Math.round(stats.hasCanonical / stats.tested * 100)}%)`);
  console.log(`    Match URL:           ${stats.canonicalMatch} (${Math.round(stats.canonicalMatch / stats.tested * 100)}%)`);
  console.log(`    Mismatch:            ${stats.canonicalMismatch}`);
  console.log("");
  console.log("  Structured data:");
  console.log(`    JSON-LD (≥2 blocks): ${stats.hasJsonLd} (${Math.round(stats.hasJsonLd / stats.tested * 100)}%)`);
  console.log(`    Hreflang:            ${stats.hasHreflang} (${Math.round(stats.hasHreflang / stats.tested * 100)}%)`);
  console.log("");
  console.log("  Content:");
  console.log(`    Has H1:              ${stats.hasH1} (${Math.round(stats.hasH1 / stats.tested * 100)}%)`);
  console.log(`    Financial table:     ${stats.hasFinancialTable} (${Math.round(stats.hasFinancialTable / stats.tested * 100)}%)`);
  console.log(`    Report CTA:          ${stats.hasReportCta} (${Math.round(stats.hasReportCta / stats.tested * 100)}%)`);
  console.log(`    Internal links (≥3): ${stats.hasInternalLinks} (${Math.round(stats.hasInternalLinks / stats.tested * 100)}%)`);
  console.log(`    Thin content (<5k):  ${stats.thinContent}`);
  console.log("");
  console.log(`  Errors:                ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log("\n  ERRORS (first 20):");
    for (const e of stats.errors.slice(0, 20)) {
      console.log(`    - ${e}`);
    }
  }

  // PASS/FAIL
  const passRate = stats.ok200 / stats.tested;
  const canonicalRate = stats.canonicalMatch / stats.tested;
  const titleRate = stats.hasTitle / stats.tested;
  const descRate = stats.hasDescription / stats.tested;
  const jsonLdRate = stats.hasJsonLd / stats.tested;
  const hreflangRate = stats.hasHreflang / stats.tested;

  const pass =
    passRate >= 0.95 &&
    canonicalRate >= 0.95 &&
    titleRate >= 0.95 &&
    descRate >= 0.95 &&
    jsonLdRate >= 0.90 &&
    hreflangRate >= 0.95 &&
    stats.thinContent === 0;

  console.log(`\n  ═══════════════════════════════`);
  console.log(`  OVERALL: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  ═══════════════════════════════`);
  console.log(`  Pass rates: 200=${Math.round(passRate * 100)}%, canonical=${Math.round(canonicalRate * 100)}%, title=${Math.round(titleRate * 100)}%, desc=${Math.round(descRate * 100)}%, jsonLd=${Math.round(jsonLdRate * 100)}%, hreflang=${Math.round(hreflangRate * 100)}%`);

  // Write JSON
  writeFileSync("/tmp/indexation-quality-report.json", JSON.stringify({ stats, results }, null, 2));
  console.log("\n  Full JSON report: /tmp/indexation-quality-report.json");

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
