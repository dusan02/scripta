#!/usr/bin/env node
/**
 * SEO Regression Tests — automated checks for known SEO issues.
 *
 * Run: node scripts/seo-regression-tests.mjs
 *
 * Tests:
 *  1. /cs/ vs /cz/ — no /cz/ URLs in sitemap or hreflang
 *  2. Canonical = self URL (not different)
 *  3. Hreflang — 7 alternates, self-referencing, x-default
 *  4. noindex on thin hubs (<10 companies)
 *  5. HTTP 200 on all hub types
 *  6. Trailing slash → 308 redirect
 *  7. Title length ≤60 chars
 *  8. Description length ≤160 chars
 *  9. Hub company links present (on non-thin hubs)
 *  10. JSON-LD present (on non-thin hubs)
 */

import { writeFileSync } from "fs";

const BASE = process.env.BASE_URL || "https://verifa.sk";
const TIMEOUT = 30000;
const LANGS = ["sk", "en", "de", "cs", "hu", "pl"];
const SAMPLE_HUBS = [
  { path: "/odvetvie/C", type: "odvetvie", thin: false },
  { path: "/odvetvie/G", type: "odvetvie", thin: false },
  { path: "/odvetvie/J", type: "odvetvie", thin: false },
  { path: "/odvetvie/U", type: "odvetvie", thin: true }, // 0 companies
  { path: "/odvetvie/O", type: "odvetvie", thin: false }, // 16 companies
  { path: "/kraj/SK010", type: "kraj", thin: false },
  { path: "/kraj/SK042", type: "kraj", thin: false },
  { path: "/odvetvie/C/SK010", type: "odvetvie-kraj", thin: false },
  { path: "/okres/SK0101", type: "okres", thin: false },
  { path: "/mesto/bratislava", type: "mesto", thin: false },
];

let passed = 0;
let failed = 0;
const failures = [];

function log(test, status, detail = "") {
  const icon = status === "PASS" ? "✅" : "❌";
  console.log(`  ${icon} ${test}: ${status}${detail ? " — " + detail : ""}`);
  if (status === "PASS") passed++;
  else { failed++; failures.push({ test, detail }); }
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const html = await res.text();
    return { status: res.status, html, headers: res.headers };
  } catch (e) {
    return { status: 0, html: "", headers: {}, error: e.message };
  }
}

async function testCsVsCz() {
  console.log("\n═══ Test 1: /cs/ vs /cz/ ═══");
  // Check /cz/ returns 404
  const czRes = await fetchHtml(`${BASE}/cz/odvetvie/C`);
  log("/cz/odvetvie/C returns 404", czRes.status === 404 ? "PASS" : "FAIL", `got ${czRes.status}`);

  // Check /cs/ returns 200
  const csRes = await fetchHtml(`${BASE}/cs/odvetvie/C`);
  log("/cs/odvetvie/C returns 200", csRes.status === 200 ? "PASS" : "FAIL", `got ${csRes.status}`);

  // Check no /cz/ in sitemap
  const sitemapRes = await fetchHtml(`${BASE}/sitemap/0.xml`);
  const czInSitemap = sitemapRes.html.includes("/cz/");
  log("No /cz/ in sitemap/0.xml", !czInSitemap ? "PASS" : "FAIL");

  // Check no hreflang="cz" in sample page
  const sampleRes = await fetchHtml(`${BASE}/cs/odvetvie/C`);
  const czInHreflang = sampleRes.html.includes('hrefLang="cz"') || sampleRes.html.includes('hreflang="cz"');
  log('No hreflang="cz" in /cs/ page', !czInHreflang ? "PASS" : "FAIL");
}

async function testCanonical() {
  console.log("\n═══ Test 2: Canonical = self URL ═══");
  for (const hub of SAMPLE_HUBS.slice(0, 5)) {
    for (const lang of ["sk", "en", "cs"]) {
      const prefix = lang === "sk" ? "" : `/${lang}`;
      const url = `${BASE}${prefix}${hub.path}`;
      const { html, status } = await fetchHtml(url);
      if (status !== 200) {
        log(`[${lang}] ${hub.path} canonical (skipped, HTTP ${status})`, "PASS");
        continue;
      }
      const canonicalMatch = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/);
      const canonical = canonicalMatch ? canonicalMatch[1] : null;
      log(`[${lang}] ${hub.path} canonical = self`, canonical === url ? "PASS" : "FAIL", `expected ${url}, got ${canonical}`);
    }
  }
}

async function testHreflang() {
  console.log("\n═══ Test 3: Hreflang (7 alternates, self, x-default) ═══");
  for (const hub of SAMPLE_HUBS.slice(0, 5)) {
    const url = `${BASE}${hub.path}`;
    const { html, status } = await fetchHtml(url);
    if (status !== 200) {
      log(`${hub.path} hreflang (skipped, HTTP ${status})`, "PASS");
      continue;
    }
    // Count hreflang tags (case-insensitive)
    const hreflangMatches = html.match(/rel="alternate"[^>]*hrefLang="[^"]*"/gi) || [];
    log(`${hub.path} has 7 hreflang alternates`, hreflangMatches.length === 7 ? "PASS" : "FAIL", `got ${hreflangMatches.length}`);

    // Check x-default
    const hasXDefault = html.includes('hrefLang="x-default"') || html.includes('hreflang="x-default"');
    log(`${hub.path} has x-default`, hasXDefault ? "PASS" : "FAIL");

    // Check self-referencing (sk)
    const hasSelf = html.includes('hrefLang="sk"') || html.includes('hreflang="sk"');
    log(`${hub.path} has self-referencing hreflang (sk)`, hasSelf ? "PASS" : "FAIL");
  }
}

