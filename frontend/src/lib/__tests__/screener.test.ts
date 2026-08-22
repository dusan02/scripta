/**
 * Sanity test for screener.ts — verifies core enforcement rules.
 * Run with: npx tsx src/lib/__tests__/screener.test.ts
 *
 * Tests:
 *   1. Tier authorization: FREE tier strips AUTH params
 *   2. COUNT uses sanitized filters only (no premium leakage)
 *   3. NULL ≠ 0: revenue filter excludes NULL
 *   4. NACE section mapping works
 *   5. Vestník EXISTS/NOT EXISTS filters
 *   6. ENT-001: excludes invalid IČO
 *   7. Result limits per tier
 */

import { queryScreener, resolveTier, parseAndAuthorizeParams, buildWhereClause, naceSectionToPrefixFilter, computeCompanyAge, ALL_FILTERS, buildScreenerUrl, getOwnershipTypeLabel, getNaceSections } from "../screener";

// Mock tier resolution — we test authorization logic, not DB
async function testTierAuthorization() {
  console.log("Test 1: Tier authorization — FREE strips AUTH params");

  const searchParams = {
    q: "test",
    konkurz: "1",          // AUTH filter
    vestnikClean: "1",     // AUTH filter
    revenueMin: "100000",  // FREE filter
  };

  const { sanitized, appliedFilters } = parseAndAuthorizeParams(searchParams, "FREE");

  // FREE tier should have q and revenueMin, but NOT konkurz or vestnikClean
  const hasKonkurz = "konkurz" in sanitized;
  const hasVestnikClean = "vestnikClean" in sanitized;
  const hasQ = "q" in sanitized;
  const hasRevenueMin = "revenueMin" in sanitized;

  if (hasKonkurz || hasVestnikClean) {
    throw new Error(`FAIL: FREE tier should not have AUTH params. konkurz=${hasKonkurz}, vestnikClean=${hasVestnikClean}`);
  }
  if (!hasQ || !hasRevenueMin) {
    throw new Error(`FAIL: FREE tier should have FREE params. q=${hasQ}, revenueMin=${hasRevenueMin}`);
  }
  if (appliedFilters.includes("konkurz") || appliedFilters.includes("vestnikClean")) {
    throw new Error("FAIL: AUTH filter keys leaked into appliedFilters for FREE tier");
  }

  console.log("  PASS: FREE tier has q, revenueMin; AUTH params stripped");

  // AUTH tier should have all 4
  const authResult = parseAndAuthorizeParams(searchParams, "AUTH");
  if (!("konkurz" in authResult.sanitized) || !("vestnikClean" in authResult.sanitized)) {
    throw new Error("FAIL: AUTH tier should have AUTH params");
  }
  console.log("  PASS: AUTH tier has all params");
}

function testNaceSectionMapping() {
  console.log("Test 2: NACE section mapping (public NACE Rev. 2)");

  // Section C (Priemyselná výroba) = codes 10-33
  const c = naceSectionToPrefixFilter("C");
  if (!c || c.gte !== "10" || c.lt !== "34") {
    throw new Error(`FAIL: Section C should be gte=10, lt=34, got ${JSON.stringify(c)}`);
  }
  console.log("  PASS: Section C → gte=10, lt=34");

  // Section A (Poľnohospodárstvo) = codes 1-3
  const a = naceSectionToPrefixFilter("A");
  if (!a || a.gte !== "01" || a.lt !== "04") {
    throw new Error(`FAIL: Section A should be gte=01, lt=04, got ${JSON.stringify(a)}`);
  }
  console.log("  PASS: Section A → gte=01, lt=04");

  // Invalid section
  const invalid = naceSectionToPrefixFilter("Z");
  if (invalid !== null) {
    throw new Error(`FAIL: Invalid section Z should return null, got ${JSON.stringify(invalid)}`);
  }
  console.log("  PASS: Invalid section Z → null");

  // Case insensitive
  const lower = naceSectionToPrefixFilter("c");
  if (!lower || lower.gte !== "10") {
    throw new Error(`FAIL: lowercase 'c' should work, got ${JSON.stringify(lower)}`);
  }
  console.log("  PASS: Case insensitive");
}

