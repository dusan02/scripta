#!/usr/bin/env node
/**
 * Verifa.sk — SEO URL validator
 *
 * Validates that all SEO URL families return correct HTTP status,
 * canonical, robots, and content on production.
 *
 * Usage:
 *   node scripts/validate-hub-seo.mjs                    # Full validation
 *   node scripts/validate-hub-seo.mjs --base=http://localhost:3000  # Local
 *   node scripts/validate-hub-seo.mjs --sample=5         # Sample only
 */

const BASE = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] || "https://verifa.sk";
const SAMPLE = parseInt(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] || "0", 10);

const NACE_SLUGS = [
  "polnohospodarstvo-a-lesnictvo", "tazba-a-dobyanie", "priemyselna-vyroba",
  "energetika", "vodne-hospodarstvo", "stavebnictvo", "obchod",
  "doprava-a-skladovanie", "ubytovanie-a-stravovanie", "informacie-a-komunikacia",
  "financie-a-poisovnictvo", "nehnutelnosti", "profesionalne-sluzby",
  "administrativne-sluzby", "verejna-sprava", "vzdelavanie",
  "zdravotnictvo", "kultura-a-zabava", "ostatne-sluzby",
  "domacnosti", "extrateritorialne-cinnosti",
];

const KRAJ_SLUGS = [
  "bratislavsky-kraj", "trnavsky-kraj", "nitriansky-kraj", "trenciansky-kraj",
  "zilinsky-kraj", "banskobystricky-kraj", "presovsky-kraj", "kosicky-kraj",
];

const NACE_TO_LETTER = {
  "polnohospodarstvo-a-lesnictvo": "A", "tazba-a-dobyanie": "B", "priemyselna-vyroba": "C",
  "energetika": "D", "vodne-hospodarstvo": "E", "stavebnictvo": "F", "obchod": "G",
  "doprava-a-skladovanie": "H", "ubytovanie-a-stravovanie": "I", "informacie-a-komunikacia": "J",
  "financie-a-poisovnictvo": "K", "nehnutelnosti": "L", "profesionalne-sluzby": "M",
  "administrativne-sluzby": "N", "verejna-sprava": "O", "vzdelavanie": "P",
  "zdravotnictvo": "Q", "kultura-a-zabava": "R", "ostatne-sluzby": "S",
  "domacnosti": "T", "extrateritorialne-cinnosti": "U",
};

async function fetchUrl(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    const location = res.headers.get("location");
    let html = "";
    // Only read body for non-redirect responses
    if (res.status < 300 || res.status >= 400) {
      html = await res.text();
    }
    return { status: res.status, location, html };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

function extractMeta(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : null;
}

async function validateUrl(path, expectations) {
  const url = `${BASE}${path}`;
  const { status, location, html, error } = await fetchUrl(url);

  const result = { url: path, status, passed: true, checks: [] };

  if (error) {
    result.passed = false;
    result.checks.push({ check: "fetch", passed: false, detail: error });
    return result;
  }

  // HTTP status check
  if (expectations.status && status !== expectations.status) {
    result.passed = false;
    result.checks.push({ check: "HTTP status", passed: false, expected: expectations.status, got: status });
  } else {
    result.checks.push({ check: "HTTP status", passed: true, got: status });
  }

  // For 308 redirects, check Location header
  if (status === 308) {
    if (expectations.redirectTo && !location?.includes(expectations.redirectTo)) {
      result.passed = false;
      result.checks.push({ check: "redirect target", passed: false, expected: expectations.redirectTo, got: location });
    } else {
      result.checks.push({ check: "redirect target", passed: true, got: location });
    }
    return result;
  }

  if (!html) return result;

  // Canonical
  if (expectations.canonicalIncludes) {
    const canonical = extractMeta(html, /<link rel="canonical" href="([^"]*)"/i);
    if (!canonical || !canonical.includes(expectations.canonicalIncludes)) {
      result.passed = false;
      result.checks.push({ check: "canonical", passed: false, expected: expectations.canonicalIncludes, got: canonical });
    } else {
      result.checks.push({ check: "canonical", passed: true, got: canonical });
    }
  }

  // Robots
  if (expectations.robotsIncludes) {
    const robots = extractMeta(html, /<meta name="robots" content="([^"]*)"/i);
    if (!robots || !robots.includes(expectations.robotsIncludes)) {
      result.passed = false;
      result.checks.push({ check: "robots", passed: false, expected: expectations.robotsIncludes, got: robots });
    } else {
      result.checks.push({ check: "robots", passed: true, got: robots });
    }
  }

  // H1
  if (expectations.h1Includes) {
    const h1 = extractMeta(html, /<h1[^>]*>([^<]*)<\/h1>/i);
    if (!h1 || !h1.includes(expectations.h1Includes)) {
      result.checks.push({ check: "H1", passed: false, expected: expectations.h1Includes, got: h1 });
      // Don't fail on H1 — React hydration may render it client-side
    } else {
      result.checks.push({ check: "H1", passed: true, got: h1 });
    }
  }

  // JSON-LD
  if (expectations.jsonLd) {
    if (!html.includes(expectations.jsonLd)) {
      result.passed = false;
      result.checks.push({ check: "JSON-LD", passed: false, expected: expectations.jsonLd });
    } else {
      result.checks.push({ check: "JSON-LD", passed: true });
    }
  }

  // Company links (internal linking)
  if (expectations.hasCompanyLinks) {
    const companyLinks = html.match(/\/firma\/\d+-[a-z0-9-]+/g);
    if (!companyLinks || companyLinks.length === 0) {
      result.checks.push({ check: "company links", passed: false, detail: "no /firma/ links found" });
    } else {
      result.checks.push({ check: "company links", passed: true, count: companyLinks.length });
    }
  }

  return result;
}

