#!/usr/bin/env node
/**
 * Content Uniqueness Audit
 *
 * Fetches 20 company pages and compares:
 *  - Template text (boilerplate that's the same on all pages)
 *  - Unique company data (name, city, NACE, financials)
 *  - Calculates unique_content_ratio
 *
 * Also compares pairs of companies to find near-identical pages.
 */

import { writeFileSync } from "fs";

const BASE = "https://verifa.sk";

async function fetchRaw(url) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body };
}

// Sample companies — different sizes, NACE, regions
const SAMPLES = [
  { ico: "50333836", slug: "europe-trade-s-r-o" },
  { ico: "31331136", slug: "slovnaft-a-s" },
  { ico: "36211541", slug: "mh-teplarensky-holding-a-s" },
  { ico: "31380239", slug: "byty-spol-s-r-o" },
  { ico: "35713049", slug: "elektro-connection-s-r-o" },
  { ico: "00112001", slug: "slovenska-energeticka-a-s" },
  { ico: "00112054", slug: "slovensky-plynarensky-priemysel-nafta-a-s" },
  { ico: "00113001", slug: "zeleznice-slovenskej-republiky" },
  { ico: "00151741", slug: "statne-pokladnica" },
  { ico: "00112054", slug: "spp-distribucia-a-s" },
  { ico: "31337759", slug: "tesco-stores-s-r-o" },
  { ico: "31822828", slug: "kaufland-slovenska-vzajomna-obchodna-spol-s-r-o" },
  { ico: "36637144", slug: "lidl-slovenska-republika-s-r-o" },
  { ico: "31647596", slug: "dm-drogerie-markt-s-r-o" },
  { ico: "31824746", slug: "orange-slovensko-a-s" },
  { ico: "31657596", slug: "slovenske-telekomunikacie-a-s" },
  { ico: "00309101", slug: "vse-vychodoslovenska-energetika-a-s" },
  { ico: "00192501", slug: "vse-zapadoslovenska-energetika-a-s" },
  { ico: "31331136", slug: "slovnaft-a-s" },
  { ico: "31337759", slug: "tesco-stores-s-r-o" },
];

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextBlocks(html) {
  // Process entire HTML — Next.js SSR streaming puts content outside <main>
  // Remove scripts, styles, JSON-LD, nav, footer, header
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    // Remove React streaming template tags
    .replace(/<template[^>]*>[\s\S]*?<\/template>/gi, "")
    // Remove HTML comments (React streaming markers)
    .replace(/<!--[\s\S]*?-->/g, "");

  return stripHtml(clean);
}

function tokenize(text) {
  return text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
}

