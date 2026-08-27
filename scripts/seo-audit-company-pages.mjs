#!/usr/bin/env node
/**
 * SEO Audit — Company Pages (verifa.sk)
 *
 * Read-only audit of a random sample of company pages on production.
 * Checks: HTTP, redirect chain, canonical, robots/noindex, title, meta description,
 * H1, JSON-LD, word count, internal links, response time, duplicates.
 *
 * Usage:
 *   node scripts/seo-audit-company-pages.mjs --sample-size 5000 --seed 42
 *   node scripts/seo-audit-company-pages.mjs --sample-size 1000 --concurrency 5 --base-url https://verifa.sk
 *
 * Output:
 *   scripts/seo-audit-results.json   (raw per-URL results)
 *   scripts/seo-audit-report.md      (aggregated report)
 *   stdout                           (executive summary)
 *
 * Requirements: Node 18+ (built-in fetch). No external deps.
 */

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = __dirname;

// ─── CLI args ────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true";
      acc.push([key, val]);
    }
    return acc;
  }, [])
);

const SAMPLE_SIZE = parseInt(args["sample-size"] || "5000", 10);
const SEED = parseInt(args.seed || "42", 10);
const CONCURRENCY = parseInt(args.concurrency || "8", 10);
const BASE_URL = args["base-url"] || "https://verifa.sk";
const DB_URL = args["db-url"] || process.env.DATABASE_URL || "";
const TIMEOUT_MS = parseInt(args.timeout || "20000", 10);
const OUTPUT_JSON = join(OUTPUT_DIR, "seo-audit-results.json");
const OUTPUT_MD = join(OUTPUT_DIR, "seo-audit-report.md");
const OUTPUT_CSV = join(OUTPUT_DIR, "seo-audit-results.csv");

// ─── Seeded PRNG (mulberry32) ────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// ─── DB: fetch sample ICOs ───────────────────────────────────
// We connect to the production DB via psql in the SSH session.
// Here we expect a JSON file with the sample, or we use psql directly.
// For portability, we accept a pre-generated sample file or psql query.

async function fetchSampleIcos() {
  // If a sample file is provided, use it
  if (args["sample-file"]) {
    const data = readFileSync(args["sample-file"], "utf-8");
    return JSON.parse(data);
  }

  // Otherwise, expect ico list from stdin (piped from psql/ssh)
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    if (text) {
      // Could be JSON array or newline-separated ICOs
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return text.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
        const parts = line.split("|");
        return { ico: parts[0].trim(), name: parts[1]?.trim() || "", legal_form: parts[2]?.trim() || "" };
      });
    }
  }

  console.error("No sample provided. Pipe ICO list via stdin or use --sample-file.");
  console.error("Example: ssh root@prod 'docker exec pg psql -U verifa -d verifa -t -A -c \"SELECT ico,name,\\\"legalForm\\\" FROM \\\"Company\\\" WHERE \\\"legalForm\\\" IN ('s.r.o.','a.s.','v.o.s.','k.s.') ORDER BY RANDOM() LIMIT 5000\"' | node scripts/seo-audit-company-pages.mjs");
  process.exit(1);
}

// ─── HTTP fetch with redirect tracking ───────────────────────
async function fetchWithRedirects(url, timeoutMs) {
  const start = performance.now();
  const redirects = [];
  let currentUrl = url;
  let resp;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Follow up to 5 redirects manually to track chain
    for (let i = 0; i <= 5; i++) {
      resp = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "VerifaSEOAudit/1.0 (+https://verifa.sk/bot)",
          "Accept": "text/html,*/*",
        },
      });

      const status = resp.status;
      if (status >= 300 && status < 400) {
        const location = resp.headers.get("location");
        if (!location) break;
        const nextUrl = new URL(location, currentUrl).href;
        redirects.push({ from: currentUrl, to: nextUrl, status });
        currentUrl = nextUrl;
        continue;
      }
      break;
    }

    clearTimeout(timer);
    const elapsed = performance.now() - start;
    const text = resp ? await resp.text() : "";

    return {
      url,
      finalUrl: currentUrl,
      status: resp ? resp.status : 0,
      statusText: resp ? resp.statusText : "NO_RESPONSE",
      redirects,
      redirectCount: redirects.length,
      responseTime: Math.round(elapsed),
      headers: resp ? Object.fromEntries(resp.headers.entries()) : {},
      body: text,
      timedOut: false,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      url,
      finalUrl: currentUrl,
      status: 0,
      statusText: e.name === "AbortError" ? "TIMEOUT" : "FETCH_ERROR",
      redirects,
      redirectCount: redirects.length,
      responseTime: Math.round(performance.now() - start),
      headers: {},
      body: "",
      timedOut: e.name === "AbortError",
      error: e.message,
    };
  }
}