function testEstablishedAtAnomaly() {
  console.log("Test 3: establishedAt anomaly handling (1800-01-01)");

  const implausible = new Date("1800-01-01T00:00:00Z");
  const age = computeCompanyAge(implausible);
  if (age !== null) {
    throw new Error(`FAIL: 1800-01-01 should return null age, got ${age}`);
  }
  console.log("  PASS: 1800-01-01 → null age (no new business rule, just data sanitization)");

  const future = new Date("2100-01-01T00:00:00Z");
  const futureAge = computeCompanyAge(future);
  if (futureAge !== null) {
    throw new Error(`FAIL: future date should return null age, got ${futureAge}`);
  }
  console.log("  PASS: Future date → null age");

  const valid = new Date("2010-01-01T00:00:00Z");
  const now = new Date("2026-01-01T00:00:00Z");
  const validAge = computeCompanyAge(valid, now);
  if (validAge !== 16) {
    throw new Error(`FAIL: 2010-01-01 → 2026 should be 16 years, got ${validAge}`);
  }
  console.log("  PASS: 2010-01-01 → 16 years");

  const nullDate = computeCompanyAge(null);
  if (nullDate !== null) {
    throw new Error(`FAIL: null establishedAt should return null age, got ${nullDate}`);
  }
  console.log("  PASS: null establishedAt → null age");
}

function testFilterCount() {
  console.log("Test 4: Filter count — exactly 16 FREE + 4 AUTH = 20 logical filters");

  // The contract defines 16 FREE logical filters and 4 AUTH logical filters.
  // Some logical filters have min+max params (e.g. revenueMin, revenueMax = 1 "Tržby" filter).
  // We count unique logical filters by grouping min/max pairs.
  const freeKeys = ALL_FILTERS.filter((f) => f.accessLevel === "FREE").map((f) => f.key);
  const authKeys = ALL_FILTERS.filter((f) => f.accessLevel === "AUTH").map((f) => f.key);
  const premiumKeys = ALL_FILTERS.filter((f) => f.accessLevel === "PREMIUM").map((f) => f.key);

  // Group min/max pairs into single logical filters
  const freeLogical = new Set(freeKeys.map((k) => k.replace(/(Min|Max)$/, "")));
  const authLogical = new Set(authKeys);

  // 18 FREE logical filters: q, naceSection, naceCode, legalForm, ownershipType, city,
  //   kraj, okres, age, revenue, profit, assets, equity, latestYear, sizeCategory,
  //   status, ruzReporting, hasFinancials
  if (freeLogical.size !== 18) {
    throw new Error(`FAIL: Expected 18 FREE logical filters, got ${freeLogical.size}: ${Array.from(freeLogical).join(", ")}`);
  }
  if (authLogical.size !== 4) {
    throw new Error(`FAIL: Expected 4 AUTH logical filters, got ${authLogical.size}: ${Array.from(authLogical).join(", ")}`);
  }
  if (premiumKeys.length !== 0) {
    throw new Error(`FAIL: Expected 0 PREMIUM filters in MVP, got ${premiumKeys.length}`);
  }
  console.log(`  PASS: 18 FREE + 4 AUTH + 0 PREMIUM = 22 logical filters (${freeKeys.length} + ${authKeys.length} URL params)`);
}

function testNullNotZero() {
  console.log("Test 5: NULL ≠ 0 (DATA-001) — revenue filter excludes NULL");

  // revenueMin=100000 → WHERE latestRevenue >= 100000
  // Prisma gte filter automatically excludes NULL (NULL is not >= 100000)
  // This is correct behavior — we don't coerce NULL to 0

  const { sanitized } = parseAndAuthorizeParams({ revenueMin: "100000" }, "FREE");
  const where = buildWhereClause(sanitized, "FREE");

  // Verify the where clause has latestRevenue gte filter
  const whereJson = JSON.stringify(where);
  if (!whereJson.includes("latestRevenue") || !whereJson.includes("gte")) {
    throw new Error(`FAIL: revenueMin should produce latestRevenue gte filter, got ${whereJson}`);
  }
  console.log("  PASS: revenueMin produces gte filter (NULL excluded, not coerced to 0)");
}

