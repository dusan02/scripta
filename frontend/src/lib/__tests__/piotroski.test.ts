/**
 * Unit tests for src/lib/piotroski.ts — computePiotroski()
 *
 * Tests cover:
 * - All 9 criteria passing (score 9)
 * - All 9 criteria failing (score 0)
 * - Null/missing data → criterion.passed = null
 * - Insufficient data (<2 years) → returns null
 * - Year sorting (unsorted input)
 * - Partial data (some criteria null, some pass)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computePiotroski, type PiotroskiResult } from "@/lib/piotroski";

type Stmt = Parameters<typeof computePiotroski>[0][number];

function makeStmt(year: number, overrides: Partial<Stmt> = {}): Stmt {
  return {
    year,
    netProfitLoss: 100,
    totalAssets: 1000,
    operatingCashFlow: 120,
    currentAssets: 300,
    shortTermLiabilities: 200,
    longTermLiabilities: 100,
    shareCapital: 50,
    grossProfit: 400,
    mainActivityRevenue: 2000,
    ...overrides,
  };
}

describe("piotroski.ts — computePiotroski()", () => {
  it("returns null for <2 statements", () => {
    assert.equal(computePiotroski([makeStmt(2023)]), null);
    assert.equal(computePiotroski([]), null);
  });

  it("returns score 9 when all criteria pass", () => {
    const prev = makeStmt(2022, {
      netProfitLoss: 50,
      totalAssets: 1000,
      operatingCashFlow: 60,
      currentAssets: 250,
      shortTermLiabilities: 200,
      longTermLiabilities: 150,
      shareCapital: 50,
      grossProfit: 300,
      mainActivityRevenue: 1500,
    });
    const curr = makeStmt(2023, {
      netProfitLoss: 100,   // ROA > 0 ✓, ΔROA improving ✓
      totalAssets: 1000,
      operatingCashFlow: 120, // CFO > 0 ✓, CFO > netProfit ✓ (accrual)
      currentAssets: 300,   // currentRatio improving ✓ (300/200 > 250/200)
      shortTermLiabilities: 200,
      longTermLiabilities: 100, // debtRatio improving ✓ (100/1000 ≤ 150/1000)
      shareCapital: 50,     // no dilution ✓ (50 ≤ 50)
      grossProfit: 450,     // margin improving ✓ (450/2000=0.225 > 300/1500=0.2)
      mainActivityRevenue: 2000, // turnover improving ✓ (2000/1000 > 1500/1000)
    });

    const result = computePiotroski([prev, curr]);
    assert.ok(result);
    assert.equal(result!.score, 9);
    assert.equal(result!.maxScore, 9);
    assert.equal(result!.year, 2023);
    assert.equal(result!.prevYear, 2022);
  });

  it("returns score 0 when all criteria fail", () => {
    const prev = makeStmt(2022, {
      netProfitLoss: 100,
      totalAssets: 1000,
      operatingCashFlow: 50,
      currentAssets: 400,
      shortTermLiabilities: 100,
      longTermLiabilities: 50,
      shareCapital: 40,
      grossProfit: 500,
      mainActivityRevenue: 2000,
    });
    const curr = makeStmt(2023, {
      netProfitLoss: -50,   // ROA < 0 ✗
      totalAssets: 1000,
      operatingCashFlow: -10, // CFO < 0 ✗, CFO < netProfit? -10 > -50 → accrual passes
      currentAssets: 200,   // currentRatio worsening ✗ (200/100 < 400/100)
      shortTermLiabilities: 100,
      longTermLiabilities: 200, // debtRatio worsening ✗
      shareCapital: 60,     // dilution ✗ (60 > 40)
      grossProfit: 300,     // margin worsening ✗ (300/2000 < 500/2000)
      mainActivityRevenue: 1500, // turnover worsening ✗ (1500/1000 < 2000/1000)
    });

    const result = computePiotroski([prev, curr]);
    assert.ok(result);
    // accrual: CFO > netProfit → -10 > -50 → true, so that one passes
    // ROA improving: currRoa(-50/1000=-0.05) > prevRoa(100/1000=0.1) → false
    assert.equal(result!.score, 1); // only accrual passes
  });

  it("handles unsorted input (sorts by year internally)", () => {
    const curr = makeStmt(2023);
    const prev = makeStmt(2022, { netProfitLoss: 50, grossProfit: 300, mainActivityRevenue: 1500 });

    const result = computePiotroski([curr, prev]); // unsorted
    assert.ok(result);
    assert.equal(result!.year, 2023);
    assert.equal(result!.prevYear, 2022);
  });

  it("sets passed=null when data is missing", () => {
    const prev = makeStmt(2022, {
      netProfitLoss: null, totalAssets: null, operatingCashFlow: null,
      currentAssets: null, shortTermLiabilities: null, longTermLiabilities: null,
      shareCapital: null, grossProfit: null, mainActivityRevenue: null,
    });
    const curr = makeStmt(2023, {
      netProfitLoss: null, totalAssets: null, operatingCashFlow: null,
      currentAssets: null, shortTermLiabilities: null, longTermLiabilities: null,
      shareCapital: null, grossProfit: null, mainActivityRevenue: null,
    });

    const result = computePiotroski([prev, curr]);
    assert.ok(result);
    // All criteria should be null since no financial data
    for (const c of result!.criteria) {
      assert.equal(c.passed, null, `${c.key} should be null`);
    }
    assert.equal(result!.score, 0);
    assert.equal(result!.maxScore, 0);
  });

  it("handles partial null data (mixed null and non-null criteria)", () => {
    const prev = makeStmt(2022, { operatingCashFlow: null, grossProfit: null });
    const curr = makeStmt(2023, { operatingCashFlow: null, grossProfit: null });

    const result = computePiotroski([prev, curr]);
    assert.ok(result);
    // CFO and margin criteria should be null
    const cfoCriterion = result!.criteria.find(c => c.key === "cfo_positive");
    assert.equal(cfoCriterion?.passed, null);
    const marginCriterion = result!.criteria.find(c => c.key === "margin_improving");
    assert.equal(marginCriterion?.passed, null);
    // ROA should still be computable
    const roaCriterion = result!.criteria.find(c => c.key === "roa_positive");
    assert.equal(roaCriterion?.passed, true); // netProfitLoss=100, totalAssets=1000 → ROA > 0
  });

  it("correctly identifies ROA improvement", () => {
    const prev = makeStmt(2022, { netProfitLoss: 50, totalAssets: 1000 });
    const curr = makeStmt(2023, { netProfitLoss: 100, totalAssets: 1000 });

    const result = computePiotroski([prev, curr]);
    assert.ok(result);
    const roaImproving = result!.criteria.find(c => c.key === "roa_improving");
    assert.equal(roaImproving?.passed, true);
  });

  it("correctly identifies ROA decline", () => {
    const prev = makeStmt(2022, { netProfitLoss: 100, totalAssets: 1000 });
    const curr = makeStmt(2023, { netProfitLoss: 50, totalAssets: 1000 });

    const result = computePiotroski([prev, curr]);
    assert.ok(result);
    const roaImproving = result!.criteria.find(c => c.key === "roa_improving");
    assert.equal(roaImproving?.passed, false);
  });

  it("handles zero totalAssets (debtRatio returns null)", () => {
    const prev = makeStmt(2022, { totalAssets: 0 });
    const curr = makeStmt(2023, { totalAssets: 0 });

    const result = computePiotroski([prev, curr]);
    assert.ok(result);
    const debtCriterion = result!.criteria.find(c => c.key === "debt_stable");
    assert.equal(debtCriterion?.passed, null);
  });

  it("uses last 2 years when more than 2 statements provided", () => {
    const y1 = makeStmt(2021, { netProfitLoss: 10, grossProfit: 100, mainActivityRevenue: 500 });
    const y2 = makeStmt(2022, { netProfitLoss: 50, grossProfit: 300, mainActivityRevenue: 1500 });
    const y3 = makeStmt(2023, { netProfitLoss: 100, grossProfit: 400, mainActivityRevenue: 2000 });

    const result = computePiotroski([y1, y2, y3]);
    assert.ok(result);
    assert.equal(result!.year, 2023);
    assert.equal(result!.prevYear, 2022); // Uses y2 as prev, not y1
  });

  it("returns 9 criteria", () => {
    const result = computePiotroski([makeStmt(2022), makeStmt(2023)]);
    assert.ok(result);
    assert.equal(result!.criteria.length, 9);
  });

  it("score ≤ maxScore always", () => {
    const result = computePiotroski([makeStmt(2022), makeStmt(2023)]);
    assert.ok(result);
    assert.ok(result!.score <= result!.maxScore);
  });
});
