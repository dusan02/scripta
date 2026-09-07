/**
 * Tests for SEO URL architecture — slug mapping, indexability policy, legacy redirects.
 * Run with: npx tsx src/lib/__tests__/seo-url.test.ts
 */

import {
  naceSectionToSlug,
  slugToNaceSection,
  krajToSlug,
  slugToKraj,
  buildNaceCanonicalPath,
  buildNaceKrajCanonicalPath,
  buildNaceCityCanonicalPath,
  isIndexableSeoRoute,
  isLegacyOdvetviePath,
  resolveLegacyOdvetviePath,
  getAllNaceSlugs,
  getAllKrajSlugs,
} from "../seo-url";

function testNaceSlugMapping() {
  console.log("Test 1: NACE section → slug mapping");

  // Section I = Ubytovanie a stravovanie
  const slugI = naceSectionToSlug("I");
  if (slugI !== "ubytovanie-a-stravovanie") {
    throw new Error(`FAIL: Section I should be "ubytovanie-a-stravovanie", got "${slugI}"`);
  }
  console.log('  PASS: I → "ubytovanie-a-stravovanie"');

  // Section F = Stavebníctvo
  const slugF = naceSectionToSlug("F");
  if (slugF !== "stavebnictvo") {
    throw new Error(`FAIL: Section F should be "stavebnictvo", got "${slugF}"`);
  }
  console.log('  PASS: F → "stavebnictvo"');

  // Reverse mapping
  const sectionI = slugToNaceSection("ubytovanie-a-stravovanie");
  if (sectionI !== "I") {
    throw new Error(`FAIL: "ubytovanie-a-stravovanie" should be I, got "${sectionI}"`);
  }
  console.log('  PASS: "ubytovanie-a-stravovanie" → I');

  // Invalid section
  if (naceSectionToSlug("Z") !== null) {
    throw new Error("FAIL: Invalid section Z should return null");
  }
  console.log("  PASS: Invalid section Z → null");

  // Case insensitive
  if (naceSectionToSlug("i") !== "ubytovanie-a-stravovanie") {
    throw new Error("FAIL: lowercase 'i' should work");
  }
  console.log("  PASS: Case insensitive");

  // All 21 sections have slugs
  const allSlugs = getAllNaceSlugs();
  if (allSlugs.length !== 21) {
    throw new Error(`FAIL: Expected 21 NACE slugs, got ${allSlugs.length}`);
  }
  for (const s of allSlugs) {
    if (!s.slug || s.slug.length < 3) {
      throw new Error(`FAIL: Section ${s.section} has invalid slug "${s.slug}"`);
    }
  }
  console.log("  PASS: All 21 sections have valid slugs");
}

function testKrajSlugMapping() {
  console.log("Test 2: Kraj → slug mapping");

  const slug = krajToSlug("SK010");
  if (slug !== "bratislavsky-kraj") {
    throw new Error(`FAIL: SK010 should be "bratislavsky-kraj", got "${slug}"`);
  }
  console.log('  PASS: SK010 → "bratislavsky-kraj"');

  const reverse = slugToKraj("bratislavsky-kraj");
  if (reverse !== "SK010") {
    throw new Error(`FAIL: "bratislavsky-kraj" should be SK010, got "${reverse}"`);
  }
  console.log('  PASS: "bratislavsky-kraj" → SK010');

  // All 8 kraje have slugs
  const allKrajSlugs = getAllKrajSlugs();
  if (allKrajSlugs.length !== 8) {
    throw new Error(`FAIL: Expected 8 kraj slugs, got ${allKrajSlugs.length}`);
  }
  console.log("  PASS: All 8 kraje have valid slugs");
}

function testCanonicalPathBuilders() {
  console.log("Test 3: Canonical path builders");

  // NACE canonical
  const nacePath = buildNaceCanonicalPath("I");
  if (nacePath !== "/firmy/ubytovanie-a-stravovanie") {
    throw new Error(`FAIL: NACE I canonical should be /firmy/ubytovanie-a-stravovanie, got "${nacePath}"`);
  }
  console.log('  PASS: /firmy/ubytovanie-a-stravovanie');

  // NACE × kraj canonical
  const naceKrajPath = buildNaceKrajCanonicalPath("I", "SK010");
  if (naceKrajPath !== "/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj") {
    throw new Error(`FAIL: NACE I × SK010 canonical should be /firmy/ubytovanie-a-stravovanie/bratislavsky-kraj, got "${naceKrajPath}"`);
  }
  console.log('  PASS: /firmy/ubytovanie-a-stravovanie/bratislavsky-kraj');

  // NACE × city canonical
  const naceCityPath = buildNaceCityCanonicalPath("I", "Bratislava");
  if (naceCityPath !== "/firmy/ubytovanie-a-stravovanie/bratislava") {
    throw new Error(`FAIL: NACE I × Bratislava canonical should be /firmy/ubytovanie-a-stravovanie/bratislava, got "${naceCityPath}"`);
  }
  console.log('  PASS: /firmy/ubytovanie-a-stravovanie/bratislava');

  // Invalid inputs
  if (buildNaceCanonicalPath("Z") !== null) {
    throw new Error("FAIL: Invalid section Z should return null");
  }
  if (buildNaceKrajCanonicalPath("I", "SK999") !== null) {
    throw new Error("FAIL: Invalid kraj SK999 should return null");
  }
  console.log("  PASS: Invalid inputs return null");
}

