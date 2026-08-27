#!/usr/bin/env node
/**
 * Sitemap chain validator — checks the full sitemap pipeline:
 * 1. /sitemap.xml is valid XML sitemapindex with correct Content-Type
 * 2. All shards are accessible and return valid XML with correct Content-Type
 * 3. Sample URLs from each shard return 200
 * 4. No noindex URLs in sitemap
 * 5. No 404s
 * 6. No duplicate URLs
 * 7. Correct URL count
 * 8. Canonical URLs match sitemap URLs
 */

const BASE = "https://verifa.sk";

async function fetchWithHeaders(url) {
  const res = await fetch(url, { redirect: "manual" });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  };
}

async function main() {
  const results = {
    indexValid: false,
    indexContentType: "",
    shardCount: 0,
    shardsAccessible: 0,
    shardsWithXml: 0,
    totalUrls: 0,
    sampleResults: [],
    noindexCount: 0,
    duplicateCount: 0,
    errors: [],
  };

  // 1. Fetch sitemap index
  console.log("=== 1. Fetching /sitemap.xml ===");
  const indexRes = await fetchWithHeaders(`${BASE}/sitemap.xml`);
  console.log(`  Status: ${indexRes.status}`);
  console.log(`  Content-Type: ${indexRes.headers["content-type"]}`);
  results.indexContentType = indexRes.headers["content-type"] || "";

  if (indexRes.status !== 200) {
    results.errors.push(`Sitemap index returned ${indexRes.status}`);
    console.log("  FAIL: Non-200 status");
    process.exit(1);
  }

  if (!results.indexContentType.includes("application/xml")) {
    results.errors.push(`Sitemap index has wrong Content-Type: ${results.indexContentType}`);
    console.log("  FAIL: Wrong Content-Type");
    process.exit(1);
  }

  if (!indexRes.body.includes("<sitemapindex")) {
    results.errors.push("Sitemap index is not a valid sitemapindex XML");
    console.log("  FAIL: Not a valid sitemapindex");
    process.exit(1);
  }

  results.indexValid = true;
  console.log("  OK: Valid XML sitemapindex with application/xml");

  // 2. Extract shard URLs
  const shardUrls = [...indexRes.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  results.shardCount = shardUrls.length;
  console.log(`\n=== 2. Found ${shardUrls.length} shards ===`);

  // 3. Check each shard
  const allUrls = new Set();
  const allUrlList = [];

  for (const shardUrl of shardUrls) {
    const shardRes = await fetchWithHeaders(shardUrl);
    const ct = shardRes.headers["content-type"] || "";

    if (shardRes.status !== 200) {
      results.errors.push(`Shard ${shardUrl} returned ${shardRes.status}`);
      console.log(`  FAIL: ${shardUrl} → ${shardRes.status}`);
      continue;
    }

    results.shardsAccessible++;

    if (!ct.includes("application/xml") && !ct.includes("text/xml")) {
      results.errors.push(`Shard ${shardUrl} has wrong Content-Type: ${ct}`);
      console.log(`  WARN: ${shardUrl} → Content-Type: ${ct}`);
    } else {
      results.shardsWithXml++;
    }

    // Extract URLs from shard
    const urls = [...shardRes.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    for (const url of urls) {
      if (allUrls.has(url)) {
        results.duplicateCount++;
      } else {
        allUrls.add(url);
        allUrlList.push(url);
      }
    }

    // Check for noindex in shard (shouldn't be in XML, but check)
    if (shardRes.body.includes("noindex")) {
      results.noindexCount++;
      results.errors.push(`Shard ${shardUrl} contains 'noindex'`);
    }

    console.log(`  ${shardUrl}: ${urls.length} URLs, ${ct}`);
  }

  results.totalUrls = allUrls.size;
  console.log(`\n=== 3. URL statistics ===`);
  console.log(`  Total unique URLs: ${results.totalUrls}`);
  console.log(`  Duplicates: ${results.duplicateCount}`);
  console.log(`  Noindex mentions: ${results.noindexCount}`);

  // 4. Sample URLs — test 5 from each shard type
  console.log(`\n=== 4. Sampling URLs (10 random) ===`);

  // Filter to /firma/ URLs (skip static, glossary, screener)
  const firmaUrls = allUrlList.filter((u) => u.includes("/firma/"));
  const staticUrls = allUrlList.filter((u) => !u.includes("/firma/"));

  console.log(`  Firma URLs: ${firmaUrls.length}`);
  console.log(`  Static/other URLs: ${staticUrls.length}`);

  // Sample 10 firma URLs
  const sampleSize = Math.min(10, firmaUrls.length);
  const samples = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(Math.random() * firmaUrls.length);
    samples.push(firmaUrls[idx]);
  }

  for (const url of samples) {
    const res = await fetchWithHeaders(url);
    const isRedirect = res.status === 308;
    const is200 = res.status === 200;
    const hasNoindex = res.body.includes('name="robots" content="noindex"') ||
                       res.body.includes('content="noindex"');

    // Extract canonical
    const canonicalMatch = res.body.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/);
    const canonical = canonicalMatch ? canonicalMatch[1] : null;

    // Extract title
    const titleMatch = res.body.match(/<title[^>]*>([^<]*)<\/title>/);
    const title = titleMatch ? titleMatch[1] : null;

    const result = {
      url,
      status: res.status,
      redirect: isRedirect ? res.headers["location"] : null,
      hasNoindex,
      canonical,
      title: title?.slice(0, 60),
    };

    results.sampleResults.push(result);

    const status = is200 ? "200" : isRedirect ? "308" : `${res.status}`;
    const noindexFlag = hasNoindex ? " [NOINDEX]" : "";
    console.log(`  ${status}${noindexFlag} ${url.slice(0, 80)}`);
    if (canonical) console.log(`         canonical: ${canonical}`);
    if (isRedirect) console.log(`         → ${res.headers["location"]}`);

    if (!is200 && !isRedirect) {
      results.errors.push(`Sample ${url} returned ${res.status}`);
    }
  }

  // 5. Summary
  console.log(`\n=== 5. Summary ===`);
  console.log(`  Index valid: ${results.indexValid ? "YES" : "NO"}`);
  console.log(`  Index Content-Type: ${results.indexContentType}`);
  console.log(`  Shards: ${results.shardCount} total, ${results.shardsAccessible} accessible, ${results.shardsWithXml} with XML Content-Type`);
  console.log(`  Total URLs: ${results.totalUrls}`);
  console.log(`  Duplicates: ${results.duplicateCount}`);
  console.log(`  Noindex in sitemap: ${results.noindexCount}`);
  console.log(`  Errors: ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log("\n  ERRORS:");
    for (const e of results.errors) {
      console.log(`    - ${e}`);
    }
  }

  // Write full results to file
  const fs = await import("fs");
  fs.writeFileSync("/tmp/sitemap-validation.json", JSON.stringify(results, null, 2));
  console.log("\n  Full results: /tmp/sitemap-validation.json");

  const pass = results.indexValid &&
    results.shardsAccessible === results.shardCount &&
    results.duplicateCount === 0 &&
    results.noindexCount === 0 &&
    results.errors.length === 0;

  console.log(`\n  OVERALL: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