function jaccardSimilarity(setA, setB) {
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

async function main() {
  console.log("=== Content Uniqueness Audit ===\n");
  console.log(`Fetching ${SAMPLES.length} company pages...\n`);

  const pages = [];

  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const url = `${BASE}/firma/${s.ico}-${s.slug}`;
    process.stdout.write(`  [${i + 1}] ${s.ico}...`);

    try {
      const res = await fetchRaw(url);
      if (res.status !== 200) {
        console.log(` FAIL (${res.status})`);
        continue;
      }

      const text = extractTextBlocks(res.body);
      const tokens = new Set(tokenize(text));

      pages.push({
        ico: s.ico,
        url,
        textLength: text.length,
        tokenCount: tokens.size,
        tokens,
        text,
      });

      console.log(` OK (${text.length} chars, ${tokens.size} unique tokens)`);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  if (pages.length < 2) {
    console.log("\nNot enough pages to compare.");
    return;
  }

  // ── 1. Template text detection ──────────────────────────────────────
  console.log("\n── 1. Template Text Detection ──");
  console.log("  (Tokens that appear in ALL pages = template/boilerplate)\n");

  // Find tokens that appear in all pages
  const allTokens = new Map();
  for (const page of pages) {
    for (const token of page.tokens) {
      allTokens.set(token, (allTokens.get(token) || 0) + 1);
    }
  }

  const templateTokens = [];
  const uniqueTokens = new Map();

  for (const [token, count] of allTokens) {
    if (count === pages.length) {
      templateTokens.push(token);
    }
    // Count how many pages have this token
    if (count === 1) {
      uniqueTokens.set(token, true);
    }
  }

  const templateTokenSet = new Set(templateTokens);

  console.log(`  Total unique tokens across all pages:  ${allTokens.size}`);
  console.log(`  Template tokens (in ALL pages):        ${templateTokens.length} (${(templateTokens.length / allTokens.size * 100).toFixed(1)}%)`);
  console.log(`  Unique tokens (in only 1 page):        ${uniqueTokens.size} (${(uniqueTokens.size / allTokens.size * 100).toFixed(1)}%)`);

  // ── 2. Per-page uniqueness ratio ────────────────────────────────────
  console.log("\n── 2. Per-Page Uniqueness Ratio ──");
  console.log("  (unique tokens / total tokens per page)\n");

  for (const page of pages) {
    const uniqueCount = [...page.tokens].filter((t) => !templateTokenSet.has(t)).length;
    const ratio = uniqueCount / page.tokenCount;
    page.uniqueRatio = ratio;
    page.uniqueCount = uniqueCount;
    console.log(`  ${page.ico}  unique=${uniqueCount}/${page.tokenCount} (${(ratio * 100).toFixed(1)}%)  total=${page.textLength} chars`);
  }

  // ── 3. Pairwise similarity (Jaccard) ────────────────────────────────
  console.log("\n── 3. Pairwise Similarity (Jaccard) ──");
  console.log("  (0 = completely different, 1 = identical)\n");

  const similarities = [];
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const sim = jaccardSimilarity(pages[i].tokens, pages[j].tokens);
      similarities.push({ a: pages[i].ico, b: pages[j].ico, similarity: sim });
    }
  }

  similarities.sort((a, b) => b.similarity - a.similarity);

  console.log("  Top 10 most similar pairs:");
  for (const s of similarities.slice(0, 10)) {
    console.log(`    ${s.a} vs ${s.b}: ${(s.similarity * 100).toFixed(1)}%`);
  }

  console.log("\n  Top 10 most different pairs:");
  for (const s of similarities.slice(-10).reverse()) {
    console.log(`    ${s.a} vs ${s.b}: ${(s.similarity * 100).toFixed(1)}%`);
  }

  // ── 4. Statistics ───────────────────────────────────────────────────
  console.log("\n── 4. Statistics ──\n");

  const avgSimilarity = similarities.reduce((sum, s) => sum + s.similarity, 0) / similarities.length;
  const maxSim = Math.max(...similarities.map((s) => s.similarity));
  const minSim = Math.min(...similarities.map((s) => s.similarity));
  const avgUniqueRatio = pages.reduce((sum, p) => sum + p.uniqueRatio, 0) / pages.length;
  const avgTextLength = pages.reduce((sum, p) => sum + p.textLength, 0) / pages.length;

  console.log(`  Avg text length:           ${avgTextLength.toFixed(0)} chars`);
  console.log(`  Avg unique token count:    ${(pages.reduce((sum, p) => sum + p.uniqueCount, 0) / pages.length).toFixed(0)}`);
  console.log(`  Avg uniqueness ratio:      ${(avgUniqueRatio * 100).toFixed(1)}%`);
  console.log(`  Avg pairwise similarity:   ${(avgSimilarity * 100).toFixed(1)}%`);
  console.log(`  Max pairwise similarity:   ${(maxSim * 100).toFixed(1)}%`);
  console.log(`  Min pairwise similarity:   ${(minSim * 100).toFixed(1)}%`);

  // ── 5. Template content sample ──────────────────────────────────────
  console.log("\n── 5. Template Tokens (boilerplate) ──");
  console.log(`  First 50 template tokens: ${templateTokens.slice(0, 50).join(", ")}\n`);

  // ── 6. Assessment ───────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CONTENT UNIQUENESS ASSESSMENT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`  Pages analyzed:            ${pages.length}`);
  console.log(`  Avg text content:          ${avgTextLength.toFixed(0)} chars`);
  console.log(`  Avg uniqueness ratio:      ${(avgUniqueRatio * 100).toFixed(1)}%`);
  console.log(`  Avg pairwise similarity:   ${(avgSimilarity * 100).toFixed(1)}%`);
  console.log();

  if (avgUniqueRatio > 0.5) {
    console.log("  ✅ Good uniqueness — >50% of content is unique per page");
  } else if (avgUniqueRatio > 0.3) {
    console.log("  ⚠️  Moderate uniqueness — 30-50% unique content");
    console.log("     Google may see these as similar pages");
  } else {
    console.log("  ❌ Low uniqueness — <30% unique content");
    console.log("     High risk of 'Duplicate, Google chose different canonical'");
  }

  if (maxSim > 0.8) {
    console.log(`  ❌ High similarity pair found (${(maxSim * 100).toFixed(1)}%) — near-identical pages`);
  } else if (avgSimilarity > 0.5) {
    console.log(`  ⚠️  Average similarity is high (${(avgSimilarity * 100).toFixed(1)}%)`);
  } else {
    console.log(`  ✅ Similarity is acceptable (avg ${(avgSimilarity * 100).toFixed(1)}%)`);
  }

  writeFileSync("/tmp/content-uniqueness.json", JSON.stringify({
    pages: pages.map((p) => ({ ico: p.ico, textLength: p.textLength, tokenCount: p.tokenCount, uniqueCount: p.uniqueCount, uniqueRatio: p.uniqueRatio })),
    similarities,
    stats: { avgSimilarity, maxSim, minSim, avgUniqueRatio, avgTextLength },
    templateTokens: templateTokens.slice(0, 100),
  }, null, 2));
  console.log("\n  Full JSON report: /tmp/content-uniqueness.json");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