// ─── HTML parsing (lightweight, no deps) ─────────────────────
function extractTag(html, tag) {
  // <tag ...>content</tag> — returns first match content
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function extractMeta(html, name) {
  // <meta name="..." content="..."> or <meta property="..." content="...">
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`, "i"),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${name}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractAllH1(html) {
  const matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  return matches.map(m => m[1].replace(/<[^>]+>/g, "").trim());
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  if (m) return m[1];
  const m2 = html.match(/<link[^>]+href=["']([^"']*)["'][^>]*rel=["']canonical["']/i);
  return m2 ? m2[1] : null;
}

function extractRobotsMeta(html) {
  return extractMeta(html, "robots");
}

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return blocks.map(m => {
    const raw = m[1].trim();
    try {
      return { valid: true, data: JSON.parse(raw) };
    } catch (e) {
      return { valid: false, error: e.message, raw: raw.slice(0, 200) };
    }
  });
}

function extractXRobotsTag(headers) {
  return headers["x-robots-tag"] || null;
}

function countWords(text) {
  const clean = text.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(w => w.length > 1);
  return {
    total: words.length,
    unique: new Set(words.map(w => w.toLowerCase())).size,
  };
}

function extractMainContent(html) {
  // Strip script, style, nav, header, footer
  let content = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  return content;
}

function extractInternalLinks(html, baseUrl) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)];
  const internal = new Set();
  const external = new Set();
  const baseDomain = new URL(baseUrl).hostname;

  for (const m of links) {
    let href = m[1];
    if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      const full = new URL(href, baseUrl).href;
      const domain = new URL(full).hostname;
      if (domain === baseDomain) {
        internal.add(full.replace(baseDomain, "").replace(/^https?:\/\//, ""));
      } else {
        external.add(domain);
      }
    } catch {}
  }
  return { internal: [...internal], external: [...external] };
}

function containsCompanyName(text, name) {
  if (!name) return false;
  // Check if the company name (or significant part) appears in text
  const cleanName = name.replace(/[",\.]/g, "").trim();
  if (cleanName.length < 3) return false;
  return text.toLowerCase().includes(cleanName.toLowerCase());
}

// ─── Audit one URL ───────────────────────────────────────────
function auditUrl(company, baseUrl) {
  const slug = company.name ? slugify(company.name) : "firma";
  // Test the canonical URL (with slug) — this is what Google sees
  const url = `${baseUrl}/firma/${company.ico}-${slug}`;

  return fetchWithRedirects(url, TIMEOUT_MS).then(result => {
    const issues = [];
    let severity = "PASS";

    const html = result.body;
    const hasHtml = html.length > 0 && result.status === 200;

    // ── HTTP checks ──
    if (result.timedOut) {
      issues.push({ code: "TIMEOUT", severity: "P0", msg: `Request timed out after ${TIMEOUT_MS}ms` });
    } else if (result.status === 0) {
      issues.push({ code: "FETCH_ERROR", severity: "P0", msg: result.error || "Fetch failed" });
    } else if (result.status >= 500) {
      issues.push({ code: "HTTP_5XX", severity: "P0", msg: `HTTP ${result.status}` });
    } else if (result.status === 404 || result.status === 410) {
      issues.push({ code: "HTTP_404", severity: "P0", msg: `HTTP ${result.status} — page not found` });
    } else if (result.status === 301 || result.status === 308) {
      // Permanent redirect — check if it's the expected slug redirect
      // If we requested with slug and got 301, that's unexpected
      issues.push({ code: "REDIRECT_301", severity: "P1", msg: `Unexpected 301 redirect to ${result.finalUrl}` });
    } else if (result.status === 302 || result.status === 307) {
      issues.push({ code: "REDIRECT_TEMP", severity: "P1", msg: `Temporary redirect to ${result.finalUrl}` });
    } else if (result.status !== 200) {
      issues.push({ code: "HTTP_OTHER", severity: "P1", msg: `HTTP ${result.status}` });
    }

    // Redirect loop
    if (result.redirectCount >= 5) {
      issues.push({ code: "REDIRECT_LOOP", severity: "P0", msg: "Redirect chain >= 5" });
    }

    // Response time
    if (result.responseTime > 10000) {
      issues.push({ code: "SLOW_RESPONSE", severity: "P2", msg: `Response time ${result.responseTime}ms` });
    } else if (result.responseTime > 5000) {
      issues.push({ code: "SLOW_RESPONSE", severity: "P2", msg: `Response time ${result.responseTime}ms` });
    }

    if (!hasHtml) {
      // Can't do HTML checks
      return buildResult(company, url, result, issues, severity, null);
    }

    // ── HTML/SEO checks ──
    const title = extractTag(html, "title");
    const metaDesc = extractMeta(html, "description");
    const h1s = extractAllH1(html);
    const canonical = extractCanonical(html);
    const robotsMeta = extractRobotsMeta(html);
    const xRobotsTag = extractXRobotsTag(result.headers);
    const jsonLd = extractJsonLd(html);
    const mainContent = extractMainContent(html);
    const wordCount = countWords(mainContent);
    const links = extractInternalLinks(html, url);
    const companyNameInContent = containsCompanyName(mainContent, company.name);

    // Title checks
    if (!title) {
      issues.push({ code: "MISSING_TITLE", severity: "P1", msg: "No <title> tag" });
    } else if (title.trim().length === 0) {
      issues.push({ code: "EMPTY_TITLE", severity: "P1", msg: "Empty <title>" });
    } else if (title.length > 70) {
      issues.push({ code: "TITLE_TOO_LONG", severity: "P2", msg: `Title ${title.length} chars (max 70 recommended)` });
    } else if (title.length < 10) {
      issues.push({ code: "TITLE_TOO_SHORT", severity: "P2", msg: `Title ${title.length} chars (min 10 recommended)` });
    }

    // Meta description checks
    if (!metaDesc) {
      issues.push({ code: "MISSING_META_DESC", severity: "P1", msg: "No meta description" });
    } else if (metaDesc.trim().length === 0) {
      issues.push({ code: "EMPTY_META_DESC", severity: "P1", msg: "Empty meta description" });
    } else if (metaDesc.length > 170) {
      issues.push({ code: "META_DESC_TOO_LONG", severity: "P2", msg: `Meta desc ${metaDesc.length} chars` });
    } else if (metaDesc.length < 50) {
      issues.push({ code: "META_DESC_TOO_SHORT", severity: "P2", msg: `Meta desc ${metaDesc.length} chars` });
    }

    // H1 checks
    if (h1s.length === 0) {
      issues.push({ code: "MISSING_H1", severity: "P1", msg: "No H1 tag" });
    } else if (h1s.length > 1) {
      issues.push({ code: "MULTIPLE_H1", severity: "P2", msg: `${h1s.length} H1 tags found` });
    } else {
      // Check if H1 contains company name
      if (company.name && !h1s[0].toLowerCase().includes(company.name.toLowerCase().split(" ")[0])) {
        issues.push({ code: "H1_NO_COMPANY_NAME", severity: "P2", msg: `H1 doesn't contain company name` });
      }
    }

    // Canonical checks
    if (!canonical) {
      issues.push({ code: "MISSING_CANONICAL", severity: "P1", msg: "No canonical link" });
    } else {
      // Canonical should be absolute and point to /firma/{ico} (without slug is OK too)
      if (!canonical.startsWith("http")) {
        issues.push({ code: "CANONICAL_RELATIVE", severity: "P1", msg: `Canonical is relative: ${canonical}` });
      }
      // Check if canonical points to the right company
      const canonicalPath = (() => { try { return new URL(canonical).pathname; } catch { return canonical; } })();
      if (!canonicalPath.includes(`/firma/${company.ico}`)) {
        issues.push({ code: "CANONICAL_WRONG_COMPANY", severity: "P0", msg: `Canonical points to ${canonical}, expected /firma/${company.ico}` });
      }
      // Check for query params in canonical
      if (canonical.includes("?")) {
        issues.push({ code: "CANONICAL_HAS_QUERY", severity: "P1", msg: `Canonical has query params: ${canonical}` });
      }
    }

    // Robots/noindex checks
    const robotsValue = robotsMeta || xRobotsTag || "";
    const isNoindex = robotsValue.toLowerCase().includes("noindex");
    // We need to determine if noindex is expected (quality gate: <2 financial statements)
    // We don't know stmt count here, so we flag all noindex for review
    if (isNoindex) {
      issues.push({ code: "NOINDEX", severity: "P1", msg: `Page is noindex (${robotsMeta ? "meta" : "X-Robots-Tag"}: ${robotsValue})` });
    }

    // JSON-LD checks
    if (jsonLd.length === 0) {
      issues.push({ code: "NO_JSON_LD", severity: "P1", msg: "No JSON-LD structured data" });
    } else {
      const invalid = jsonLd.filter(b => !b.valid);
      if (invalid.length > 0) {
        issues.push({ code: "INVALID_JSON_LD", severity: "P1", msg: `${invalid.length} invalid JSON-LD block(s): ${invalid[0].error}` });
      }
      // Check for Organization schema
      const validBlocks = jsonLd.filter(b => b.valid);
      const hasOrg = validBlocks.some(b => {
        const graph = b.data["@graph"];
        if (graph) return graph.some(n => n["@type"] === "Organization");
        return b.data["@type"] === "Organization";
      });
      if (!hasOrg) {
        issues.push({ code: "NO_ORG_SCHEMA", severity: "P2", msg: "No Organization schema in JSON-LD" });
      }
    }

    // Content / thin content checks
    if (wordCount.total < 50) {
      issues.push({ code: "THIN_CONTENT", severity: "P1", msg: `Only ${wordCount.total} words` });
    } else if (wordCount.total < 200) {
      issues.push({ code: "LOW_CONTENT", severity: "P2", msg: `${wordCount.total} words (thin content risk)` });
    }

    if (!companyNameInContent && company.name) {
      issues.push({ code: "NO_COMPANY_NAME_IN_CONTENT", severity: "P1", msg: "Company name not found in page content" });
    }

    // Internal linking
    if (links.internal.length < 3) {
      issues.push({ code: "FEW_INTERNAL_LINKS", severity: "P2", msg: `Only ${links.internal.length} internal links` });
    }

    // Determine overall severity
    const severities = issues.map(i => i.severity);
    if (severities.includes("P0")) severity = "P0";
    else if (severities.includes("P1")) severity = "P1";
    else if (severities.includes("P2")) severity = "P2";

    return buildResult(company, url, result, issues, severity, {
      title, metaDesc, h1s, canonical, robotsMeta, xRobotsTag,
      jsonLdCount: jsonLd.length, jsonLdValid: jsonLd.filter(b => b.valid).length,
      jsonLdInvalid: jsonLd.filter(b => !b.valid).length,
      wordCount, companyNameInContent,
      internalLinks: links.internal.length,
      externalLinks: links.external.length,
      internalLinkPaths: links.internal.slice(0, 20),
    });
  });
}

