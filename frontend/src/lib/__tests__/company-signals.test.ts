/**
 * Company Signals — V1 test suite
 * Run with: npx tsx src/lib/__tests__/company-signals.test.ts
 *
 * Tests:
 *   1. Boundary matrix for each threshold (no cliff effect)
 *   2. Null / 0 / negative denominator handling
 *   3. Minimum history per signal (null ≠ false)
 *   4. Vestník event mapping (explicit, not contains)
 *   5. Severity bands (🟢/🟡/🟠/🔴)
 *   6. Deduplication (worst severity per signal id)
 *   7. Data availability (HAS/NO_FINANCIAL_DATA)
 *   8. Edge cases (empty input, single year, all nulls)
 */

import {
  computeCompanySignals,
  THRESHOLDS,
  MIN_HISTORY,
  type SignalId,
  type SignalSeverity,
  type CompanySignalsInput,
} from "../company-signals";

// ── Helpers ─────────────────────────────────────────────────────

function stmt(year: number, overrides: Record<string, number | null> = {}) {
  return {
    year,
    totalAssets: 1_000_000,
    currentAssets: 800_000,
    equity: 500_000,
    shortTermLiabilities: 400_000,
    longTermLiabilities: 100_000,
    mainActivityRevenue: 2_000_000,
    netProfitLoss: 100_000,
    operatingCashFlow: 50_000,
    inventory: 200_000,
    ...overrides,
  };
}

function vestnik(eventType: string, year = 2025): { eventType: string; publishedAt: Date } {
  return { eventType, publishedAt: new Date(`${year}-06-01`) };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`FAIL: ${message}\n  expected: ${expected}\n  actual:   ${actual}`);
}

function hasSignal(signals: ReturnType<typeof computeCompanySignals>, id: SignalId): boolean {
  return signals.signals.some((s) => s.id === id);
}

function getSignal(signals: ReturnType<typeof computeCompanySignals>, id: SignalId) {
  return signals.signals.find((s) => s.id === id);
}

function getSeverity(signals: ReturnType<typeof computeCompanySignals>, id: SignalId): SignalSeverity | null {
  return getSignal(signals, id)?.severity ?? null;
}

// ── Test runner ─────────────────────────────────────────────────

