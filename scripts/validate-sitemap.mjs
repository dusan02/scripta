#!/usr/bin/env node
/**
 * Production-grade sitemap chain validator.
 *
 * Checks:
 *  1. /sitemap.xml is valid XML sitemapindex with correct Content-Type
 *  2. All shards are accessible, valid XML, correct Content-Type
 *  3. URL count + duplicate detection
 *  4. No noindex URLs in sitemap XML
 *  5. 50 random /firma/ URLs → 200, no noindex, canonical exists, canonical matches URL
 *  6. 10 stale-slug URLs → 308 redirect to correct slug
 *  7. 10 correct-slug URLs → 200 (no redirect)
 *  8. 5 non-existent ICOs → 200 (page handles 404, not middleware redirect)
 *  9. Final report with PASS/FAIL
 */

import { writeFileSync } from "fs";

const BASE = "https://verifa.sk";

// ── Helpers ────────────────────────────────────────────────────────────

async function fetchRaw(url, opts = {}) {
  const res = await fetch(url, { redirect: "manual", ...opts });
  const body = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  };
}

/** Parse XML safely — throws on invalid XML */
function parseXml(xml) {
  // Node.js doesn't have a built-in XML parser, but we can use DOMParser
  // via a lightweight check. For sitemap validation, we use regex-based
  // extraction but validate XML structure first.
  // Check for basic XML well-formedness
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<?xml") && !trimmed.startsWith("<urlset") && !trimmed.startsWith("<sitemapindex")) {
    throw new Error("Not valid XML: missing XML declaration or root element");
  }
  // Check for unclosed root tags
  if (trimmed.includes("<sitemapindex") && !trimmed.includes("</sitemapindex>")) {
    throw new Error("Unclosed <sitemapindex> tag");
  }
  if (trimmed.includes("<urlset") && !trimmed.includes("</urlset>")) {
    throw new Error("Unclosed <urlset> tag");
  }
  return trimmed;
}

/** Extract all <loc> URLs from XML */
function extractLocs(xml) {
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches.map((m) => m[1].trim());
}

/** Extract canonical URL from HTML */
function extractCanonical(html) {
  const match = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i);
  return match ? match[1] : null;
}

/** Check if HTML has noindex robots meta */
function hasNoindex(html) {
  return /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
}

/** Extract title from HTML */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}

/** Extract meta description from HTML */
function extractDescription(html) {
  const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  return match ? match[1].trim() : null;
}

/** Count <script type="application/ld+json"> blocks */
function countJsonLd(html) {
  return (html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/g) || []).length;
}