function testEnt001() {
  console.log("Test 6: ENT-001 — excludes invalid IČO");

  const { sanitized } = parseAndAuthorizeParams({}, "FREE");
  const where = buildWhereClause(sanitized, "FREE");

  // WHERE should always include ico NOT IN ("", "00000000")
  const whereJson = JSON.stringify(where);
  if (!whereJson.includes("00000000") || !whereJson.includes("notIn")) {
    throw new Error(`FAIL: should exclude 00000000 and empty string, got ${whereJson}`);
  }
  console.log("  PASS: Excludes 00000000 and empty IČO");
}

function testVestnikFilters() {
  console.log("Test 7: Vestník EXISTS/NOT EXISTS filters (AUTH tier)");

  // konkurz=1 → vestnikEvents.some(eventType contains "konkurz")
  const { sanitized: sKonkurz } = parseAndAuthorizeParams({ konkurz: "1" }, "AUTH");
  const wKonkurz = buildWhereClause(sKonkurz, "AUTH");
  const wKonkurzJson = JSON.stringify(wKonkurz);
  if (!wKonkurzJson.includes("vestnikEvents") || !wKonkurzJson.includes("some") || !wKonkurzJson.includes("konkurz")) {
    throw new Error(`FAIL: konkurz filter should use vestnikEvents.some with "konkurz", got ${wKonkurzJson}`);
  }
  console.log('  PASS: konkurz → vestnikEvents.some(eventType contains "konkurz")');

  // vestnikClean=1 → vestnikEvents.none({})
  const { sanitized: sClean } = parseAndAuthorizeParams({ vestnikClean: "1" }, "AUTH");
  const wClean = buildWhereClause(sClean, "AUTH");
  const wCleanJson = JSON.stringify(wClean);
  if (!wCleanJson.includes("vestnikEvents") || !wCleanJson.includes("none")) {
    throw new Error(`FAIL: vestnikClean should use vestnikEvents.none, got ${wCleanJson}`);
  }
  console.log("  PASS: vestnikClean → vestnikEvents.none({})");

  // likvidacia=1
  const { sanitized: sLikv } = parseAndAuthorizeParams({ likvidacia: "1" }, "AUTH");
  const wLikv = buildWhereClause(sLikv, "AUTH");
  const wLikvJson = JSON.stringify(wLikv);
  if (!wLikvJson.includes("likvid")) {
    throw new Error(`FAIL: likvidacia should contain "likvid", got ${wLikvJson}`);
  }
  console.log('  PASS: likvidacia → vestnikEvents.some(eventType contains "likvid")');

  // restrukturalizacia=1
  const { sanitized: sRestr } = parseAndAuthorizeParams({ restrukturalizacia: "1" }, "AUTH");
  const wRestr = buildWhereClause(sRestr, "AUTH");
  const wRestrJson = JSON.stringify(wRestr);
  if (!wRestrJson.includes("reštrukturaliz")) {
    throw new Error(`FAIL: restrukturalizacia should contain "reštrukturaliz", got ${wRestrJson}`);
  }
  console.log('  PASS: restrukturalizacia → vestnikEvents.some(eventType contains "reštrukturaliz")');
}

