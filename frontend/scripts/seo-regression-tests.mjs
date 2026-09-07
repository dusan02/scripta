#!/usr/bin/env node
/**
 * Verifa.sk — SEO Regression Tests
 *
 * 171 checks: cs/cz locale, canonical, hreflang, noindex, HTTP status,
 * trailing slash, title/desc length, company links, JSON-LD.
 *
 * Usage:
 *   node scripts/seo-regression-tests.mjs
 *   node scripts/seo-regression-tests.mjs --base=http://localhost:3000
 *   node scripts/seo-regression-tests.mjs --sample=10
 */

const BASE = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] || "https://verifa.sk";
const SAMPLE = parseInt(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] || "0", 10);

// ── Test URL sets ──────────────────────────────────────────────────

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

const STATIC_PAGES = ["/", "/pricing", "/register", "/terms", "/privacy", "/dpa", "/documents", "/slovnik"];

const GLOSSARY_SLUGS = [
  "altman-z-score", "piotroski-f-score", "due-diligence",
  "insolvencia", "konkurz", "likvidacia",
];

const COMPANY_URLS = [
  "/firma/35876832-kia-slovakia-s-r-o",
  "/firma/31392229-mcdonald-s-slovakia-spol-s-r-o",
  "/firma/31342809-delirest-slovakia-s-r-o",
];

// ── Helpers ────────────────────────────────────────────────────────

async function fetchUrl(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    const location = res.headers.get("location");
    let html = "";
    if (res.status < 300 || res.status >= 400) {
      html = await res.text();
    }
    return { status: res.status, location, html, ok: true };
  } catch (e) {
    return { status: 0, error: e.message, ok: false };
  }
}

function extractMeta(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : null;
}

function checkLength(name, value, min, max) {
  if (!value) return { check: name, passed: false, detail: "missing" };
  if (value.length < min) return { check: name, passed: false, detail: `too short (${value.length} < ${min})` };
  if (value.length > max) return { check: name, passed: false, detail: `too long (${value.length} > ${max})` };
  return { check: name, passed: true };
}

// ── Test runner ────────────────────────────────────────────────────

const results = { passed: 0, failed: 0, checks: [] };

function record(label, passed, detail) {
  results.checks.push({ label, passed, detail });
  if (passed) results.passed++;
  else results.failed++;
}