function slugify(name) {
  if (!name) return "firma";
  return name
    .toLowerCase()
    .replace(/[áä]/g, "a").replace(/[éě]/g, "e").replace(/[í]/g, "i")
    .replace(/[óô]/g, "o").replace(/[úů]/g, "u").replace(/[ý]/g, "y")
    .replace(/[ž]/g, "z").replace(/[š]/g, "s").replace(/[č]/g, "c")
    .replace(/[ř]/g, "r").replace(/[ď]/g, "d").replace(/[ť]/g, "t")
    .replace(/[ň]/g, "n").replace(/[ľĺ]/g, "l")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60) || "firma";
}

function buildResult(company, url, fetchResult, issues, severity, seo) {
  return {
    ico: company.ico,
    name: company.name,
    legalForm: company.legal_form || "",
    url,
    httpStatus: fetchResult.status,
    finalUrl: fetchResult.finalUrl,
    responseTime: fetchResult.responseTime,
    redirectCount: fetchResult.redirectCount,
    redirects: fetchResult.redirects,
    timedOut: fetchResult.timedOut,
    title: seo?.title || null,
    metaDescription: seo?.metaDesc || null,
    h1: seo?.h1s || [],
    canonical: seo?.canonical || null,
    robotsMeta: seo?.robotsMeta || null,
    xRobotsTag: seo?.xRobotsTag || null,
    noindex: (seo?.robotsMeta?.toLowerCase().includes("noindex") || seo?.xRobotsTag?.toLowerCase().includes("noindex")) || false,
    jsonLdCount: seo?.jsonLdCount || 0,
    jsonLdValid: seo?.jsonLdValid || 0,
    jsonLdInvalid: seo?.jsonLdInvalid || 0,
    wordCount: seo?.wordCount?.total || 0,
    uniqueWordCount: seo?.wordCount?.unique || 0,
    companyNameInContent: seo?.companyNameInContent || false,
    internalLinks: seo?.internalLinks || 0,
    externalLinks: seo?.externalLinks || 0,
    issues,
    severity,
    timestamp: new Date().toISOString(),
  };
}