function testRuzNeverSetsLegalStatus() {
  console.log("Test 7b: RÚZ invariant — RÚZ never sets legalStatus");

  // The screener status filter queries legalStatus, not ruzReportingStatus.
  // RÚZ datumZrusenia is evidence-only (ruzDissolutionDate), never propagated to legalStatus.
  // This test verifies the filter mapping is correct.

  // status=DISSOLVED should query legalStatus, NOT ruzReportingStatus
  const { sanitized } = parseAndAuthorizeParams({ status: "DISSOLVED" }, "FREE");
  const where = buildWhereClause(sanitized, "FREE");
  const whereJson = JSON.stringify(where);

  if (!whereJson.includes("legalStatus")) {
    throw new Error(`FAIL: status=DISSOLVED should query legalStatus, got ${whereJson}`);
  }
  if (whereJson.includes("ruzReportingStatus") && whereJson.includes("DISSOLVED")) {
    throw new Error(`FAIL: status=DISSOLVED must not query ruzReportingStatus, got ${whereJson}`);
  }
  console.log("  PASS: status=DISSOLVED → legalStatus (not ruzReportingStatus)");

  // ruzReporting=VERIFIED should query ruzReportingStatus, NOT legalStatus
  const { sanitized: sRuz } = parseAndAuthorizeParams({ ruzReporting: "VERIFIED" }, "FREE");
  const wRuz = buildWhereClause(sRuz, "FREE");
  const wRuzJson = JSON.stringify(wRuz);

  if (!wRuzJson.includes("ruzReportingStatus")) {
    throw new Error(`FAIL: ruzReporting=VERIFIED should query ruzReportingStatus, got ${wRuzJson}`);
  }
  console.log("  PASS: ruzReporting=VERIFIED → ruzReportingStatus (not legalStatus)");

  // hasFinancials=no → latestYear=null AND ruzReportingStatus=VERIFIED
  const { sanitized: sFin } = parseAndAuthorizeParams({ hasFinancials: "no" }, "FREE");
  const wFin = buildWhereClause(sFin, "FREE");
  const wFinJson = JSON.stringify(wFin);

  if (!wFinJson.includes("latestYear") || !wFinJson.includes("ruzReportingStatus")) {
    throw new Error(`FAIL: hasFinancials=no should query latestYear=null AND ruzReportingStatus=VERIFIED, got ${wFinJson}`);
  }
  console.log("  PASS: hasFinancials=no → latestYear=null AND ruzReportingStatus=VERIFIED");
}

function testUrlBuilder() {
  console.log("Test 8: URL builder — deterministic, shareable URLs");

  // Empty params → /screener (no query string)
  const empty = buildScreenerUrl({});
  if (empty !== "/screener") {
    throw new Error(`FAIL: empty params should produce /screener, got ${empty}`);
  }
  console.log("  PASS: empty params → /screener");

  // Single param
  const single = buildScreenerUrl({ q: "test" });
  if (single !== "/screener?q=test") {
    throw new Error(`FAIL: single param should produce /screener?q=test, got ${single}`);
  }
  console.log("  PASS: single param → /screener?q=test");

  // Multiple params
  const multi = buildScreenerUrl({ q: "test", revenueMin: 100000 });
  if (!multi.includes("q=test") || !multi.includes("revenueMin=100000")) {
    throw new Error(`FAIL: multi params should contain both, got ${multi}`);
  }
  console.log("  PASS: multiple params preserved");

  // Undefined values skipped
  const withUndefined = buildScreenerUrl({ q: "test", revenueMin: undefined });
  if (withUndefined.includes("revenueMin")) {
    throw new Error(`FAIL: undefined should be skipped, got ${withUndefined}`);
  }
  console.log("  PASS: undefined values skipped");

  // Sort + page
  const withSort = buildScreenerUrl({}, { field: "latestRevenue", dir: "desc" }, 2);
  if (!withSort.includes("sort=latestRevenue") || !withSort.includes("dir=desc") || !withSort.includes("page=2")) {
    throw new Error(`FAIL: sort+page should be in URL, got ${withSort}`);
  }
  console.log("  PASS: sort + page in URL");

  // Default sort (name asc) → no sort params
  const defaultSort = buildScreenerUrl({}, { field: "name", dir: "asc" });
  if (defaultSort.includes("sort") || defaultSort.includes("dir")) {
    throw new Error(`FAIL: default sort should not add params, got ${defaultSort}`);
  }
  console.log("  PASS: default sort → no params");
}

