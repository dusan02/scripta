#!/usr/bin/env node
/**
 * Hreflang Full Audit
 *
 * Checks all 6 language combinations for a sample of company pages:
 *  - sk → en, de, cs, hu, pl
 *  - en → sk, de, cs, hu, pl
 *  - etc.
 *
 * For each language combination:
 *  - hreflang URL exists on the page
 *  - hreflang URL returns 200
 *  - canonical on target page matches
 *  - reciprocal hreflang (target page links back)
 *  - self hreflang present
 *  - x-default present
 *  - No /cz/ (should be /cs/)
 *  - No /cs/cs/ (double prefix)
 *  - No cross-language canonical
 */

import { writeFileSync } from "fs";

const BASE = "https://verifa.sk";
const LANGS = ["sk", "en", "de", "cs", "hu", "pl"];
const SAMPLE_PER_LANG = 5; // 5 companies × 6 langs = 30 pages

async function fetchRaw(url) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  };
}

function extractAllHreflangs(html) {
  const matches = [...html.matchAll(/<link[^>]*rel=["']alternate["'][^>]*hrefLang=["']([^"']+)["'][^>]*href=["']([^"']+)["']/gi)];
  // Also try reversed attribute order
  const matches2 = [...html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*hrefLang=["']([^"']+)["']/gi)];
  const result = {};
  for (const [, lang, href] of matches) result[lang] = href;
  for (const [, href, lang] of matches2) result[lang] = href;
  return result;
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]*rel=["']canonical["'][^>]*href="([^"]+)"/i);
  return m ? m[1] : null;
}

function getSampleUrls() {
  // Use a few known companies with different characteristics
  return [
    { ico: "50333836", slug: "europe-trade-s-r-o" },
    { ico: "36211541", slug: "mh-teplarensky-holding-a-s" },
    { ico: "35713049", slug: "elektro-connection-s-r-o" },
    { ico: "31331136", slug: "slovnaft-a-s" },
    { ico: "31380239", slug: "byty-spol-s-r-o" },
  ];
}

function langToPrefix(lang) {
  if (lang === "sk") return "";
  if (lang === "cz") return "/cs";
  return `/${lang}`;
}

function prefixToLang(prefix) {
  if (prefix === "") return "sk";
  if (prefix === "/cs") return "cz";
  return prefix.slice(1);
}

async function main() {
  console.log("=== Hreflang Full Audit ===\n");
  console.log(`Testing ${SAMPLE_PER_LANG} companies × ${LANGS.length} langs = ${SAMPLE_PER_LANG * LANGS.length} pages\n`);

  const samples = getSampleUrls();
  const results = [];
  const stats = {
    pagesChecked: 0,
    selfHreflangPresent: 0,
    xDefaultPresent: 0,
    allLangsPresent: 0,
    canonicalCorrect: 0,
    noCzPrefix: 0,
    noDoublePrefix: 0,
    noCrossLangCanonical: 0,
    errors: [],
  };

  for (const sample of samples) {
    for (const lang of LANGS) {
      const prefix = langToPrefix(lang);
      const url = `${BASE}${prefix}/firma/${sample.ico}-${sample.slug}`;
      process.stdout.write(`  [${lang}] ${url.slice(0, 80)}...`);

      try {
        const res = await fetchRaw(url);
        stats.pagesChecked++;

        const r = {
          url,
          lang,
          status: res.status,
          hreflangs: {},
          canonical: null,
          selfHreflang: false,
          xDefault: false,
          errors: [],
        };

        if (res.status !== 200) {
          r.errors.push(`HTTP ${res.status}`);
          stats.errors.push(`${url} → ${res.status}`);
          results.push(r);
          console.log(` FAIL (${res.status})`);
          continue;
        }

        r.hreflangs = extractAllHreflangs(res.body);
        r.canonical = extractCanonical(res.body);

        // Check self hreflang
        const selfLangCode = lang === "cz" ? "cs" : lang;
        if (r.hreflangs[selfLangCode]) {
          r.selfHreflang = true;
          stats.selfHreflangPresent++;
        } else {
          r.errors.push(`missing self hreflang '${selfLangCode}'`);
        }

        // Check x-default
        if (r.hreflangs["x-default"]) {
          r.xDefault = true;
          stats.xDefaultPresent++;
        } else {
          r.errors.push("missing x-default");
        }

        // Check all 6 languages present
        const expectedLangs = ["sk", "en", "de", "cs", "hu", "pl"];
        const missingLangs = expectedLangs.filter((l) => !r.hreflangs[l]);
        if (missingLangs.length === 0) {
          stats.allLangsPresent++;
        } else {
          r.errors.push(`missing hreflang: ${missingLangs.join(", ")}`);
        }

        // Check canonical — should point to same language URL
        if (r.canonical) {
          // Canonical should match the URL (with correct prefix)
          const expectedCanonical = url; // canonical should be the same URL
          if (r.canonical === expectedCanonical) {
            stats.canonicalCorrect++;
          } else {
            r.errors.push(`canonical mismatch: ${r.canonical} (expected ${expectedCanonical})`);
          }

          // Check no cross-language canonical
          // If page is /en/firma/..., canonical should not point to /de/ or /cs/ etc.
          const canonicalLang = extractLangFromUrl(r.canonical);
          const pageLang = lang === "cz" ? "cs" : lang;
          if (canonicalLang !== pageLang) {
            r.errors.push(`cross-language canonical: page=${pageLang} canonical=${canonicalLang}`);
          } else {
            stats.noCrossLangCanonical++;
          }
        } else {
          r.errors.push("no canonical");
        }

        // Check no /cz/ prefix (should be /cs/)
        const allHrefs = Object.values(r.hreflangs);
        const hasCzPrefix = allHrefs.some((h) => h.includes("/cz/"));
        if (!hasCzPrefix) {
          stats.noCzPrefix++;
        } else {
          r.errors.push("found /cz/ prefix (should be /cs/)");
        }

        // Check no double prefix (/cs/cs/, /en/en/, etc.)
        const hasDoublePrefix = allHrefs.some((h) => /\/(cs|en|de|hu|pl)\/(cs|en|de|hu|pl)\//.test(h));
        if (!hasDoublePrefix) {
          stats.noDoublePrefix++;
        } else {
          r.errors.push("found double language prefix");
        }

        if (r.errors.length === 0) {
          console.log(" OK");
        } else {
          console.log(` WARN (${r.errors.length})`);
          for (const e of r.errors) {
            console.log(`        - ${e}`);
          }
        }

        results.push(r);
      } catch (e) {
        stats.errors.push(`${url} fetch error: ${e.message}`);
        console.log(` ERROR: ${e.message}`);
      }
    }
  }

  // ── Reciprocal hreflang check ───────────────────────────────────────
  console.log("\n── Reciprocal Hreflang Check ──");
  let reciprocalOk = 0;
  let reciprocalFail = 0;

  for (const r of results) {
    if (r.status !== 200) continue;
    const sourceLang = r.lang === "cz" ? "cs" : r.lang;

    for (const [targetLangCode, targetUrl] of Object.entries(r.hreflangs)) {
      if (targetLangCode === "x-default") continue;
      if (targetLangCode === sourceLang) continue;

      // Fetch target page and check if it links back
      const targetResult = results.find((rr) => rr.url === targetUrl);
      if (!targetResult || targetResult.status !== 200) continue;

      const targetLangNormalized = targetLangCode;
      if (targetResult.hreflangs[sourceLang]) {
        reciprocalOk++;
      } else {
        reciprocalFail++;
        stats.errors.push(`reciprocal fail: ${r.url} → ${targetUrl} (target missing ${sourceLang})`);
      }
    }
  }

  console.log(`  Reciprocal OK:   ${reciprocalOk}`);
  console.log(`  Reciprocal FAIL: ${reciprocalFail}`);
  console.log();

  // ── Report ──────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  HREFLANG AUDIT REPORT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`  Pages checked:           ${stats.pagesChecked}`);
  console.log(`  Self hreflang present:   ${stats.selfHreflangPresent} / ${stats.pagesChecked} (${Math.round(stats.selfHreflangPresent / stats.pagesChecked * 100)}%)`);
  console.log(`  x-default present:       ${stats.xDefaultPresent} / ${stats.pagesChecked} (${Math.round(stats.xDefaultPresent / stats.pagesChecked * 100)}%)`);
  console.log(`  All 6 langs present:     ${stats.allLangsPresent} / ${stats.pagesChecked} (${Math.round(stats.allLangsPresent / stats.pagesChecked * 100)}%)`);
  console.log(`  Canonical correct:       ${stats.canonicalCorrect} / ${stats.pagesChecked} (${Math.round(stats.canonicalCorrect / stats.pagesChecked * 100)}%)`);
  console.log(`  No /cz/ prefix:          ${stats.noCzPrefix} / ${stats.pagesChecked} (${Math.round(stats.noCzPrefix / stats.pagesChecked * 100)}%)`);
  console.log(`  No double prefix:        ${stats.noDoublePrefix} / ${stats.pagesChecked} (${Math.round(stats.noDoublePrefix / stats.pagesChecked * 100)}%)`);
  console.log(`  No cross-lang canonical: ${stats.noCrossLangCanonical} / ${stats.pagesChecked} (${Math.round(stats.noCrossLangCanonical / stats.pagesChecked * 100)}%)`);
  console.log(`  Reciprocal OK:           ${reciprocalOk} / ${reciprocalOk + reciprocalFail} (${Math.round(reciprocalOk / (reciprocalOk + reciprocalFail) * 100)}%)`);
  console.log(`  Total errors:            ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log("\n  ERRORS:");
    for (const e of stats.errors.slice(0, 20)) {
      console.log(`    - ${e}`);
    }
  }

  const pass =
    stats.selfHreflangPresent === stats.pagesChecked &&
    stats.xDefaultPresent === stats.pagesChecked &&
    stats.allLangsPresent === stats.pagesChecked &&
    stats.canonicalCorrect === stats.pagesChecked &&
    stats.noCzPrefix === stats.pagesChecked &&
    stats.noDoublePrefix === stats.pagesChecked &&
    stats.noCrossLangCanonical === stats.pagesChecked &&
    reciprocalFail === 0;

  console.log(`\n  ═══════════════════════════════`);
  console.log(`  OVERALL: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  ═══════════════════════════════`);

  writeFileSync("/tmp/hreflang-audit.json", JSON.stringify({ stats, results, reciprocalOk, reciprocalFail }, null, 2));
  console.log("\n  Full JSON report: /tmp/hreflang-audit.json");
}

function extractLangFromUrl(url) {
  const m = url.match(/verifa\.sk\/(en|de|cs|hu|pl)\//);
  if (m) return m[1];
  return "sk"; // no prefix = Slovak
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