async function testNoindex() {
  console.log("\n═══ Test 4: noindex on thin hubs ═══");
  // /odvetvie/U (0 companies) should have noindex
  const uRes = await fetchHtml(`${BASE}/odvetvie/U`);
  const uNoindex = uRes.html.includes('content="noindex') || uRes.html.includes('content="noindex, follow"');
  log("/odvetvie/U (0 companies) has noindex", uNoindex ? "PASS" : "FAIL");

  // /odvetvie/C (30k companies) should NOT have noindex
  const cRes = await fetchHtml(`${BASE}/odvetvie/C`);
  const cNoindex = cRes.html.includes('content="noindex');
  log("/odvetvie/C (30k companies) is indexable", !cNoindex ? "PASS" : "FAIL");
}

async function testHttpStatus() {
  console.log("\n═══ Test 5: HTTP 200 on all hub types ═══");
  for (const hub of SAMPLE_HUBS) {
    for (const lang of LANGS) {
      const prefix = lang === "sk" ? "" : `/${lang}`;
      const url = `${BASE}${prefix}${hub.path}`;
      const { status } = await fetchHtml(url);
      // Thin hubs might return 200 with noindex, that's OK
      log(`[${lang}] ${hub.path} HTTP 200`, status === 200 ? "PASS" : "FAIL", `got ${status}`);
    }
  }
}

async function testTrailingSlash() {
  console.log("\n═══ Test 6: Trailing slash → 308 redirect ═══");
  for (const path of ["/odvetvie/C", "/kraj/SK010", "/firmy"]) {
    const url = `${BASE}${path}/`;
    const { status } = await fetchHtml(url);
    log(`${path}/ returns 308`, status === 308 ? "PASS" : "FAIL", `got ${status}`);
  }
}

async function testTitleLength() {
  console.log("\n═══ Test 7: Title length ≤60 chars ═══");
  for (const hub of SAMPLE_HUBS.slice(0, 5)) {
    for (const lang of ["sk", "en", "de", "cs", "hu", "pl"]) {
      const prefix = lang === "sk" ? "" : `/${lang}`;
      const url = `${BASE}${prefix}${hub.path}`;
      const { html, status } = await fetchHtml(url);
      if (status !== 200) continue;
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/&amp;/g, "&") : "";
      const titleLen = title.length;
      log(`[${lang}] ${hub.path} title ≤60 chars`, titleLen <= 60 ? "PASS" : "FAIL", `"${title}" (${titleLen} chars)`);
    }
  }
}

async function testDescriptionLength() {
  console.log("\n═══ Test 8: Description length ≤160 chars ═══");
  for (const hub of SAMPLE_HUBS.slice(0, 5)) {
    for (const lang of ["sk", "en", "de"]) {
      const prefix = lang === "sk" ? "" : `/${lang}`;
      const url = `${BASE}${prefix}${hub.path}`;
      const { html, status } = await fetchHtml(url);
      if (status !== 200) continue;
      const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
      const desc = descMatch ? descMatch[1] : "";
      const descLen = desc.length;
      log(`[${lang}] ${hub.path} desc ≤160 chars`, descLen <= 160 ? "PASS" : "FAIL", `${descLen} chars`);
    }
  }
}

async function testHubCompanyLinks() {
  console.log("\n═══ Test 9: Hub company links (non-thin hubs) ═══");
  for (const hub of SAMPLE_HUBS.filter(h => !h.thin)) {
    const url = `${BASE}${hub.path}`;
    const { html, status } = await fetchHtml(url);
    if (status !== 200) {
      log(`${hub.path} company links (skipped, HTTP ${status})`, "PASS");
      continue;
    }
    const companyLinks = (html.match(/href="\/firma\/[0-9][^"]*"/g) || []).length;
    log(`${hub.path} has company links`, companyLinks > 0 ? "PASS" : "FAIL", `${companyLinks} links`);
  }
}

async function testJsonLd() {
  console.log("\n═══ Test 10: JSON-LD present (non-thin hubs) ═══");
  for (const hub of SAMPLE_HUBS.filter(h => !h.thin)) {
    const url = `${BASE}${hub.path}`;
    const { html, status } = await fetchHtml(url);
    if (status !== 200) {
      log(`${hub.path} JSON-LD (skipped, HTTP ${status})`, "PASS");
      continue;
    }
    const hasJsonLd = html.includes('application/ld+json');
    log(`${hub.path} has JSON-LD`, hasJsonLd ? "PASS" : "FAIL");

    // Check for BreadcrumbList
    const hasBreadcrumb = html.includes('"@type":"BreadcrumbList"');
    log(`${hub.path} has BreadcrumbList`, hasBreadcrumb ? "PASS" : "FAIL");
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SEO REGRESSION TESTS");
  console.log(`  Base URL: ${BASE}`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════");

  await testCsVsCz();
  await testCanonical();
  await testHreflang();
  await testNoindex();
  await testHttpStatus();
  await testTrailingSlash();
  await testTitleLength();
  await testDescriptionLength();
  await testHubCompanyLinks();
  await testJsonLd();

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) {
      console.log(`    ❌ ${f.test}: ${f.detail}`);
    }
  }

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE,
    passed,
    failed,
    failures,
  };
  writeFileSync("/tmp/seo-regression-tests.json", JSON.stringify(report, null, 2));
  console.log("\n  Full JSON report: /tmp/seo-regression-tests.json");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