function testIndexabilityPolicy() {
  console.log("Test 4: Indexability policy (isIndexableSeoRoute)");

  // Indexable routes
  const indexable = [
    "/",
    "/firmy",
    "/firmy/ubytovanie-a-stravovanie",
    "/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj",
    "/firmy/ubytovanie-a-stravovanie/bratislava",
    "/firma/36199222-us-steel-kosice",
    "/kraj/SK010",
    "/okres/SK0101",
    "/mesto/bratislava",
    "/slovnik/altman-z-score",
    "/pricing",
    "/register",
  ];
  for (const path of indexable) {
    if (!isIndexableSeoRoute(path)) {
      throw new Error(`FAIL: "${path}" should be indexable`);
    }
  }
  console.log(`  PASS: ${indexable.length} indexable routes verified`);

  // Non-indexable routes (by pattern — not in INDEXABLE_SEO_PATTERNS)
  const nonIndexable = [
    "/screener?naceSection=I",
    "/screener",
    "/api/health",
    "/admin",
    "/dashboard",
    "/login",
    "/odvetvie/I", // legacy — should redirect, not index
    "/odvetvie/I/SK010", // legacy — should redirect, not index
  ];
  for (const path of nonIndexable) {
    if (isIndexableSeoRoute(path)) {
      throw new Error(`FAIL: "${path}" should NOT be indexable (not in pattern list)`);
    }
  }
  console.log(`  PASS: ${nonIndexable.length} non-indexable routes verified`);

  // Note: /firmy/{nace}/{intent} like /firmy/ubytovanie-a-stravovanie/najvacsie
  // MATCHES the pattern /^\/firmy\/[a-z0-9-]+\/[a-z0-9-]+$/ — this is expected.
  // The pattern is a NECESSARY but NOT SUFFICIENT condition for indexability.
  // At runtime, the page resolves the sub-slug: if it's not a valid kraj or city,
  // it returns 404 (notFound()). Intent slugs (najvacsie, etc.) are P2 and will
  // be handled by a whitelist when implemented.
}

function testLegacyRedirects() {
  console.log("Test 5: Legacy /odvetvie/ path detection and resolution");

  // Detect legacy paths
  if (!isLegacyOdvetviePath("/odvetvie/I")) {
    throw new Error('FAIL: "/odvetvie/I" should be detected as legacy');
  }
  if (!isLegacyOdvetviePath("/odvetvie/I/SK010")) {
    throw new Error('FAIL: "/odvetvie/I/SK010" should be detected as legacy');
  }
  if (isLegacyOdvetviePath("/firmy/ubytovanie-a-stravovanie")) {
    throw new Error('FAIL: "/firmy/..." should NOT be detected as legacy');
  }
  console.log("  PASS: Legacy path detection works");

  // Resolve legacy paths
  const resolved1 = resolveLegacyOdvetviePath("/odvetvie/I");
  if (resolved1 !== "/firmy/ubytovanie-a-stravovanie") {
    throw new Error(`FAIL: /odvetvie/I should resolve to /firmy/ubytovanie-a-stravovanie, got "${resolved1}"`);
  }
  console.log('  PASS: /odvetvie/I → /firmy/ubytovanie-a-stravovanie');

  const resolved2 = resolveLegacyOdvetviePath("/odvetvie/I/SK010");
  if (resolved2 !== "/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj") {
    throw new Error(`FAIL: /odvetvie/I/SK010 should resolve to /firmy/ubytovanie-a-stravovanie/bratislavsky-kraj, got "${resolved2}"`);
  }
  console.log('  PASS: /odvetvie/I/SK010 → /firmy/ubytovanie-a-stravovanie/bratislavsky-kraj');

  // Unresolvable legacy path
  const resolved3 = resolveLegacyOdvetviePath("/odvetvie/Z");
  if (resolved3 !== null) {
    throw new Error(`FAIL: /odvetvie/Z should return null, got "${resolved3}"`);
  }
  console.log("  PASS: /odvetvie/Z → null (invalid section)");
}

function testSlugUniqueness() {
  console.log("Test 6: Slug uniqueness — no collisions between NACE and kraj slugs");

  const naceSlugs = new Set(getAllNaceSlugs().map((s) => s.slug));
  const krajSlugs = new Set(getAllKrajSlugs().map((k) => k.slug));

  // Check for collisions
  const krajSlugArr = Array.from(krajSlugs);
  for (const krajSlug of krajSlugArr) {
    if (naceSlugs.has(krajSlug)) {
      throw new Error(`FAIL: Slug "${krajSlug}" is both a NACE slug and a kraj slug — collision!`);
    }
  }
  console.log("  PASS: No NACE/kraj slug collisions");

  // Check NACE slugs are unique among themselves
  if (naceSlugs.size !== 21) {
    throw new Error(`FAIL: Expected 21 unique NACE slugs, got ${naceSlugs.size}`);
  }
  console.log("  PASS: 21 unique NACE slugs");

  // Check kraj slugs are unique among themselves
  if (krajSlugs.size !== 8) {
    throw new Error(`FAIL: Expected 8 unique kraj slugs, got ${krajSlugs.size}`);
  }
  console.log("  PASS: 8 unique kraj slugs");
}

function main() {
  console.log("=== SEO URL Architecture Tests ===\n");

  testNaceSlugMapping();
  console.log();
  testKrajSlugMapping();
  console.log();
  testCanonicalPathBuilders();
  console.log();
  testIndexabilityPolicy();
  console.log();
  testLegacyRedirects();
  console.log();
  testSlugUniqueness();

  console.log("\n=== ALL TESTS PASSED ===");
}

main();