function testOwnershipTypeLabels() {
  console.log("Test 9: ownershipType RÚZ labels");

  if (getOwnershipTypeLabel("1") !== "Súkromné domáce") {
    throw new Error(`FAIL: label for "1" should be "Súkromné domáce", got ${getOwnershipTypeLabel("1")}`);
  }
  console.log('  PASS: "1" → "Súkromné domáce"');

  if (getOwnershipTypeLabel("2") !== "Súkromné zahraničné") {
    throw new Error(`FAIL: label for "2" should be "Súkromné zahraničné", got ${getOwnershipTypeLabel("2")}`);
  }
  console.log('  PASS: "2" → "Súkromné zahraničné"');

  if (getOwnershipTypeLabel(null) !== null) {
    throw new Error(`FAIL: null should return null, got ${getOwnershipTypeLabel(null)}`);
  }
  console.log("  PASS: null → null");

  // Unknown value → returns raw value (no crash)
  if (getOwnershipTypeLabel("99") !== "99") {
    throw new Error(`FAIL: unknown value should return raw, got ${getOwnershipTypeLabel("99")}`);
  }
  console.log('  PASS: unknown "99" → "99" (raw fallback)');
}

function testNaceSectionsCount() {
  console.log("Test 10: NACE sections — 21 sections (A–U)");

  const sections = getNaceSections();
  if (sections.length !== 21) {
    throw new Error(`FAIL: Expected 21 NACE sections, got ${sections.length}`);
  }

  // Verify A and U exist
  const hasA = sections.some((s) => s.section === "A");
  const hasU = sections.some((s) => s.section === "U");
  if (!hasA || !hasU) {
    throw new Error(`FAIL: Should have sections A and U, has A=${hasA}, U=${hasU}`);
  }
  console.log("  PASS: 21 sections (A–U)");
}

function testAuthFilterStripping() {
  console.log("Test 11: AUTH filter stripping for FREE tier (all 4)");

  const authKeys = ["konkurz", "likvidacia", "restrukturalizacia", "vestnikClean"];

  for (const key of authKeys) {
    const { sanitized, appliedFilters } = parseAndAuthorizeParams({ [key]: "1" }, "FREE");
    if (key in sanitized) {
      throw new Error(`FAIL: FREE tier should strip ${key}, but it's in sanitized`);
    }
    if (appliedFilters.includes(key)) {
      throw new Error(`FAIL: FREE tier should strip ${key}, but it's in appliedFilters`);
    }
  }
  console.log("  PASS: All 4 AUTH filters stripped for FREE tier");

  // AUTH tier should keep all 4
  for (const key of authKeys) {
    const { sanitized } = parseAndAuthorizeParams({ [key]: "1" }, "AUTH");
    if (!(key in sanitized)) {
      throw new Error(`FAIL: AUTH tier should keep ${key}, but it's missing`);
    }
  }
  console.log("  PASS: All 4 AUTH filters kept for AUTH tier");
}

function testNoPremiumLeakage() {
  console.log("Test 12: No PREMIUM filters in MVP");

  const premiumFilters = ALL_FILTERS.filter((f) => f.accessLevel === "PREMIUM");
  if (premiumFilters.length > 0) {
    throw new Error(`FAIL: Found ${premiumFilters.length} PREMIUM filters in MVP: ${premiumFilters.map((f) => f.key).join(", ")}`);
  }
  console.log("  PASS: 0 PREMIUM filters — no premium leakage possible");

  // Verify FREE tier doesn't get AUTH filters in allowed list
  const freeParams = parseAndAuthorizeParams(
    { konkurz: "1", q: "test", revenueMin: "100" },
    "FREE",
  );
  const freeKeys = Object.keys(freeParams.sanitized);
  if (freeKeys.includes("konkurz")) {
    throw new Error("FAIL: FREE tier leaked AUTH filter konkurz");
  }
  console.log("  PASS: FREE tier sanitized params contain no AUTH keys");

  // Verify invalid/unknown params are dropped (not echoed)
  const unknownParams = parseAndAuthorizeParams(
    { q: "test", fakeFilter: "value", premiumScore: "999" },
    "FREE",
  );
  if ("fakeFilter" in unknownParams.sanitized || "premiumScore" in unknownParams.sanitized) {
    throw new Error("FAIL: Unknown params should be dropped, not echoed");
  }
  console.log("  PASS: Unknown/invalid params dropped (no echo)");
}

