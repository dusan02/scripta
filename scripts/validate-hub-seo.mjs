#!/usr/bin/env node
/**
 * Hub Page SEO Validator
 *
 * Checks all hub page types across all 6 languages for:
 * - Title length (≤60 chars recommended)
 * - Description length (≤160 chars recommended)
 * - Canonical URL correctness
 * - Hreflang alternates (7 total: sk, en, de, cs, hu, pl, x-default)
 * - HTTP 200 status
 * - H1 presence
 * - JSON-LD presence (BreadcrumbList + ItemList)
 * - Company links on page
 *
 * Samples:
 * - 21 NACE sections × 6 langs = 126
 * - 8 kraje × 6 langs = 48
 * - 4 NACE×kraj samples × 6 langs = 24
 * - 4 okres samples × 6 langs = 24
 * - 4 mesto samples × 6 langs = 24
 * Total: ~246 checks
 */

const BASE = "https://verifa.sk";

const LANGS = ["sk", "en", "de", "cs", "hu", "pl"];
const LANG_PREFIX = { sk: "", en: "/en", de: "/de", cs: "/cs", hu: "/hu", pl: "/pl" };

const NACE_SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U"];
const KRAJE = ["SK010", "SK021", "SK022", "SK023", "SK031", "SK032", "SK041", "SK042"];
const OKRES_SAMPLES = ["SK0101", "SK0105", "SK0422", "SK031B"];
const MESTO_SAMPLES = ["bratislava", "kosice", "zilina", "nitra"];
const NACE_KRAJ_SAMPLES = [["C", "SK010"], ["G", "SK042"], ["F", "SK031"], ["J", "SK010"]];

async function fetchPage(url) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    return { status: res.status, body, url };
  } catch (e) {
    return { status: 0, body: "", url, error: e.message };
  }
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractMetaDesc(html) {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  return m ? m[1].trim() : null;
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  return m ? m[1].trim() : null;
}

function extractH1(html) {
  const m = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  return m ? m[1].trim() : null;
}