async function testUrl(path, label, checks = {}) {
  const url = `${BASE}${path}`;
  const { status, location, html, error } = await fetchUrl(url);

  if (error) {
    record(label, false, `fetch error: ${error}`);
    return;
  }

  // HTTP status
  if (checks.status) {
    if (status === checks.status) {
      record(`${label}: HTTP ${status}`, true);
    } else {
      record(`${label}: HTTP status`, false, `expected ${checks.status}, got ${status}`);
    }
  }

  // Redirect target
  if (checks.redirectTo && status >= 300 && status < 400) {
    if (location && location.includes(checks.redirectTo)) {
      record(`${label}: redirect → ${location}`, true);
    } else {
      record(`${label}: redirect target`, false, `expected to include "${checks.redirectTo}", got "${location}"`);
    }
  }

  if (!html) return;

  // Canonical
  if (checks.canonicalIncludes) {
    const canonical = extractMeta(html, /<link rel="canonical" href="([^"]*)"/i);
    if (canonical && canonical.includes(checks.canonicalIncludes)) {
      record(`${label}: canonical`, true);
    } else {
      record(`${label}: canonical`, false, `expected to include "${checks.canonicalIncludes}", got "${canonical}"`);
    }
  }

  // Robots
  if (checks.robotsIncludes) {
    const robots = extractMeta(html, /<meta name="robots" content="([^"]*)"/i);
    if (robots && robots.includes(checks.robotsIncludes)) {
      record(`${label}: robots`, true, robots);
    } else {
      record(`${label}: robots`, false, `expected to include "${checks.robotsIncludes}", got "${robots}"`);
    }
  }

  // Title length
  if (checks.titleLength) {
    const title = extractMeta(html, /<title[^>]*>([^<]*)<\/title>/i);
    const lc = checkLength("title", title, 10, 65);
    if (lc.passed) record(`${label}: title length (${title.length})`, true);
    else record(`${label}: title length`, false, lc.detail);
  }

  // Meta description length
  if (checks.descLength) {
    const desc = extractMeta(html, /<meta name="description" content="([^"]*)"/i);
    const lc = checkLength("description", desc, 50, 160);
    if (lc.passed) record(`${label}: desc length (${desc.length})`, true);
    else record(`${label}: desc length`, false, lc.detail);
  }

  // Hreflang
  if (checks.hreflang) {
    const hreflangs = html.match(/<link rel="alternate" hreflang="([^"]*)"/gi) || [];
    const langs = hreflangs.map(h => h.match(/hreflang="([^"]*)"/i)[1]);
    const expected = ["sk", "en", "de", "cs", "hu", "pl", "x-default"];
    const missing = expected.filter(l => !langs.includes(l));
    if (missing.length === 0) {
      record(`${label}: hreflang (${langs.length} langs)`, true);
    } else {
      record(`${label}: hreflang`, false, `missing: ${missing.join(", ")}`);
    }
  }

  // JSON-LD
  if (checks.jsonLd) {
    if (html.includes(checks.jsonLd)) {
      record(`${label}: JSON-LD (${checks.jsonLd})`, true);
    } else {
      record(`${label}: JSON-LD`, false, `missing "${checks.jsonLd}"`);
    }
  }

  // Company links
  if (checks.companyLinks) {
    const links = html.match(/\/firma\/\d+-[a-z0-9-]+/g) || [];
    if (links.length > 0) {
      record(`${label}: company links (${links.length})`, true);
    } else {
      record(`${label}: company links`, false, "no /firma/ links found");
    }
  }

  // Trailing slash redirect
  if (checks.noTrailingSlash) {
    const trailingUrl = `${BASE}${path}/`;
    const trailingRes = await fetchUrl(trailingUrl);
    if (trailingRes.status >= 300 && trailingRes.status < 400) {
      record(`${label}: trailing slash redirect`, true, `${trailingRes.status}`);
    } else if (trailingRes.status === 200) {
      record(`${label}: trailing slash`, false, `served 200 instead of redirect`);
    } else {
      record(`${label}: trailing slash`, true, `${trailingRes.status}`);
    }
  }

  // noindex check (for pages that should NOT be indexed)
  if (checks.shouldBeNoindex) {
    const robots = extractMeta(html, /<meta name="robots" content="([^"]*)"/i);
    if (robots && robots.includes("noindex")) {
      record(`${label}: noindex (correct)`, true);
    } else {
      record(`${label}: noindex`, false, `should be noindex, got "${robots}"`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Verifa.sk SEO Regression Tests ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Sample: ${SAMPLE || "all"}\n`);

  // 1. NACE hubs (21)
  let naceSlugs = NACE_SLUGS;
  if (SAMPLE > 0) naceSlugs = naceSlugs.slice(0, SAMPLE);
  for (const slug of naceSlugs) {
    await testUrl(`/firmy/${slug}`, `NACE /${slug}`, {
      status: 200,
      canonicalIncludes: `/firmy/${slug}`,
      robotsIncludes: "follow",
      hreflang: true,
      jsonLd: "BreadcrumbList",
      companyLinks: true,
      titleLength: true,
      descLength: true,
    });
  }

  // 2. NACE × region (sample)
  let regionCount = 0;
  for (const nace of NACE_SLUGS.slice(0, SAMPLE > 0 ? 2 : 3)) {
    for (const kraj of KRAJ_SLUGS.slice(0, SAMPLE > 0 ? 2 : 4)) {
      if (SAMPLE > 0 && regionCount >= SAMPLE) break;
      await testUrl(`/firmy/${nace}/${kraj}`, `NACE×region /${nace}/${kraj}`, {
        status: 200,
        canonicalIncludes: `/firmy/${nace}/${kraj}`,
        robotsIncludes: "follow",
        hreflang: true,
        jsonLd: "BreadcrumbList",
        companyLinks: true,
        titleLength: true,
      });
      regionCount++;
    }
  }

  // 3. Legacy redirects
  for (const letter of ["I", "F", "G", "C", "A", "M"]) {
    await testUrl(`/odvetvie/${letter}`, `Legacy /odvetvie/${letter}`, {
      status: 308,
      redirectTo: "/firmy/",
    });
  }
  await testUrl(`/odvetvie/I/SK010`, `Legacy /odvetvie/I/SK010`, {
    status: 308,
    redirectTo: "/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj",
  });
  await testUrl(`/odvetvie/F/SK042`, `Legacy /odvetvie/F/SK042`, {
    status: 308,
    redirectTo: "/firmy/stavebnictvo/kosicky-kraj",
  });

  // 4. Screener
  await testUrl(`/screener`, `Screener`, {
    status: 200,
    canonicalIncludes: "/screener",
    robotsIncludes: "index",
    titleLength: true,
    descLength: true,
  });
  await testUrl(`/screener?naceSection=I`, `Screener naceSection=I`, {
    status: 200,
    canonicalIncludes: "/firmy/ubytovanie-a-stravovanie",
  });
  await testUrl(`/screener?kraj=SK010`, `Screener kraj=SK010`, {
    status: 200,
    canonicalIncludes: "/kraj/SK010",
  });

  // 5. Invalid slug
  await testUrl(`/firmy/ubytovanie-a-stravovanie/najvacsie`, `Invalid intent slug`, {
    status: 200,
    shouldBeNoindex: true,
  });

  // 6. /firmy
  await testUrl(`/firmy`, `/firmy`, {
    status: 200,
    canonicalIncludes: "/firmy",
    robotsIncludes: "index",
    hreflang: true,
    titleLength: true,
  });

  // 7. Static pages
  for (const page of STATIC_PAGES) {
    await testUrl(page, `Static ${page}`, {
      status: 200,
      titleLength: true,
    });
  }

  // 8. Glossary
  let glossarySlugs = GLOSSARY_SLUGS;
  if (SAMPLE > 0) glossarySlugs = glossarySlugs.slice(0, SAMPLE);
  for (const slug of glossarySlugs) {
    await testUrl(`/slovnik/${slug}`, `Glossary /${slug}`, {
      status: 200,
      canonicalIncludes: `/slovnik/${slug}`,
      robotsIncludes: "index",
      titleLength: true,
    });
  }

  // 9. Company pages
  for (const companyUrl of COMPANY_URLS) {
    await testUrl(companyUrl, `Company ${companyUrl}`, {
      status: 200,
      canonicalIncludes: companyUrl,
      hreflang: true,
      jsonLd: "Organization",
      titleLength: true,
    });
  }

  // 10. cs/cz locale check (should be cs, not cz)
  await testUrl(`/cs/firmy/ubytovanie-a-stravovanie`, `CS locale /cs/firmy/...`, {
    status: 200,
    canonicalIncludes: "/cs/firmy/ubytovanie-a-stravovanie",
    hreflang: true,
  });

  // 11. Trailing slash checks
  await testUrl(`/firmy/ubytovanie-a-stravovanie`, `Trailing slash /firmy/...`, {
    noTrailingSlash: true,
  });

  // 12. robots.txt
  await testUrl(`/robots.txt`, `robots.txt`, {
    status: 200,
  });

  // 13. sitemap.xml
  await testUrl(`/sitemap.xml`, `sitemap.xml`, {
    status: 200,
  });

  // ── Results ──────────────────────────────────────────────────────

  console.log(`\n=== Results ===`);
  console.log(`  Passed: ${results.passed}`);
  console.log(`  Failed: ${results.failed}`);
  console.log(`  Total:  ${results.passed + results.failed}`);

  if (results.failed > 0) {
    console.log(`\n=== Failures ===`);
    for (const c of results.checks) {
      if (!c.passed) {
        console.log(`  ❌ ${c.label}: ${c.detail}`);
      }
    }
    process.exit(1);
  } else {
    console.log(`\n✅ All ${results.passed} SEO regression checks passed`);
  }
}

main();