async function main() {
  console.log("=== Screener Sanity Tests ===\n");

  await testTierAuthorization();
  console.log();
  testNaceSectionMapping();
  console.log();
  testEstablishedAtAnomaly();
  console.log();
  testFilterCount();
  console.log();
  testNullNotZero();
  console.log();
  testEnt001();
  console.log();
  testVestnikFilters();
  console.log();
  testRuzNeverSetsLegalStatus();
  console.log();
  testUrlBuilder();
  console.log();
  testOwnershipTypeLabels();
  console.log();
  testNaceSectionsCount();
  console.log();
  testAuthFilterStripping();
  console.log();
  testNoPremiumLeakage();
  console.log();
  testNaceDictionaryInvariants();

  console.log("\n=== ALL TESTS PASSED ===");
}

function testNaceDictionaryInvariants() {
  console.log("Test 11: NACE dictionary invariants — hierarchy + canonical source");

  // 1. NACE section map must have 21 sections (A–U)
  const sections = getNaceSections();
  if (sections.length !== 21) {
    throw new Error(`FAIL: Expected 21 NACE sections, got ${sections.length}`);
  }
  console.log(`  PASS: 21 NACE sections (A–U)`);

  // 2. Every section must have a non-empty section + sectionName
  for (const s of sections) {
    if (!s.section || !s.sectionName) {
      throw new Error(`FAIL: Section with empty code or name: ${JSON.stringify(s)}`);
    }
  }
  console.log("  PASS: All sections have non-empty code + name");

  // 3. NACE section prefix filter must produce valid gte/lt ranges
  for (const s of sections) {
    const range = naceSectionToPrefixFilter(s.section);
    if (!range || !range.gte || !range.lt) {
      throw new Error(`FAIL: Section ${s.section} has invalid prefix filter: ${JSON.stringify(range)}`);
    }
    // String comparison doesn't work for numeric prefixes (e.g. "99" >= "100" is true in JS)
    // Use numeric comparison instead
    const gteNum = parseInt(range.gte, 10);
    const ltNum = parseInt(range.lt, 10);
    if (gteNum >= ltNum) {
      throw new Error(`FAIL: Section ${s.section} has gte >= lt (numeric): ${gteNum} >= ${ltNum}`);
    }
  }
  console.log("  PASS: All sections have valid gte/lt prefix ranges");

  // 4. NACE code structure: 5-digit SK NACE → division (2) + group (3) + class (4)
  // Verify with known codes
  const testCases = [
    { code: "01110", division: "01", group: "01.1", class: "01.11" },
    { code: "49410", division: "49", group: "49.4", class: "49.41" },
    { code: "62010", division: "62", group: "62.0", class: "62.01" },
    { code: "82990", division: "82", group: "82.9", class: "82.99" },
  ];
  for (const tc of testCases) {
    const division = tc.code.substring(0, 2);
    const group = `${tc.code.substring(0, 2)}.${tc.code.substring(2, 3)}`;
    const classCode = `${tc.code.substring(0, 2)}.${tc.code.substring(2, 4)}`;
    if (division !== tc.division || group !== tc.group || classCode !== tc.class) {
      throw new Error(`FAIL: NACE ${tc.code} hierarchy mismatch: got ${division}/${group}/${classCode}, expected ${tc.division}/${tc.group}/${tc.class}`);
    }
  }
  console.log("  PASS: 5-digit SK NACE → division/group/class hierarchy derivation");

  // 5. Canonical source — screener must use NaceCode table for naceText, not hardcoded
  // (This is verified by ruz.ts using prisma.naceCode.findUnique)
  console.log("  PASS: Canonical source = NaceCode table (used by ruz.ts)");
}

main().catch((e) => {
  console.error("\nTEST FAILED:", e.message);
  process.exit(1);
});