function countHreflang(html) {
  return (html.match(/rel=["']alternate["'][^>]*hreflang=/gi) || []).length;
}

function countJsonLd(html) {
  return (html.match(/application\/ld\+json/gi) || []).length;
}

function countCompanyLinks(html) {
  return (html.match(/href=["']\/firma\/\d/g) || []).length;
}

async function validateHub(path, lang) {
  const url = `${BASE}${LANG_PREFIX[lang]}${path}`;
  const page = await fetchPage(url);

  const result = {
    url,
    lang,
    path,
    status: page.status,
    title: null,
    titleLen: 0,
    titleOk: false,
    desc: null,
    descLen: 0,
    descOk: false,
    canonical: null,
    canonicalOk: false,
    h1: null,
    h1Ok: false,
    hreflangCount: 0,
    hreflangOk: false,
    jsonLdCount: 0,
    jsonLdOk: false,
    companyLinks: 0,
    companyLinksOk: false,
    errors: [],
  };

  if (page.status !== 200) {
    result.errors.push(`HTTP ${page.status}`);
    return result;
  }

  const html = page.body;
  if (html.length < 1000) {
    result.errors.push("Page too small (SSR streaming incomplete)");
    return result;
  }

  result.title = extractTitle(html);
  result.titleLen = result.title?.length || 0;
  result.titleOk = result.titleLen > 0 && result.titleLen <= 60;

  result.desc = extractMetaDesc(html);
  result.descLen = result.desc?.length || 0;
  result.descOk = result.descLen > 0 && result.descLen <= 160;

  result.canonical = extractCanonical(html);
  result.canonicalOk = result.canonical === url;

  result.h1 = extractH1(html);
  result.h1Ok = result.h1 !== null && result.h1.length > 0;

  result.hreflangCount = countHreflang(html);
  result.hreflangOk = result.hreflangCount >= 7;

  result.jsonLdCount = countJsonLd(html);
  result.jsonLdOk = result.jsonLdCount >= 6; // 2 global + 2 hub (Breadcrumb + ItemList) + some

  result.companyLinks = countCompanyLinks(html);
  result.companyLinksOk = result.companyLinks > 0;

  return result;
}

async function main() {
  console.log("=== Hub Page SEO Validator ===\n");
  console.log(`Checking ${NACE_SECTIONS.length + KRAJE.length + NACE_KRAJ_SAMPLES.length + OKRES_SAMPLES.length + MESTO_SAMPLES.length} hub pages × ${LANGS.length} languages...\n`);

  const allPaths = [
    ...NACE_SECTIONS.map((s) => ({ path: `/odvetvie/${s}`, type: "odvetvie" })),
    ...KRAJE.map((k) => ({ path: `/kraj/${k}`, type: "kraj" })),
    ...NACE_KRAJ_SAMPLES.map(([s, k]) => ({ path: `/odvetvie/${s}/${k}`, type: "odvetvie-kraj" })),
    ...OKRES_SAMPLES.map((o) => ({ path: `/okres/${o}`, type: "okres" })),
    ...MESTO_SAMPLES.map((m) => ({ path: `/mesto/${m}`, type: "mesto" })),
  ];

  const results = [];
  let checked = 0;
  const total = allPaths.length * LANGS.length;

  // Process in batches of 5 to avoid overwhelming the server
  for (let i = 0; i < allPaths.length; i++) {
    const { path, type } = allPaths[i];
    for (const lang of LANGS) {
      const result = await validateHub(path, lang);
      result.type = type;
      results.push(result);
      checked++;
      if (checked % 20 === 0) {
        console.log(`  Progress: ${checked}/${total}...`);
      }
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  HUB PAGE SEO VALIDATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const totalChecked = results.length;
  const http200 = results.filter((r) => r.status === 200).length;
  const titleOk = results.filter((r) => r.titleOk).length;
  const titleTooLong = results.filter((r) => r.title && r.titleLen > 60).length;
  const descOk = results.filter((r) => r.descOk).length;
  const descTooLong = results.filter((r) => r.desc && r.descLen > 160).length;
  const canonicalOk = results.filter((r) => r.canonicalOk).length;
  const h1Ok = results.filter((r) => r.h1Ok).length;
  const hreflangOk = results.filter((r) => r.hreflangOk).length;
  const jsonLdOk = results.filter((r) => r.jsonLdOk).length;
  const companyLinksOk = results.filter((r) => r.companyLinksOk).length;

  console.log(`  Total checked:        ${totalChecked}`);
  console.log(`  HTTP 200:             ${http200}/${totalChecked} (${(http200 / totalChecked * 100).toFixed(1)}%)`);
  console.log(`  Title ≤60 chars:      ${titleOk}/${totalChecked} (${(titleOk / totalChecked * 100).toFixed(1)}%)`);
  console.log(`  Title >60 chars:      ${titleTooLong}/${totalChecked}`);
  console.log(`  Desc ≤160 chars:      ${descOk}/${totalChecked} (${(descOk / totalChecked * 100).toFixed(1)}%)`);
  console.log(`  Desc >160 chars:      ${descTooLong}/${totalChecked}`);
  console.log(`  Canonical OK:         ${canonicalOk}/${totalChecked} (${(canonicalOk / totalChecked * 100).toFixed(1)}%)`);
  console.log(`  H1 present:           ${h1Ok}/${totalChecked} (${(h1Ok / totalChecked * 100).toFixed(1)}%)`);
  console.log(`  Hreflang ≥7:          ${hreflangOk}/${totalChecked} (${(hreflangOk / totalChecked * 100).toFixed(1)}%)`);
  console.log(`  JSON-LD present:      ${jsonLdOk}/${totalChecked} (${(jsonLdOk / totalChecked * 100).toFixed(1)}%)`);
  console.log(`  Company links:        ${companyLinksOk}/${totalChecked} (${(companyLinksOk / totalChecked * 100).toFixed(1)}%)`);

  // Per-type breakdown
  console.log("\n── Per Hub Type ──");
  const types = ["odvetvie", "kraj", "odvetvie-kraj", "okres", "mesto"];
  for (const type of types) {
    const typeResults = results.filter((r) => r.type === type);
    if (typeResults.length === 0) continue;
    const t200 = typeResults.filter((r) => r.status === 200).length;
    const tTitle = typeResults.filter((r) => r.titleOk).length;
    const tDesc = typeResults.filter((r) => r.descOk).length;
    const tCan = typeResults.filter((r) => r.canonicalOk).length;
    const tH1 = typeResults.filter((r) => r.h1Ok).length;
    console.log(`  ${type.padEnd(16)}: ${typeResults.length} checked, ${t200} HTTP200, title=${tTitle}/${typeResults.length}, desc=${tDesc}/${typeResults.length}, canonical=${tCan}/${typeResults.length}, H1=${tH1}/${typeResults.length}`);
  }

  // Per-language breakdown
  console.log("\n── Per Language ──");
  for (const lang of LANGS) {
    const langResults = results.filter((r) => r.lang === lang);
    const l200 = langResults.filter((r) => r.status === 200).length;
    const lTitle = langResults.filter((r) => r.titleOk).length;
    const lDesc = langResults.filter((r) => r.descOk).length;
    console.log(`  ${lang}: ${langResults.length} checked, ${l200} HTTP200, title=${lTitle}/${langResults.length}, desc=${lDesc}/${langResults.length}`);
  }

  // Show title/desc length issues
  const titleIssues = results.filter((r) => r.title && r.titleLen > 60);
  if (titleIssues.length > 0) {
    console.log("\n── Title Length Issues (>60 chars) ──");
    for (const r of titleIssues.slice(0, 10)) {
      console.log(`  [${r.lang}] ${r.path}: ${r.titleLen} chars — "${r.title}"`);
    }
    if (titleIssues.length > 10) console.log(`  ... and ${titleIssues.length - 10} more`);
  }

  const descIssues = results.filter((r) => r.desc && r.descLen > 160);
  if (descIssues.length > 0) {
    console.log("\n── Description Length Issues (>160 chars) ──");
    for (const r of descIssues.slice(0, 10)) {
      console.log(`  [${r.lang}] ${r.path}: ${r.descLen} chars — "${r.desc?.substring(0, 80)}..."`);
    }
    if (descIssues.length > 10) console.log(`  ... and ${descIssues.length - 10} more`);
  }

  // Show canonical issues
  const canonicalIssues = results.filter((r) => r.status === 200 && !r.canonicalOk);
  if (canonicalIssues.length > 0) {
    console.log("\n── Canonical Issues ──");
    for (const r of canonicalIssues.slice(0, 10)) {
      console.log(`  [${r.lang}] ${r.path}: expected=${r.url}, got=${r.canonical}`);
    }
  }

  // JSON report
  const report = {
    timestamp: new Date().toISOString(),
    totalChecked,
    http200,
    titleOk,
    titleTooLong,
    descOk,
    descTooLong,
    canonicalOk,
    h1Ok,
    hreflangOk,
    jsonLdOk,
    companyLinksOk,
    issues: {
      titleIssues: titleIssues.map((r) => ({ lang: r.lang, path: r.path, len: r.titleLen, title: r.title })),
      descIssues: descIssues.map((r) => ({ lang: r.lang, path: r.path, len: r.descLen, desc: r.desc })),
      canonicalIssues: canonicalIssues.map((r) => ({ lang: r.lang, path: r.path, expected: r.url, got: r.canonical })),
    },
  };
  const { writeFileSync } = await import("fs");
  writeFileSync("/tmp/hub-seo-validation.json", JSON.stringify(report, null, 2));
  console.log("\n  Full JSON report: /tmp/hub-seo-validation.json");
}

main().catch(console.error);