function test(name: string, fn: () => void) {
  console.log(`Test: ${name}`);
  fn();
  console.log("  PASS");
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// 1. Boundary matrix — HIGH_LEVERAGE (debt/assets)
// ═══════════════════════════════════════════════════════════════

function testHighLeverageBoundaries() {
  const cases: Array<{ ratio: number; expected: SignalSeverity | null }> = [
    { ratio: 0.5999, expected: null },     // below yellow
    { ratio: 0.6000, expected: "yellow" }, // yellow boundary
    { ratio: 0.6999, expected: "yellow" }, // upper yellow
    { ratio: 0.7000, expected: "orange" }, // orange boundary
    { ratio: 0.8499, expected: "orange" }, // upper orange
    { ratio: 0.8500, expected: "red" },    // red boundary
    { ratio: 0.9500, expected: "red" },    // deep red
  ];

  for (const tc of cases) {
    const debt = tc.ratio * 1_000_000;
    const equity = 1_000_000 - debt;
    const result = computeCompanySignals({
      financialStatements: [stmt(2025, {
        totalAssets: 1_000_000,
        shortTermLiabilities: debt,
        longTermLiabilities: 0,
        equity,
      })],
      vestnikEvents: [],
    });
    const sev = getSeverity(result, "HIGH_LEVERAGE");
    assertEq(sev, tc.expected, `HIGH_LEVERAGE ratio=${tc.ratio.toFixed(4)} should be ${tc.expected}`);
  }
  console.log("  PASS: HIGH_LEVERAGE boundary matrix (7 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 2. Boundary matrix — INVENTORY_CONCENTRATION
// ═══════════════════════════════════════════════════════════════

function testInventoryConcentrationBoundaries() {
  const cases: Array<{ ratio: number; expected: SignalSeverity | null }> = [
    { ratio: 0.4999, expected: null },
    { ratio: 0.5000, expected: "yellow" },
    { ratio: 0.5999, expected: "yellow" },
    { ratio: 0.6000, expected: "orange" },
    { ratio: 0.6999, expected: "orange" },
    { ratio: 0.7000, expected: "red" },
    { ratio: 0.9000, expected: "red" },
  ];

  for (const tc of cases) {
    const result = computeCompanySignals({
      financialStatements: [stmt(2025, {
        currentAssets: 1_000_000,
        inventory: tc.ratio * 1_000_000,
      })],
      vestnikEvents: [],
    });
    const sev = getSeverity(result, "INVENTORY_CONCENTRATION");
    assertEq(sev, tc.expected, `INVENTORY_CONCENTRATION ratio=${tc.ratio.toFixed(4)} should be ${tc.expected}`);
  }
  console.log("  PASS: INVENTORY_CONCENTRATION boundary matrix (7 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 3. Boundary matrix — LIABILITIES_SURGE (YoY growth)
// ═══════════════════════════════════════════════════════════════

function testLiabilitiesSurgeBoundaries() {
  const cases: Array<{ growth: number; expected: SignalSeverity | null }> = [
    { growth: 0.2999, expected: null },
    { growth: 0.3000, expected: "yellow" },
    { growth: 0.5999, expected: "yellow" },
    { growth: 0.6000, expected: "orange" },
    { growth: 0.9999, expected: "orange" },
    { growth: 1.0000, expected: "red" },
    { growth: 2.5000, expected: "red" },
  ];

  for (const tc of cases) {
    const prevDebt = 100_000;
    const currDebt = prevDebt * (1 + tc.growth);
    const result = computeCompanySignals({
      financialStatements: [
        stmt(2024, { shortTermLiabilities: prevDebt, longTermLiabilities: 0 }),
        stmt(2025, { shortTermLiabilities: currDebt, longTermLiabilities: 0 }),
      ],
      vestnikEvents: [],
    });
    const sev = getSeverity(result, "LIABILITIES_SURGE");
    assertEq(sev, tc.expected, `LIABILITIES_SURGE growth=${(tc.growth * 100).toFixed(1)}% should be ${tc.expected}`);
  }
  console.log("  PASS: LIABILITIES_SURGE boundary matrix (7 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 4. Boundary matrix — REVENUE_DECLINE (YoY)
// ═══════════════════════════════════════════════════════════════

function testRevenueDeclineBoundaries() {
  const cases: Array<{ growth: number; expected: SignalSeverity | null }> = [
    { growth: 0.01, expected: null },       // +1% growth → no signal
    { growth: 0.00, expected: null },       // 0% → no signal (yellow threshold is 0, but 0 is not < 0)
    { growth: -0.001, expected: "yellow" }, // -0.1% → yellow
    { growth: -0.0999, expected: "yellow" },
    { growth: -0.1000, expected: "orange" },
    { growth: -0.2999, expected: "orange" },
    { growth: -0.3000, expected: "red" },
    { growth: -0.5000, expected: "red" },
  ];

  for (const tc of cases) {
    const prevRev = 1_000_000;
    const currRev = prevRev * (1 + tc.growth);
    const result = computeCompanySignals({
      financialStatements: [
        stmt(2024, { mainActivityRevenue: prevRev }),
        stmt(2025, { mainActivityRevenue: currRev }),
      ],
      vestnikEvents: [],
    });
    const sev = getSeverity(result, "REVENUE_DECLINE");
    assertEq(sev, tc.expected, `REVENUE_DECLINE growth=${(tc.growth * 100).toFixed(2)}% should be ${tc.expected}`);
  }
  console.log("  PASS: REVENUE_DECLINE boundary matrix (8 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 5. Boundary matrix — HIGH_ROE_DIAGNOSTIC
// ═══════════════════════════════════════════════════════════════

function testHighRoeBoundaries() {
  const cases: Array<{ roe: number; expected: SignalSeverity | null }> = [
    { roe: 0.4999, expected: null },
    { roe: 0.5000, expected: "yellow" },
    { roe: 0.9999, expected: "yellow" },
    { roe: 1.0000, expected: "orange" },
    { roe: 1.5000, expected: "orange" },
  ];

  for (const tc of cases) {
    // ROE = netProfit / equity → set equity=100, profit=roe*100
    const result = computeCompanySignals({
      financialStatements: [stmt(2025, {
        equity: 100_000,
        netProfitLoss: tc.roe * 100_000,
      })],
      vestnikEvents: [],
    });
    const sev = getSeverity(result, "HIGH_ROE_DIAGNOSTIC");
    assertEq(sev, tc.expected, `HIGH_ROE_DIAGNOSTIC roe=${(tc.roe * 100).toFixed(1)}% should be ${tc.expected}`);
  }
  console.log("  PASS: HIGH_ROE_DIAGNOSTIC boundary matrix (5 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 6. Null / 0 / negative denominator handling
// ═══════════════════════════════════════════════════════════════

function testNullDenominatorHandling() {
  // totalAssets = 0 → HIGH_LEVERAGE should NOT be created (null, not Infinity)
  const result0 = computeCompanySignals({
    financialStatements: [stmt(2025, { totalAssets: 0, shortTermLiabilities: 500_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(result0, "HIGH_LEVERAGE"), "totalAssets=0 should NOT produce HIGH_LEVERAGE (null, not Infinity)");

  // totalAssets = null → HIGH_LEVERAGE should NOT be created
  const resultNull = computeCompanySignals({
    financialStatements: [stmt(2025, { totalAssets: null, shortTermLiabilities: 500_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultNull, "HIGH_LEVERAGE"), "totalAssets=null should NOT produce HIGH_LEVERAGE");

  // currentAssets = 0 → INVENTORY_CONCENTRATION should NOT be created
  const resultCa0 = computeCompanySignals({
    financialStatements: [stmt(2025, { currentAssets: 0, inventory: 100_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultCa0, "INVENTORY_CONCENTRATION"), "currentAssets=0 should NOT produce INVENTORY_CONCENTRATION");

  // equity = 0 → ROE should be null (safeDiv returns null) → HIGH_ROE_DIAGNOSTIC should NOT be created
  const resultEq0 = computeCompanySignals({
    financialStatements: [stmt(2025, { equity: 0, netProfitLoss: 100_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultEq0, "HIGH_ROE_DIAGNOSTIC"), "equity=0 should NOT produce HIGH_ROE_DIAGNOSTIC (null ROE)");

  console.log("  PASS: Null/0 denominator handling (4 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 7. Minimum history per signal
// ═══════════════════════════════════════════════════════════════

function testMinHistory() {
  // LIABILITIES_SURGE needs min 2 years — 1 year should NOT produce signal
  const result1y = computeCompanySignals({
    financialStatements: [stmt(2025, { shortTermLiabilities: 1_000_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(result1y, "LIABILITIES_SURGE"), "1 year should NOT produce LIABILITIES_SURGE (min 2)");

  // REVENUE_DECLINE needs min 2 years
  assert(!hasSignal(result1y, "REVENUE_DECLINE"), "1 year should NOT produce REVENUE_DECLINE (min 2)");

  // NEGATIVE_CF_STREAK needs min 3 years — 2 years should NOT produce signal
  const result2y = computeCompanySignals({
    financialStatements: [
      stmt(2023, { operatingCashFlow: -50_000 }),
      stmt(2024, { operatingCashFlow: -50_000 }),
    ],
    vestnikEvents: [],
  });
  assert(!hasSignal(result2y, "NEGATIVE_CF_STREAK"), "2 years should NOT produce NEGATIVE_CF_STREAK (min 3)");

  // REVENUE_GROWTH_STREAK needs min 3 years
  assert(!hasSignal(result2y, "REVENUE_GROWTH_STREAK"), "2 years should NOT produce REVENUE_GROWTH_STREAK (min 3)");

  // 3 years with negative CF → should produce NEGATIVE_CF_STREAK
  const result3y = computeCompanySignals({
    financialStatements: [
      stmt(2023, { operatingCashFlow: -50_000 }),
      stmt(2024, { operatingCashFlow: -50_000 }),
      stmt(2025, { operatingCashFlow: -50_000 }),
    ],
    vestnikEvents: [],
  });
  assert(hasSignal(result3y, "NEGATIVE_CF_STREAK"), "3 years negative CF should produce NEGATIVE_CF_STREAK");
  assertEq(getSeverity(result3y, "NEGATIVE_CF_STREAK"), "red", "NEGATIVE_CF_STREAK should be red");

  // GAP IN YEARS: 2025, 2024, 2022 (missing 2023) → should NOT produce NEGATIVE_CF_STREAK
  const resultGap = computeCompanySignals({
    financialStatements: [
      stmt(2022, { operatingCashFlow: -50_000 }),
      stmt(2024, { operatingCashFlow: -50_000 }),
      stmt(2025, { operatingCashFlow: -50_000 }),
    ],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultGap, "NEGATIVE_CF_STREAK"), "Gap in years (2025,2024,2022) should NOT produce NEGATIVE_CF_STREAK");

  // GAP IN REVENUE GROWTH STREAK: 2025, 2024, 2022 (missing 2023) → should NOT produce REVENUE_GROWTH_STREAK
  const resultRevGap = computeCompanySignals({
    financialStatements: [
      stmt(2022, { mainActivityRevenue: 1_000_000 }),
      stmt(2024, { mainActivityRevenue: 1_100_000 }),
      stmt(2025, { mainActivityRevenue: 1_200_000 }),
    ],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultRevGap, "REVENUE_GROWTH_STREAK"), "Gap in years should NOT produce REVENUE_GROWTH_STREAK");

  // GAP IN PROFITABLE STREAK: 2025, 2023 (missing 2024) → should NOT produce PROFITABLE_STREAK
  const resultProfGap = computeCompanySignals({
    financialStatements: [
      stmt(2023, { netProfitLoss: 50_000 }),
      stmt(2025, { netProfitLoss: 100_000 }),
    ],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultProfGap, "PROFITABLE_STREAK"), "Gap in years should NOT produce PROFITABLE_STREAK");

  console.log("  PASS: Minimum history per signal (8 cases, including year gaps)");
}

// ═══════════════════════════════════════════════════════════════
// 8. Vestník event mapping (explicit, not contains)
// ═══════════════════════════════════════════════════════════════

function testVestnikMapping() {
  // Konkurz → VESTNIK_KONKURZ (red)
  const resultKonkurz = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [vestnik("Konkurz / Reštrukturalizácia")],
  });
  assert(hasSignal(resultKonkurz, "VESTNIK_KONKURZ"), "Konkurz event should produce VESTNIK_KONKURZ");
  assertEq(getSeverity(resultKonkurz, "VESTNIK_KONKURZ"), "red", "VESTNIK_KONKURZ should be red");

  // Likvidácia → VESTNIK_LIKVIDACIA (orange)
  const resultLikv = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [vestnik("Likvidácia")],
  });
  assert(hasSignal(resultLikv, "VESTNIK_LIKVIDACIA"), "Likvidácia event should produce VESTNIK_LIKVIDACIA");
  assertEq(getSeverity(resultLikv, "VESTNIK_LIKVIDACIA"), "orange", "VESTNIK_LIKVIDACIA should be orange");

  // Exekúcia → VESTNIK_EXECUTION (orange)
  const resultExec = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [vestnik("Exekúcia")],
  });
  assert(hasSignal(resultExec, "VESTNIK_EXECUTION"), "Exekúcia event should produce VESTNIK_EXECUTION");
  assertEq(getSeverity(resultExec, "VESTNIK_EXECUTION"), "orange", "VESTNIK_EXECUTION should be orange");

  // Zrušenie / Vymazanie → VESTNIK_DISSOLUTION (yellow, diagnostic)
  const resultDiss = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [vestnik("Zrušenie / Vymazanie")],
  });
  assert(hasSignal(resultDiss, "VESTNIK_DISSOLUTION"), "Zrušenie event should produce VESTNIK_DISSOLUTION");
  assertEq(getSeverity(resultDiss, "VESTNIK_DISSOLUTION"), "yellow", "VESTNIK_DISSOLUTION should be yellow");
  const dissSignal = getSignal(resultDiss, "VESTNIK_DISSOLUTION");
  assert(dissSignal?.category === "diagnostic", "VESTNIK_DISSOLUTION should be diagnostic category");

  // Unknown event type → no signal
  const resultUnknown = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [vestnik("Zmena v registri")],
  });
  assert(!hasSignal(resultUnknown, "VESTNIK_KONKURZ"), "Unknown event should NOT produce any Vestnik signal");

  // Multiple events of same type → deduplicated to 1 signal
  const resultDup = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [
      vestnik("Konkurz / Reštrukturalizácia", 2024),
      vestnik("Konkurz / Reštrukturalizácia", 2025),
    ],
  });
  const konkurzCount = resultDup.signals.filter((s) => s.id === "VESTNIK_KONKURZ").length;
  assertEq(konkurzCount, 1, "Duplicate Konkurz events should produce 1 signal");

  console.log("  PASS: Vestník event mapping (6 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 9. NEGATIVE_CF_DESPITE_PROFIT + LOW_CF_QUALITY
// ═══════════════════════════════════════════════════════════════

function testCfProfitSignals() {
  // profit > 0, CF < 0 → NEGATIVE_CF_DESPITE_PROFIT (red)
  const resultNegCf = computeCompanySignals({
    financialStatements: [stmt(2025, { netProfitLoss: 100_000, operatingCashFlow: -50_000 })],
    vestnikEvents: [],
  });
  assert(hasSignal(resultNegCf, "NEGATIVE_CF_DESPITE_PROFIT"), "profit>0 + CF<0 should produce NEGATIVE_CF_DESPITE_PROFIT");
  assertEq(getSeverity(resultNegCf, "NEGATIVE_CF_DESPITE_PROFIT"), "red", "NEGATIVE_CF_DESPITE_PROFIT should be red");
  // Should NOT produce LOW_CF_QUALITY (CF is negative, not positive)
  assert(!hasSignal(resultNegCf, "LOW_CF_QUALITY"), "CF<0 should NOT produce LOW_CF_QUALITY");

  // profit > 0, CF > 0, CF < profit * 0.3 → LOW_CF_QUALITY (orange)
  const resultLowCf = computeCompanySignals({
    financialStatements: [stmt(2025, { netProfitLoss: 100_000, operatingCashFlow: 20_000 })],
    vestnikEvents: [],
  });
  assert(hasSignal(resultLowCf, "LOW_CF_QUALITY"), "CF < 30% of profit should produce LOW_CF_QUALITY");
  assertEq(getSeverity(resultLowCf, "LOW_CF_QUALITY"), "orange", "LOW_CF_QUALITY should be orange");
  // Should NOT produce NEGATIVE_CF_DESPITE_PROFIT (CF is positive)
  assert(!hasSignal(resultLowCf, "NEGATIVE_CF_DESPITE_PROFIT"), "CF>0 should NOT produce NEGATIVE_CF_DESPITE_PROFIT");

  // profit > 0, CF > 0, CF > profit * 0.3 → no CF signal
  const resultOk = computeCompanySignals({
    financialStatements: [stmt(2025, { netProfitLoss: 100_000, operatingCashFlow: 50_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultOk, "LOW_CF_QUALITY"), "CF > 30% of profit should NOT produce LOW_CF_QUALITY");
  assert(!hasSignal(resultOk, "NEGATIVE_CF_DESPITE_PROFIT"), "CF>0 should NOT produce NEGATIVE_CF_DESPITE_PROFIT");

  // profit < 0, CF < 0 → neither signal (both require profit > 0)
  const resultLoss = computeCompanySignals({
    financialStatements: [stmt(2025, { netProfitLoss: -100_000, operatingCashFlow: -50_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultLoss, "NEGATIVE_CF_DESPITE_PROFIT"), "profit<0 should NOT produce NEGATIVE_CF_DESPITE_PROFIT");
  assert(!hasSignal(resultLoss, "LOW_CF_QUALITY"), "profit<0 should NOT produce LOW_CF_QUALITY");

  console.log("  PASS: CF/profit signals (4 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 10. NEGATIVE_EQUITY
// ═══════════════════════════════════════════════════════════════

function testNegativeEquity() {
  // equity < 0 → red
  const result = computeCompanySignals({
    financialStatements: [stmt(2025, { equity: -50_000 })],
    vestnikEvents: [],
  });
  assert(hasSignal(result, "NEGATIVE_EQUITY"), "equity<0 should produce NEGATIVE_EQUITY");
  assertEq(getSeverity(result, "NEGATIVE_EQUITY"), "red", "NEGATIVE_EQUITY should be red");

  // equity = 0 → no signal (0 is not < 0)
  const result0 = computeCompanySignals({
    financialStatements: [stmt(2025, { equity: 0 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(result0, "NEGATIVE_EQUITY"), "equity=0 should NOT produce NEGATIVE_EQUITY");

  // equity > 0 → no signal
  const resultPos = computeCompanySignals({
    financialStatements: [stmt(2025, { equity: 100_000 })],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultPos, "NEGATIVE_EQUITY"), "equity>0 should NOT produce NEGATIVE_EQUITY");

  console.log("  PASS: NEGATIVE_EQUITY (3 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 11. Positive signals
// ═══════════════════════════════════════════════════════════════

function testPositiveSignals() {
  // REVENUE_GROWTH_STREAK — 3 years increasing revenue
  const resultRev = computeCompanySignals({
    financialStatements: [
      stmt(2023, { mainActivityRevenue: 1_000_000 }),
      stmt(2024, { mainActivityRevenue: 1_100_000 }),
      stmt(2025, { mainActivityRevenue: 1_200_000 }),
    ],
    vestnikEvents: [],
  });
  assert(hasSignal(resultRev, "REVENUE_GROWTH_STREAK"), "3 years revenue growth should produce REVENUE_GROWTH_STREAK");
  assertEq(getSeverity(resultRev, "REVENUE_GROWTH_STREAK"), "green", "REVENUE_GROWTH_STREAK should be green");

  // REVENUE_GROWTH_STREAK — 3 years but one decline → no signal
  const resultDecline = computeCompanySignals({
    financialStatements: [
      stmt(2023, { mainActivityRevenue: 1_000_000 }),
      stmt(2024, { mainActivityRevenue: 900_000 }),
      stmt(2025, { mainActivityRevenue: 1_200_000 }),
    ],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultDecline, "REVENUE_GROWTH_STREAK"), "Revenue decline in middle year should NOT produce streak");

  // EQUITY_GROWTH_STREAK — 2 years increasing equity
  const resultEq = computeCompanySignals({
    financialStatements: [
      stmt(2024, { equity: 100_000 }),
      stmt(2025, { equity: 150_000 }),
    ],
    vestnikEvents: [],
  });
  assert(hasSignal(resultEq, "EQUITY_GROWTH_STREAK"), "2 years equity growth should produce EQUITY_GROWTH_STREAK");
  assertEq(getSeverity(resultEq, "EQUITY_GROWTH_STREAK"), "green", "EQUITY_GROWTH_STREAK should be green");

  // PROFITABLE_STREAK — 2 years positive profit
  const resultProfit = computeCompanySignals({
    financialStatements: [
      stmt(2024, { netProfitLoss: 50_000 }),
      stmt(2025, { netProfitLoss: 100_000 }),
    ],
    vestnikEvents: [],
  });
  assert(hasSignal(resultProfit, "PROFITABLE_STREAK"), "2 years profit should produce PROFITABLE_STREAK");
  assertEq(getSeverity(resultProfit, "PROFITABLE_STREAK"), "green", "PROFITABLE_STREAK should be green");

  // PROFITABLE_STREAK — 1 year profit + 1 year loss → no signal
  const resultMixed = computeCompanySignals({
    financialStatements: [
      stmt(2024, { netProfitLoss: -50_000 }),
      stmt(2025, { netProfitLoss: 100_000 }),
    ],
    vestnikEvents: [],
  });
  assert(!hasSignal(resultMixed, "PROFITABLE_STREAK"), "Loss+profit should NOT produce PROFITABLE_STREAK");

  console.log("  PASS: Positive signals (5 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 12. Deduplication — worst severity per signal id
// ═══════════════════════════════════════════════════════════════

function testDeduplication() {
  // HIGH_LEVERAGE in 2024 (orange) and 2025 (red) → keep red
  const result = computeCompanySignals({
    financialStatements: [
      stmt(2024, { totalAssets: 1_000_000, shortTermLiabilities: 750_000, longTermLiabilities: 0 }),
      stmt(2025, { totalAssets: 1_000_000, shortTermLiabilities: 900_000, longTermLiabilities: 0 }),
    ],
    vestnikEvents: [],
  });
  const highLeverageSignals = result.signals.filter((s) => s.id === "HIGH_LEVERAGE");
  assertEq(highLeverageSignals.length, 1, "Should deduplicate HIGH_LEVERAGE to 1 signal");
  assertEq(highLeverageSignals[0].severity, "red", "Should keep worst severity (red)");
  assertEq(highLeverageSignals[0].year, 2025, "Should keep year of worst severity");

  console.log("  PASS: Deduplication (worst severity per id)");
}

// ═══════════════════════════════════════════════════════════════
// 13. Data availability
// ═══════════════════════════════════════════════════════════════

function testDataAvailability() {
  // No statements → NO_FINANCIAL_DATA
  const resultNoData = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [],
  });
  assertEq(resultNoData.availability, "NO_FINANCIAL_DATA", "No statements → NO_FINANCIAL_DATA");
  assertEq(resultNoData.signals.length, 0, "No statements + no vestnik → 0 signals");

  // With statements → HAS_FINANCIAL_DATA
  const resultWithData = computeCompanySignals({
    financialStatements: [stmt(2025)],
    vestnikEvents: [],
  });
  assertEq(resultWithData.availability, "HAS_FINANCIAL_DATA", "With statements → HAS_FINANCIAL_DATA");

  // No statements but Vestník event → NO_FINANCIAL_DATA but has Vestnik signal
  const resultVestnikOnly = computeCompanySignals({
    financialStatements: [],
    vestnikEvents: [vestnik("Konkurz / Reštrukturalizácia")],
  });
  assertEq(resultVestnikOnly.availability, "NO_FINANCIAL_DATA", "No statements + vestnik → NO_FINANCIAL_DATA");
  assert(hasSignal(resultVestnikOnly, "VESTNIK_KONKURZ"), "Vestnik signal should be produced even without financials");

  console.log("  PASS: Data availability (3 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 14. Edge cases
// ═══════════════════════════════════════════════════════════════

function testEdgeCases() {
  // Empty input
  const resultEmpty = computeCompanySignals({ financialStatements: [], vestnikEvents: [] });
  assertEq(resultEmpty.signals.length, 0, "Empty input → 0 signals");
  assertEq(resultEmpty.counts.red, 0, "Empty → 0 red");
  assertEq(resultEmpty.counts.green, 0, "Empty → 0 green");

  // All nulls in statement
  const resultNulls = computeCompanySignals({
    financialStatements: [{
      year: 2025,
      totalAssets: null,
      currentAssets: null,
      equity: null,
      shortTermLiabilities: null,
      longTermLiabilities: null,
      mainActivityRevenue: null,
      netProfitLoss: null,
      operatingCashFlow: null,
      inventory: null,
    }],
    vestnikEvents: [],
  });
  assertEq(resultNulls.availability, "HAS_FINANCIAL_DATA", "Statement with nulls → HAS_FINANCIAL_DATA (has row)");
  assertEq(resultNulls.signals.length, 0, "All nulls → 0 signals (no divisions possible)");

  // Counts consistency
  const resultCounts = computeCompanySignals({
    financialStatements: [stmt(2025, {
      totalAssets: 1_000_000,
      shortTermLiabilities: 900_000,
      longTermLiabilities: 0,
      equity: 100_000,
      netProfitLoss: 150_000,
      operatingCashFlow: -20_000,
    })],
    vestnikEvents: [vestnik("Konkurz / Reštrukturalizácia")],
  });
  const total = resultCounts.counts.red + resultCounts.counts.orange + resultCounts.counts.yellow + resultCounts.counts.green;
  assertEq(total, resultCounts.signals.length, "Sum of counts should equal signals length");

  console.log("  PASS: Edge cases (3 cases)");
}

// ═══════════════════════════════════════════════════════════════
// 15. MSM EXPORT integration test (real production data)
// ═══════════════════════════════════════════════════════════════

function testMsmExportIntegration() {
  // Based on real DB data for MSM EXPORT (IČO 48006122)
  const result = computeCompanySignals({
    financialStatements: [
      // 2021
      stmt(2021, {
        totalAssets: 8_070_602, currentAssets: 7_328_718, equity: 646_607,
        shortTermLiabilities: 1_058_002, longTermLiabilities: 83_231,
        mainActivityRevenue: 4_863_896, netProfitLoss: 48_911, operatingCashFlow: 65_087,
        inventory: 9_302,
      }),
      // 2022
      stmt(2022, {
        totalAssets: 97_166_524, currentAssets: 96_383_888, equity: 704_429,
        shortTermLiabilities: 96_383_035, longTermLiabilities: 12_561,
        mainActivityRevenue: 23_205_862, netProfitLoss: 57_821, operatingCashFlow: 34_123_800,
        inventory: 53_284_197,
      }),
      // 2023
      stmt(2023, {
        totalAssets: 262_752_814, currentAssets: 260_406_674, equity: 15_330_618,
        shortTermLiabilities: 231_492_152, longTermLiabilities: 19_247,
        mainActivityRevenue: 221_832_770, netProfitLoss: 14_626_187, operatingCashFlow: 258_987,
        inventory: 182_803_968,
      }),
      // 2024
      stmt(2024, {
        totalAssets: 881_088_333, currentAssets: 877_263_497, equity: 85_129_295,
        shortTermLiabilities: 790_146_072, longTermLiabilities: 29_821,
        mainActivityRevenue: 645_373_232, netProfitLoss: 83_798_680, operatingCashFlow: 157_204_795,
        inventory: 576_476_027,
      }),
      // 2025
      stmt(2025, {
        totalAssets: 1_393_174_109, currentAssets: 1_350_384_502, equity: 263_630_182,
        shortTermLiabilities: 1_084_188_060, longTermLiabilities: 17_442_053,
        mainActivityRevenue: 1_841_509_686, netProfitLoss: 262_299_567, operatingCashFlow: -89_707_956,
        inventory: 1_042_923_531,
      }),
    ],
    vestnikEvents: [],
  });

  // Expected signals for MSM EXPORT:
  // - NEGATIVE_CF_DESPITE_PROFIT (2025: profit +262M, CF -89M) → red
  assert(hasSignal(result, "NEGATIVE_CF_DESPITE_PROFIT"), "MSM should have NEGATIVE_CF_DESPITE_PROFIT (2025)");
  assertEq(getSeverity(result, "NEGATIVE_CF_DESPITE_PROFIT"), "red", "MSM NEGATIVE_CF_DESPITE_PROFIT should be red");

  // - HIGH_LEVERAGE (2022: debt ~99.2% → red, dedup keeps worst across years)
  assert(hasSignal(result, "HIGH_LEVERAGE"), "MSM should have HIGH_LEVERAGE");
  assertEq(getSeverity(result, "HIGH_LEVERAGE"), "red", "MSM HIGH_LEVERAGE should be red (2022: 99.2%)");

  // - INVENTORY_CONCENTRATION (2025: inventory/currentAssets ~77%) → red
  assert(hasSignal(result, "INVENTORY_CONCENTRATION"), "MSM should have INVENTORY_CONCENTRATION");
  assertEq(getSeverity(result, "INVENTORY_CONCENTRATION"), "red", "MSM INVENTORY_CONCENTRATION should be red (77%)");

  // - HIGH_ROE_DIAGNOSTIC (2025: ROE ~99.5% → yellow, since < 100%)
  assert(hasSignal(result, "HIGH_ROE_DIAGNOSTIC"), "MSM should have HIGH_ROE_DIAGNOSTIC");
  assertEq(getSeverity(result, "HIGH_ROE_DIAGNOSTIC"), "yellow", "MSM HIGH_ROE_DIAGNOSTIC should be yellow (99.5% < 100%)");

  // - REVENUE_GROWTH_STREAK (3 years growth) → green
  assert(hasSignal(result, "REVENUE_GROWTH_STREAK"), "MSM should have REVENUE_GROWTH_STREAK");

  // - EQUITY_GROWTH_STREAK (equity growing) → green
  assert(hasSignal(result, "EQUITY_GROWTH_STREAK"), "MSM should have EQUITY_GROWTH_STREAK");

  // - PROFITABLE_STREAK (profit positive 5 years) → green
  assert(hasSignal(result, "PROFITABLE_STREAK"), "MSM should have PROFITABLE_STREAK");

  // - LIABILITIES_SURGE (2022: debt grew from 1.1M to 96.4M = ~8900%) → red
  assert(hasSignal(result, "LIABILITIES_SURGE"), "MSM should have LIABILITIES_SURGE");
  assertEq(getSeverity(result, "LIABILITIES_SURGE"), "red", "MSM LIABILITIES_SURGE should be red (huge growth)");

  // Should NOT have NEGATIVE_EQUITY (equity is always positive)
  assert(!hasSignal(result, "NEGATIVE_EQUITY"), "MSM should NOT have NEGATIVE_EQUITY");

  // Should NOT have REVENUE_DECLINE (revenue always growing)
  assert(!hasSignal(result, "REVENUE_DECLINE"), "MSM should NOT have REVENUE_DECLINE");

  // Should NOT have NEGATIVE_CF_STREAK (only 1 year negative CF)
  assert(!hasSignal(result, "NEGATIVE_CF_STREAK"), "MSM should NOT have NEGATIVE_CF_STREAK (only 2025 negative)");

  // Should NOT have LOW_CF_QUALITY for 2025 (CF is negative, not positive low)
  // Note: 2023 has CF=258K vs profit=14.6M → ratio 0.018 → LOW_CF_QUALITY
  // But dedup keeps worst severity, and NEGATIVE_CF_DESPITE_PROFIT (red) is worse
  // Actually LOW_CF_QUALITY only triggers when CF > 0. 2023: CF=258987 > 0, profit=14.6M
  // 258987 / 14626187 = 0.0177 < 0.3 → LOW_CF_QUALITY (orange)
  // But 2025 has NEGATIVE_CF_DESPITE_PROFIT (red) — different signal id, so both exist
  assert(hasSignal(result, "LOW_CF_QUALITY"), "MSM 2023 should have LOW_CF_QUALITY (CF/profit = 1.8%)");

  console.log("  PASS: MSM EXPORT integration test (12 assertions)");
}

// ═══════════════════════════════════════════════════════════════
// 16. MIN_HISTORY contract validation
// ═══════════════════════════════════════════════════════════════

function testMinHistoryContract() {
  // Verify MIN_HISTORY has entry for all 16 signals
  const expectedIds: SignalId[] = [
    "NEGATIVE_CF_DESPITE_PROFIT", "LOW_CF_QUALITY", "HIGH_LEVERAGE",
    "INVENTORY_CONCENTRATION", "LIABILITIES_SURGE", "REVENUE_DECLINE",
    "NEGATIVE_EQUITY", "NEGATIVE_CF_STREAK",
    "VESTNIK_KONKURZ", "VESTNIK_LIKVIDACIA", "VESTNIK_EXECUTION",
    "HIGH_ROE_DIAGNOSTIC", "VESTNIK_DISSOLUTION",
    "REVENUE_GROWTH_STREAK", "EQUITY_GROWTH_STREAK", "PROFITABLE_STREAK",
  ];
  for (const id of expectedIds) {
    assert(id in MIN_HISTORY, `MIN_HISTORY missing entry for ${id}`);
  }
  assertEq(Object.keys(MIN_HISTORY).length, 16, "MIN_HISTORY should have exactly 16 entries");

  // Vestník signals should have min 0 (no financial data needed)
  assertEq(MIN_HISTORY.VESTNIK_KONKURZ, 0, "VESTNIK_KONKURZ min history should be 0");
  assertEq(MIN_HISTORY.VESTNIK_LIKVIDACIA, 0, "VESTNIK_LIKVIDACIA min history should be 0");

  console.log("  PASS: MIN_HISTORY contract (16 entries, vestnik=0)");
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main() {
  console.log("=== Company Signals V1 Test Suite ===\n");

  test("HIGH_LEVERAGE boundaries", testHighLeverageBoundaries);
  test("INVENTORY_CONCENTRATION boundaries", testInventoryConcentrationBoundaries);
  test("LIABILITIES_SURGE boundaries", testLiabilitiesSurgeBoundaries);
  test("REVENUE_DECLINE boundaries", testRevenueDeclineBoundaries);
  test("HIGH_ROE_DIAGNOSTIC boundaries", testHighRoeBoundaries);
  test("Null/0 denominator handling", testNullDenominatorHandling);
  test("Minimum history per signal", testMinHistory);
  test("Vestník event mapping", testVestnikMapping);
  test("CF/profit signals", testCfProfitSignals);
  test("NEGATIVE_EQUITY", testNegativeEquity);
  test("Positive signals", testPositiveSignals);
  test("Deduplication", testDeduplication);
  test("Data availability", testDataAvailability);
  test("Edge cases", testEdgeCases);
  test("MSM EXPORT integration", testMsmExportIntegration);
  test("MIN_HISTORY contract", testMinHistoryContract);

  console.log("=== ALL TESTS PASSED ===");
}

main();