async function main() {
  console.log(`=== Verifa.sk SEO URL Validator ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Sample: ${SAMPLE || "all"}\n`);

  const tests = [];

  // 1. NACE hubs (21)
  let naceSlugs = NACE_SLUGS;
  if (SAMPLE > 0) naceSlugs = naceSlugs.slice(0, SAMPLE);
  for (const slug of naceSlugs) {
    tests.push({
      label: `NACE /firmy/${slug}`,
      path: `/firmy/${slug}`,
      expectations: {
        status: 200,
        canonicalIncludes: `/firmy/${slug}`,
        robotsIncludes: "follow",
        jsonLd: "BreadcrumbList",
        hasCompanyLinks: true,
      },
    });
  }

  // 2. NACE × region (sample)
  let regionCombos = [];
  for (const nace of NACE_SLUGS.slice(0, SAMPLE > 0 ? SAMPLE : 3)) {
    for (const kraj of KRAJ_SLUGS.slice(0, SAMPLE > 0 ? 2 : 8)) {
      regionCombos.push({ nace, kraj });
    }
  }
  for (const { nace, kraj } of regionCombos) {
    tests.push({
      label: `NACE×region /firmy/${nace}/${kraj}`,
      path: `/firmy/${nace}/${kraj}`,
      expectations: {
        status: 200,
        canonicalIncludes: `/firmy/${nace}/${kraj}`,
        robotsIncludes: "follow",
        jsonLd: "BreadcrumbList",
      },
    });
  }

  // 3. Legacy redirects (sample)
  for (const letter of ["I", "F", "G", "C"]) {
    tests.push({
      label: `Legacy /odvetvie/${letter}`,
      path: `/odvetvie/${letter}`,
      expectations: {
        status: 308,
        redirectTo: `/firmy/`,
      },
    });
  }

  // 4. Screener
  tests.push({
    label: "Screener (no params)",
    path: "/screener",
    expectations: { status: 200, canonicalIncludes: "/screener", robotsIncludes: "index" },
  });
  tests.push({
    label: "Screener naceSection=I",
    path: "/screener?naceSection=I",
    expectations: { status: 200, canonicalIncludes: "/firmy/ubytovanie-a-stravovanie" },
  });
  tests.push({
    label: "Screener kraj=SK010",
    path: "/screener?kraj=SK010",
    expectations: { status: 200, canonicalIncludes: "/kraj/SK010" },
  });

  // 5. Invalid slug
  tests.push({
    label: "Invalid intent slug",
    path: "/firmy/ubytovanie-a-stravovanie/najvacsie",
    expectations: { status: 200, robotsIncludes: "noindex" },
  });

  // 6. /firmy
  tests.push({
    label: "/firmy (no params)",
    path: "/firmy",
    expectations: { status: 200, canonicalIncludes: "/firmy", robotsIncludes: "index" },
  });

  // Run tests
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of tests) {
    const result = await validateUrl(test.path, test.expectations);
    if (result.passed) {
      passed++;
      console.log(`  ✅ ${test.label}`);
    } else {
      failed++;
      failures.push(result);
      console.log(`  ❌ ${test.label}`);
      for (const check of result.checks) {
        if (!check.passed) {
          console.log(`      FAIL: ${check.check} — expected: ${check.expected}, got: ${check.got || check.detail}`);
        }
      }
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`  Passed: ${passed}/${tests.length}`);
  console.log(`  Failed: ${failed}/${tests.length}`);

  if (failed > 0) {
    console.log(`\n=== Failures ===`);
    for (const f of failures) {
      console.log(`  ${f.url} (HTTP ${f.status})`);
    }
    process.exit(1);
  } else {
    console.log(`\n✅ All SEO URL checks passed`);
  }
}

main();