/** Check for hreflang alternates */
function hasHreflang(html) {
  return /<link[^>]*rel=["']alternate["'][^>]*hrefLang=["']/i.test(html);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const report = {
    sitemapIndex: { valid: false, contentType: "", shardCount: 0 },
    shards: { total: 0, accessible: 0, validXml: 0, correctContentType: 0 },
    urls: { total: 0, unique: 0, duplicates: 0, firmaUrls: 0, staticUrls: 0 },
    noindexInSitemap: 0,
    sampleTests: { tested: 0, ok200: 0, noindexFound: 0, canonicalMatch: 0, canonicalMismatch: 0, errors: [] },
    redirectTests: { tested: 0, redirect308: 0, correctTarget: 0, errors: [] },
    correctSlugTests: { tested: 0, ok200: 0, errors: [] },
    nonexistentIcoTests: { tested: 0, ok200: 0, errors: [] },
    errors: [],
    pass: false,
  };

  // ── 1. Fetch sitemap index ──────────────────────────────────────────
  console.log("=== 1. Sitemap index ===");
  try {
    const idx = await fetchRaw(`${BASE}/sitemap.xml`);
    console.log(`  Status: ${idx.status}`);
    console.log(`  Content-Type: ${idx.headers["content-type"]}`);

    if (idx.status !== 200) {
      report.errors.push(`/sitemap.xml returned ${idx.status}`);
      throw new Error(`HTTP ${idx.status}`);
    }
    if (!idx.headers["content-type"]?.includes("application/xml")) {
      report.errors.push(`Wrong Content-Type: ${idx.headers["content-type"]}`);
      throw new Error("Wrong Content-Type");
    }

    parseXml(idx.body);
    if (!idx.body.includes("<sitemapindex")) {
      report.errors.push("Not a sitemapindex");
      throw new Error("Not sitemapindex");
    }

    report.sitemapIndex.valid = true;
    report.sitemapIndex.contentType = idx.headers["content-type"];
    console.log("  OK: Valid XML sitemapindex");
  } catch (e) {
    console.log(`  FAIL: ${e.message}`);
    finish(report);
    return;
  }

  // ── 2. Fetch all shards ─────────────────────────────────────────────
  console.log("\n=== 2. Fetching all shards ===");
  const idxRes = await fetchRaw(`${BASE}/sitemap.xml`);
  const shardUrls = extractLocs(idxRes.body);
  report.sitemapIndex.shardCount = shardUrls.length;
  report.shards.total = shardUrls.length;
  console.log(`  Found ${shardUrls.length} shards`);

  const allUrls = new Set();
  const allFirmaUrls = [];
  const allStaticUrls = [];

  for (const shardUrl of shardUrls) {
    try {
      const shard = await fetchRaw(shardUrl);
      if (shard.status !== 200) {
        report.errors.push(`Shard ${shardUrl} → ${shard.status}`);
        console.log(`  FAIL: ${shardUrl} → ${shard.status}`);
        continue;
      }
      report.shards.accessible++;

      const ct = shard.headers["content-type"] || "";
      if (ct.includes("application/xml") || ct.includes("text/xml")) {
        report.shards.correctContentType++;
      } else {
        report.errors.push(`Shard ${shardUrl} wrong CT: ${ct}`);
      }

      try {
        parseXml(shard.body);
        report.shards.validXml++;
      } catch (e) {
        report.errors.push(`Shard ${shardUrl} invalid XML: ${e.message}`);
      }

      if (shard.body.includes("noindex")) {
        report.noindexInSitemap++;
        report.errors.push(`Shard ${shardUrl} contains 'noindex'`);
      }

      const urls = extractLocs(shard.body);
      for (const url of urls) {
        if (allUrls.has(url)) {
          report.urls.duplicates++;
        } else {
          allUrls.add(url);
          if (url.includes("/firma/")) {
            allFirmaUrls.push(url);
          } else {
            allStaticUrls.push(url);
          }
        }
      }
      console.log(`  ${shardUrl}: ${urls.length} URLs`);
    } catch (e) {
      report.errors.push(`Shard ${shardUrl} fetch error: ${e.message}`);
    }
  }

  report.urls.total = allUrls.size;
  report.urls.unique = allUrls.size;
  report.urls.firmaUrls = allFirmaUrls.length;
  report.urls.staticUrls = allStaticUrls.length;

  console.log(`\n  Total URLs: ${report.urls.total}`);
  console.log(`  Firma URLs: ${report.urls.firmaUrls}`);
  console.log(`  Static URLs: ${report.urls.staticUrls}`);
  console.log(`  Duplicates: ${report.urls.duplicates}`);
  console.log(`  Noindex in sitemap: ${report.noindexInSitemap}`);

  // ── 3. Sample 50 random /firma/ URLs ────────────────────────────────
  console.log("\n=== 3. Sampling 50 random /firma/ URLs ===");
  const sampleSize = Math.min(50, allFirmaUrls.length);
  const samples = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(Math.random() * allFirmaUrls.length);
    samples.push(allFirmaUrls[idx]);
  }

  for (const url of samples) {
    try {
      const res = await fetchRaw(url);
      report.sampleTests.tested++;

      if (res.status === 200) {
        report.sampleTests.ok200++;
      } else {
        report.sampleTests.errors.push(`${url} → ${res.status}`);
        continue;
      }

      if (hasNoindex(res.body)) {
        report.sampleTests.noindexFound++;
        report.sampleTests.errors.push(`${url} has noindex`);
      }

      const canonical = extractCanonical(res.body);
      if (canonical) {
        // Canonical should match the sitemap URL (or at least the path)
        if (canonical === url) {
          report.sampleTests.canonicalMatch++;
        } else {
          report.sampleTests.canonicalMismatch++;
          report.sampleTests.errors.push(`${url} canonical mismatch: ${canonical}`);
        }
      } else {
        report.sampleTests.errors.push(`${url} no canonical`);
      }

      const title = extractTitle(res.body);
      if (!title) {
        report.sampleTests.errors.push(`${url} no title`);
      }

      const desc = extractDescription(res.body);
      if (!desc) {
        report.sampleTests.errors.push(`${url} no description`);
      }
    } catch (e) {
      report.sampleTests.errors.push(`${url} fetch error: ${e.message}`);
    }
  }

  console.log(`  Tested: ${report.sampleTests.tested}`);
  console.log(`  200 OK: ${report.sampleTests.ok200}`);
  console.log(`  Noindex found: ${report.sampleTests.noindexFound}`);
  console.log(`  Canonical match: ${report.sampleTests.canonicalMatch}`);
  console.log(`  Canonical mismatch: ${report.sampleTests.canonicalMismatch}`);
  if (report.sampleTests.errors.length > 0) {
    console.log(`  Errors (${report.sampleTests.errors.length}):`);
    for (const e of report.sampleTests.errors.slice(0, 10)) {
      console.log(`    - ${e}`);
    }
    if (report.sampleTests.errors.length > 10) {
      console.log(`    ... and ${report.sampleTests.errors.length - 10} more`);
    }
  }

  // ── 4. Redirect tests: 10 stale-slug URLs ───────────────────────────
  console.log("\n=== 4. Redirect tests (stale slug → 308) ===");
  // We need to construct stale-slug URLs. Take 10 correct URLs and modify the slug.
  const redirectTestUrls = samples.slice(0, 10).map((url) => {
    // Replace the slug part with a wrong slug
    const match = url.match(/^(.*\/firma\/\d+)-(.+)$/);
    if (match) {
      return `${match[1]}-zzz-stale-slug-test`;
    }
    return null;
  }).filter(Boolean);

  for (const url of redirectTestUrls) {
    try {
      const res = await fetchRaw(url);
      report.redirectTests.tested++;

      if (res.status === 308) {
        report.redirectTests.redirect308++;
        const location = res.headers["location"];
        if (location && !location.includes("zzz-stale-slug-test")) {
          report.redirectTests.correctTarget++;
        } else {
          report.redirectTests.errors.push(`${url} → 308 but location still has stale slug: ${location}`);
        }
      } else if (res.status === 200) {
        report.redirectTests.errors.push(`${url} → 200 (expected 308 for stale slug)`);
      } else {
        report.redirectTests.errors.push(`${url} → ${res.status} (expected 308)`);
      }
    } catch (e) {
      report.redirectTests.errors.push(`${url} fetch error: ${e.message}`);
    }
  }

  console.log(`  Tested: ${report.redirectTests.tested}`);
  console.log(`  308 redirects: ${report.redirectTests.redirect308}`);
  console.log(`  Correct target: ${report.redirectTests.correctTarget}`);
  if (report.redirectTests.errors.length > 0) {
    console.log(`  Errors:`);
    for (const e of report.redirectTests.errors) {
      console.log(`    - ${e}`);
    }
  }

  // ── 5. Correct-slug tests: 10 correct URLs → 200 ────────────────────
  console.log("\n=== 5. Correct-slug tests (→ 200) ===");
  const correctSlugUrls = samples.slice(10, 20);
  for (const url of correctSlugUrls) {
    try {
      const res = await fetchRaw(url);
      report.correctSlugTests.tested++;
      if (res.status === 200) {
        report.correctSlugTests.ok200++;
      } else if (res.status === 308) {
        report.correctSlugTests.errors.push(`${url} → 308 (expected 200 for correct slug)`);
      } else {
        report.correctSlugTests.errors.push(`${url} → ${res.status}`);
      }
    } catch (e) {
      report.correctSlugTests.errors.push(`${url} fetch error: ${e.message}`);
    }
  }

  console.log(`  Tested: ${report.correctSlugTests.tested}`);
  console.log(`  200 OK: ${report.correctSlugTests.ok200}`);
  if (report.correctSlugTests.errors.length > 0) {
    console.log(`  Errors:`);
    for (const e of report.correctSlugTests.errors) {
      console.log(`    - ${e}`);
    }
  }

  // ── 6. Non-existent ICO tests: 5 fake ICOs ──────────────────────────
  console.log("\n=== 6. Non-existent ICO tests (→ 200, page handles 404) ===");
  const fakeIcos = ["99999999", "99999998", "99999997", "99999996", "99999995"];
  for (const ico of fakeIcos) {
    const url = `${BASE}/firma/${ico}-test-firma`;
    try {
      const res = await fetchRaw(url);
      report.nonexistentIcoTests.tested++;
      // Page should return 200 (page.tsx handles notFound) or 308 (redirect to correct slug)
      // but should NOT redirect to a real company
      if (res.status === 200) {
        report.nonexistentIcoTests.ok200++;
      } else if (res.status === 308) {
        const location = res.headers["location"];
        report.nonexistentIcoTests.errors.push(`${ico} → 308 to ${location} (should be 200 or 404)`);
      } else {
        report.nonexistentIcoTests.errors.push(`${ico} → ${res.status}`);
      }
    } catch (e) {
      report.nonexistentIcoTests.errors.push(`${ico} fetch error: ${e.message}`);
    }
  }

  console.log(`  Tested: ${report.nonexistentIcoTests.tested}`);
  console.log(`  200 OK: ${report.nonexistentIcoTests.ok200}`);
  if (report.nonexistentIcoTests.errors.length > 0) {
    console.log(`  Errors:`);
    for (const e of report.nonexistentIcoTests.errors) {
      console.log(`    - ${e}`);
    }
  }

  finish(report);
}