// ─── Concurrency pool ────────────────────────────────────────
async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let completed = 0;
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      const result = await tasks[i]();
      results[i] = result;
      completed++;
      if (completed % 100 === 0 || completed === tasks.length) {
        process.stderr.write(`\r  Progress: ${completed}/${tasks.length} (${Math.round(completed/tasks.length*100)}%)`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  process.stderr.write("\n");
  return results;
}

// ─── Duplication analysis ────────────────────────────────────
function analyzeDuplicates(results) {
  const titleMap = new Map();
  const descMap = new Map();
  const h1Map = new Map();
  const canonicalMap = new Map();

  for (const r of results) {
    if (r.title) {
      const key = r.title.trim().toLowerCase();
      if (!titleMap.has(key)) titleMap.set(key, []);
      titleMap.get(key).push(r.ico);
    }
    if (r.metaDescription) {
      const key = r.metaDescription.trim().toLowerCase();
      if (!descMap.has(key)) descMap.set(key, []);
      descMap.get(key).push(r.ico);
    }
    if (r.h1.length > 0) {
      const key = r.h1[0].trim().toLowerCase();
      if (!h1Map.has(key)) h1Map.set(key, []);
      h1Map.get(key).push(r.ico);
    }
    if (r.canonical) {
      if (!canonicalMap.has(r.canonical)) canonicalMap.set(r.canonical, []);
      canonicalMap.get(r.canonical).push(r.ico);
    }
  }

  const dupTitles = [...titleMap.entries()].filter(([_, icos]) => icos.length > 1);
  const dupDescs = [...descMap.entries()].filter(([_, icos]) => icos.length > 1);
  const dupH1s = [...h1Map.entries()].filter(([_, icos]) => icos.length > 1);
  const dupCanonicals = [...canonicalMap.entries()].filter(([_, icos]) => icos.length > 1);

  return { dupTitles, dupDescs, dupH1s, dupCanonicals };
}

// ─── Report generation ───────────────────────────────────────
function generateReport(results, dups, sampleSize, seed) {
  const total = results.length;
  const http200 = results.filter(r => r.httpStatus === 200).length;
  const http5xx = results.filter(r => r.httpStatus >= 500).length;
  const http404 = results.filter(r => r.httpStatus === 404 || r.httpStatus === 410).length;
  const timeouts = results.filter(r => r.timedOut).length;
  const errors = results.filter(r => r.httpStatus === 0).length;

  const indexable = results.filter(r => r.httpStatus === 200 && !r.noindex).length;
  const noindexCount = results.filter(r => r.noindex).length;
  const canonicalOk = results.filter(r => r.canonical && r.canonical.includes(`/firma/${r.ico}`) && !r.canonical.includes("?")).length;
  const titleOk = results.filter(r => r.title && r.title.trim().length > 0 && r.title.length <= 70).length;
  const metaOk = results.filter(r => r.metaDescription && r.metaDescription.trim().length > 0 && r.metaDescription.length >= 50 && r.metaDescription.length <= 170).length;
  const h1Ok = results.filter(r => r.h1.length === 1).length;
  const jsonLdOk = results.filter(r => r.jsonLdCount > 0 && r.jsonLdInvalid === 0).length;
  const thinContent = results.filter(r => r.wordCount > 0 && r.wordCount < 200).length;
  const veryThinContent = results.filter(r => r.wordCount > 0 && r.wordCount < 50).length;
  const noCompanyName = results.filter(r => !r.companyNameInContent).length;

  const responseTimes = results.filter(r => r.responseTime > 0).map(r => r.responseTime).sort((a, b) => a - b);
  const p = (arr, pct) => arr.length > 0 ? arr[Math.floor(arr.length * pct)] : 0;
  const avgRt = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;
  const p50 = p(responseTimes, 0.5);
  const p95 = p(responseTimes, 0.95);
  const p99 = p(responseTimes, 0.99);
  const slowPages = results.filter(r => r.responseTime > 5000).length;

  const p0Count = results.filter(r => r.severity === "P0").length;
  const p1Count = results.filter(r => r.severity === "P1").length;
  const p2Count = results.filter(r => r.severity === "P2").length;
  const passCount = results.filter(r => r.severity === "PASS").length;

  // Issue breakdown
  const issueCounts = {};
  for (const r of results) {
    for (const issue of r.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
    }
  }
  const topIssues = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const pct = (n) => total > 0 ? `${(n / total * 100).toFixed(1)}%` : "0%";

  const report = `# SEO Audit Report — Company Pages (verifa.sk)

**Date:** ${new Date().toISOString()}
**Sample size:** ${total}
**Seed:** ${seed}
**Base URL:** ${BASE_URL}
**Concurrency:** ${CONCURRENCY}

## Executive Summary

\`\`\`text
Sample size:      ${total}
HTTP 200:         ${pct(http200)} (${http200})
Indexable:        ${pct(indexable)} (${indexable})
noindex:          ${pct(noindexCount)} (${noindexCount})
Canonical OK:     ${pct(canonicalOk)} (${canonicalOk})
Title OK:         ${pct(titleOk)} (${titleOk})
Meta desc OK:     ${pct(metaOk)} (${metaOk})
H1 OK:            ${pct(h1Ok)} (${h1Ok})
JSON-LD OK:       ${pct(jsonLdOk)} (${jsonLdOk})
Thin content:     ${pct(thinContent)} (${thinContent})
Very thin (<50w): ${pct(veryThinContent)} (${veryThinContent})
Duplicate titles: ${dups.dupTitles.length} groups
Duplicate desc:   ${dups.dupDescs.length} groups
Duplicate H1:     ${dups.dupH1s.length} groups
Canonical coll:   ${dups.dupCanonicals.length} groups
5xx:              ${http5xx}
404/410:          ${http404}
Timeouts:         ${timeouts}
Fetch errors:     ${errors}
\`\`\`

## Performance

\`\`\`text
Average response: ${avgRt}ms
p50:              ${p50}ms
p95:              ${p95}ms
p99:              ${p99}ms
Slow pages (>5s): ${slowPages}
\`\`\`

## Severity Distribution

| Severity | Count | % |
|----------|------:|---:|
| PASS | ${passCount} | ${pct(passCount)} |
| P2 | ${p2Count} | ${pct(p2Count)} |
| P1 | ${p1Count} | ${pct(p1Count)} |
| P0 | ${p0Count} | ${pct(p0Count)} |

## Top Issues

| Code | Count | Severity |
|------|------:|----------|
${topIssues.map(([code, count]) => {
  const sample = results.find(r => r.issues.find(i => i.code === code));
  const sev = sample?.issues.find(i => i.code === code)?.severity || "?";
  return `| ${code} | ${count} | ${sev} |`;
}).join("\n")}

## Duplicate Analysis

### Duplicate Titles (${dups.dupTitles.length} groups)
${dups.dupTitles.slice(0, 10).map(([title, icos]) => `- "${title.slice(0, 80)}" — ${icos.length} pages: ${icos.slice(0, 5).join(", ")}${icos.length > 5 ? "..." : ""}`).join("\n") || "None"}

### Duplicate Meta Descriptions (${dups.dupDescs.length} groups)
${dups.dupDescs.slice(0, 10).map(([desc, icos]) => `- "${desc.slice(0, 80)}" — ${icos.length} pages: ${icos.slice(0, 5).join(", ")}${icos.length > 5 ? "..." : ""}`).join("\n") || "None"}

### Duplicate H1s (${dups.dupH1s.length} groups)
${dups.dupH1s.slice(0, 10).map(([h1, icos]) => `- "${h1.slice(0, 80)}" — ${icos.length} pages: ${icos.slice(0, 5).join(", ")}${icos.length > 5 ? "..." : ""}`).join("\n") || "None"}

### Canonical Collisions (${dups.dupCanonicals.length} groups)
${dups.dupCanonicals.slice(0, 10).map(([canon, icos]) => `- ${canon} — ${icos.length} pages: ${icos.slice(0, 5).join(", ")}${icos.length > 5 ? "..." : ""}`).join("\n") || "None"}

## P0 Issues (Critical)

${results.filter(r => r.severity === "P0").slice(0, 20).map(r =>
  `- **${r.ico}** (${r.name || "?"}) — ${r.url}\n  ${r.issues.filter(i => i.severity === "P0").map(i => `  - [${i.code}] ${i.msg}`).join("\n")}`
).join("\n") || "None"}

## P1 Issues (Important) — Top 30

${results.filter(r => r.severity === "P1").slice(0, 30).map(r =>
  `- **${r.ico}** (${r.name || "?"}) — ${r.url}\n  ${r.issues.filter(i => i.severity === "P1").map(i => `  - [${i.code}] ${i.msg}`).join("\n")}`
).join("\n") || "None"}

## Sample P2 Issues — Top 20

${results.filter(r => r.severity === "P2").slice(0, 20).map(r =>
  `- **${r.ico}** — ${r.issues.filter(i => i.severity === "P2").map(i => `[${i.code}] ${i.msg}`).join("; ")}`
).join("\n") || "None"}

## Methodology

- **Sample selection:** Random sample from production DB (eligible legal forms: s.r.o., a.s., v.o.s., k.s.)
- **URL format:** \`/firma/{ico}-{slug}\` (canonical URL with slug)
- **HTTP checks:** Manual redirect following (up to 5), timeout ${TIMEOUT_MS}ms
- **HTML parsing:** Lightweight regex-based (no headless browser)
- **Concurrency:** ${CONCURRENCY} parallel requests
- **User-Agent:** VerifaSEOAudit/1.0 (+https://verifa.sk/bot)
- **noindex note:** Pages with <2 financial statements are intentionally noindex (quality gate). These are flagged for review but may be expected.

## Reproducibility

\`\`\`bash
# Re-run with same sample:
node scripts/seo-audit-company-pages.mjs --sample-size ${SAMPLE_SIZE} --seed ${SEED}

# Different sample:
node scripts/seo-audit-company-pages.mjs --sample-size 1000 --seed 999
\`\`\`
`;

  return report;
}

// ─── CSV output ──────────────────────────────────────────────
function toCSV(results) {
  const headers = [
    "ico", "name", "legalForm", "url", "httpStatus", "finalUrl", "responseTime",
    "redirectCount", "timedOut", "title", "metaDescription", "h1", "canonical",
    "robotsMeta", "xRobotsTag", "noindex", "jsonLdCount", "jsonLdValid",
    "jsonLdInvalid", "wordCount", "uniqueWordCount", "companyNameInContent",
    "internalLinks", "externalLinks", "severity", "issueCount", "issues",
  ];
  const rows = results.map(r => [
    r.ico, r.name, r.legalForm, r.url, r.httpStatus, r.finalUrl, r.responseTime,
    r.redirectCount, r.timedOut, r.title, r.metaDescription, r.h1.join(" | "),
    r.canonical, r.robotsMeta, r.xRobotsTag, r.noindex, r.jsonLdCount,
    r.jsonLdValid, r.jsonLdInvalid, r.wordCount, r.uniqueWordCount,
    r.companyNameInContent, r.internalLinks, r.externalLinks, r.severity,
    r.issues.length, r.issues.map(i => `${i.code}:${i.severity}`).join(";"),
  ]);
  return [headers.join(","), ...rows.map(row => row.map(cell => {
    const s = String(cell ?? "").replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  }).join(","))].join("\n");
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.error(`\nSEO Audit — Company Pages`);
  console.error(`  Sample size: ${SAMPLE_SIZE}`);
  console.error(`  Seed: ${SEED}`);
  console.error(`  Base URL: ${BASE_URL}`);
  console.error(`  Concurrency: ${CONCURRENCY}`);
  console.error(`  Timeout: ${TIMEOUT_MS}ms\n`);

  console.error("Fetching sample ICO list...");
  const sample = await fetchSampleIcos();

  // Shuffle with seeded PRNG for deterministic random sample
  for (let i = sample.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sample[i], sample[j]] = [sample[j], sample[i]];
  }
  const selected = sample.slice(0, Math.min(SAMPLE_SIZE, sample.length));
  console.error(`Selected ${selected.length} companies from ${sample.length} total.\n`);

  console.error("Starting audit...");
  const tasks = selected.map(company => () => auditUrl(company, BASE_URL));
  const results = await runWithConcurrency(tasks, CONCURRENCY);

  console.error("\nAnalyzing duplicates...");
  const dups = analyzeDuplicates(results);

  console.error("Generating reports...");
  writeFileSync(OUTPUT_JSON, JSON.stringify({
    metadata: {
      date: new Date().toISOString(),
      sampleSize: selected.length,
      seed: SEED,
      baseUrl: BASE_URL,
      concurrency: CONCURRENCY,
      timeout: TIMEOUT_MS,
    },
    summary: {
      total: results.length,
      http200: results.filter(r => r.httpStatus === 200).length,
      indexable: results.filter(r => r.httpStatus === 200 && !r.noindex).length,
      noindex: results.filter(r => r.noindex).length,
      p0: results.filter(r => r.severity === "P0").length,
      p1: results.filter(r => r.severity === "P1").length,
      p2: results.filter(r => r.severity === "P2").length,
      pass: results.filter(r => r.severity === "PASS").length,
    },
    duplicates: dups,
    results,
  }, null, 2));

  writeFileSync(OUTPUT_CSV, toCSV(results));
  const mdReport = generateReport(results, dups, selected.length, SEED);
  writeFileSync(OUTPUT_MD, mdReport);

  // Print executive summary to stdout
  const total = results.length;
  const http200 = results.filter(r => r.httpStatus === 200).length;
  const indexable = results.filter(r => r.httpStatus === 200 && !r.noindex).length;
  const p0 = results.filter(r => r.severity === "P0").length;
  const p1 = results.filter(r => r.severity === "P1").length;
  const p2 = results.filter(r => r.severity === "P2").length;
  const pass = results.filter(r => r.severity === "PASS").length;

  console.log("\n" + "=" .repeat(60));
  console.log("SEO AUDIT — EXECUTIVE SUMMARY");
  console.log("=".repeat(60));
  console.log(`Sample size:    ${total}`);
  console.log(`HTTP 200:       ${(http200/total*100).toFixed(1)}% (${http200})`);
  console.log(`Indexable:      ${(indexable/total*100).toFixed(1)}% (${indexable})`);
  console.log(`PASS:           ${(pass/total*100).toFixed(1)}% (${pass})`);
  console.log(`P0 (critical):  ${p0}`);
  console.log(`P1 (important): ${p1}`);
  console.log(`P2 (minor):     ${p2}`);
  console.log("=".repeat(60));
  console.log(`\nReports saved:`);
  console.log(`  ${OUTPUT_JSON}`);
  console.log(`  ${OUTPUT_CSV}`);
  console.log(`  ${OUTPUT_MD}`);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