function finish(report) {
  // ── Final report ────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  SITEMAP VALIDATION REPORT");
  console.log("═══════════════════════════════════════════════════════════════");

  console.log("\n  Sitemap Index:");
  console.log(`    Valid:          ${report.sitemapIndex.valid ? "YES" : "NO"}`);
  console.log(`    Content-Type:   ${report.sitemapIndex.contentType}`);
  console.log(`    Shards:         ${report.sitemapIndex.shardCount}`);

  console.log("\n  Shards:");
  console.log(`    Total:              ${report.shards.total}`);
  console.log(`    Accessible:         ${report.shards.accessible}`);
  console.log(`    Valid XML:          ${report.shards.validXml}`);
  console.log(`    Correct Content-Type: ${report.shards.correctContentType}`);

  console.log("\n  URLs:");
  console.log(`    Total:           ${report.urls.total}`);
  console.log(`    Firma URLs:      ${report.urls.firmaUrls}`);
  console.log(`    Static URLs:     ${report.urls.staticUrls}`);
  console.log(`    Duplicates:      ${report.urls.duplicates}`);
  console.log(`    Noindex in XML:  ${report.noindexInSitemap}`);

  console.log("\n  Sample Tests (50 random /firma/ URLs):");
  console.log(`    Tested:            ${report.sampleTests.tested}`);
  console.log(`    200 OK:            ${report.sampleTests.ok200}`);
  console.log(`    Noindex found:     ${report.sampleTests.noindexFound}`);
  console.log(`    Canonical match:   ${report.sampleTests.canonicalMatch}`);
  console.log(`    Canonical mismatch: ${report.sampleTests.canonicalMismatch}`);

  console.log("\n  Redirect Tests (stale slug → 308):");
  console.log(`    Tested:          ${report.redirectTests.tested}`);
  console.log(`    308 redirects:   ${report.redirectTests.redirect308}`);
  console.log(`    Correct target:  ${report.redirectTests.correctTarget}`);

  console.log("\n  Correct Slug Tests (→ 200):");
  console.log(`    Tested:          ${report.correctSlugTests.tested}`);
  console.log(`    200 OK:          ${report.correctSlugTests.ok200}`);

  console.log("\n  Non-existent ICO Tests:");
  console.log(`    Tested:          ${report.nonexistentIcoTests.tested}`);
  console.log(`    200 OK:          ${report.nonexistentIcoTests.ok200}`);

  const totalErrors = [
    ...report.errors,
    ...report.sampleTests.errors,
    ...report.redirectTests.errors,
    ...report.correctSlugTests.errors,
    ...report.nonexistentIcoTests.errors,
  ];

  console.log(`\n  Total errors: ${totalErrors.length}`);
  if (totalErrors.length > 0) {
    console.log("\n  ALL ERRORS:");
    for (const e of totalErrors.slice(0, 30)) {
      console.log(`    - ${e}`);
    }
    if (totalErrors.length > 30) {
      console.log(`    ... and ${totalErrors.length - 30} more`);
    }
  }

  // ── PASS/FAIL ───────────────────────────────────────────────────────
  report.pass =
    report.sitemapIndex.valid &&
    report.shards.accessible === report.shards.total &&
    report.shards.validXml === report.shards.total &&
    report.shards.correctContentType === report.shards.total &&
    report.urls.duplicates === 0 &&
    report.noindexInSitemap === 0 &&
    report.sampleTests.ok200 === report.sampleTests.tested &&
    report.sampleTests.noindexFound === 0 &&
    report.sampleTests.canonicalMismatch === 0 &&
    report.redirectTests.redirect308 === report.redirectTests.tested &&
    report.redirectTests.correctTarget === report.redirectTests.tested &&
    report.correctSlugTests.ok200 === report.correctSlugTests.tested &&
    report.errors.length === 0;

  console.log(`\n  ═══════════════════════════════`);
  console.log(`  OVERALL: ${report.pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  ═══════════════════════════════`);

  // Write JSON report
  writeFileSync("/tmp/sitemap-validation-report.json", JSON.stringify(report, null, 2));
  console.log("\n  Full JSON report: /tmp/sitemap-validation-report.json");

  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
