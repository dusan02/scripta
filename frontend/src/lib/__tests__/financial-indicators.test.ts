import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeFinancialIndicators,
  fmtPct,
  fmtRatio,
  safeDiv,
  toNum,
  type FinancialIndicatorRow,
} from "@/lib/financial-indicators";

// ── Helpers ──────────────────────────────────────────────────────────────────

function stmt(overrides: Record<string, unknown> & { year: number }) {
  return {
    shortTermLiabilities: 100,
    longTermLiabilities: 50,
    totalAssets: 1000,
    currentAssets: 200,
    netProfitLoss: 80,
    equity: 400,
    mainActivityRevenue: 2000,
    ...overrides,
  };
}

// ── toNum ────────────────────────────────────────────────────────────────────

describe("financial-indicators — toNum()", () => {
  it("returns null for null/undefined", () => {
    assert.equal(toNum(null), null);
    assert.equal(toNum(undefined), null);
  });

  it("returns number as-is", () => {
    assert.equal(toNum(42), 42);
    assert.equal(toNum(0), 0);
    assert.equal(toNum(-3.14), -3.14);
  });

  it("converts string to number", () => {
    assert.equal(toNum("123.45"), 123.45);
    assert.equal(toNum("0"), 0);
  });

  it("returns null for non-numeric string", () => {
    assert.equal(toNum("abc"), null);
  });

  it("converts Decimal-like object with toNumber()", () => {
    assert.equal(toNum({ toNumber: () => 99.5 }), 99.5);
  });
});

// ── safeDiv ──────────────────────────────────────────────────────────────────

describe("financial-indicators — safeDiv()", () => {
  it("returns null if either operand is null", () => {
    assert.equal(safeDiv(null, 10), null);
    assert.equal(safeDiv(10, null), null);
  });

  it("returns null if divisor is 0", () => {
    assert.equal(safeDiv(10, 0), null);
  });

  it("returns quotient for valid inputs", () => {
    assert.equal(safeDiv(10, 2), 5);
    assert.equal(safeDiv(80, 400), 0.2);
  });
});

// ── fmtPct ───────────────────────────────────────────────────────────────────

describe("financial-indicators — fmtPct()", () => {
  it("returns — for null", () => {
    assert.equal(fmtPct(null), "—");
  });

  it("formats fraction as percentage with 1 decimal", () => {
    assert.equal(fmtPct(0.392), "39.2%");
    assert.equal(fmtPct(0.162), "16.2%");
    assert.equal(fmtPct(0.098), "9.8%");
    assert.equal(fmtPct(0.039), "3.9%");
  });

  it("handles 0 and negative values", () => {
    assert.equal(fmtPct(0), "0.0%");
    assert.equal(fmtPct(-0.05), "-5.0%");
  });
});

// ── fmtRatio ─────────────────────────────────────────────────────────────────

describe("financial-indicators — fmtRatio()", () => {
  it("returns — for null", () => {
    assert.equal(fmtRatio(null), "—");
  });

  it("formats decimal with 2 decimals", () => {
    assert.equal(fmtRatio(1.723), "1.72");
    assert.equal(fmtRatio(1.615), "1.61");
    assert.equal(fmtRatio(0.5), "0.50");
  });
});

// ── computeFinancialIndicators — 5-year mapping & metric mapping ─────────────

describe("financial-indicators — computeFinancialIndicators()", () => {
  it("sorts statements ascending by year", () => {
    const result = computeFinancialIndicators([
      stmt({ year: 2025 }),
      stmt({ year: 2021 }),
      stmt({ year: 2023 }),
    ]);
    assert.deepEqual(
      result.map((r) => r.year),
      [2021, 2023, 2025],
    );
  });

  it("computes all 5 metrics correctly for a full-data statement", () => {
    const result = computeFinancialIndicators([
      stmt({
        year: 2025,
        shortTermLiabilities: 100,
        longTermLiabilities: 50,
        totalAssets: 1000,
        currentAssets: 200,
        netProfitLoss: 80,
        equity: 400,
        mainActivityRevenue: 2000,
      }),
    ]);
    const row = result[0];
    // debt = (100 + 50) / 1000 = 0.15
    assert.equal(row.debt, 0.15);
    // currentRatio = 200 / 100 = 2
    assert.equal(row.currentRatio, 2);
    // roe = 80 / 400 = 0.2
    assert.equal(row.roe, 0.2);
    // roa = 80 / 1000 = 0.08
    assert.equal(row.roa, 0.08);
    // margin = 80 / 2000 = 0.04
    assert.equal(row.margin, 0.04);
  });

  it("maps 5 years correctly (Hugoko-style 2021-2025)", () => {
    const years = [2021, 2022, 2023, 2024, 2025];
    const result = computeFinancialIndicators(years.map((y) => stmt({ year: y })));
    assert.equal(result.length, 5);
    assert.deepEqual(
      result.map((r) => r.year),
      years,
    );
  });
});

// ── NULL handling ────────────────────────────────────────────────────────────

describe("financial-indicators — NULL handling", () => {
  it("preserves null for missing values — never converts to 0", () => {
    const result = computeFinancialIndicators([
      stmt({
        year: 2021,
        netProfitLoss: null,
        equity: null,
        totalAssets: null,
        mainActivityRevenue: null,
        currentAssets: null,
        shortTermLiabilities: null,
        longTermLiabilities: null,
      }),
    ]);
    const row = result[0];
    assert.equal(row.debt, null, "debt should be null when all liabilities null");
    assert.equal(row.currentRatio, null, "currentRatio should be null");
    assert.equal(row.roe, null, "roe should be null");
    assert.equal(row.roa, null, "roa should be null");
    assert.equal(row.margin, null, "margin should be null");
  });

  it("debt is null when both short and long term liabilities are null", () => {
    const result = computeFinancialIndicators([
      stmt({
        year: 2022,
        shortTermLiabilities: null,
        longTermLiabilities: null,
        totalAssets: 1000,
      }),
    ]);
    assert.equal(result[0].debt, null);
  });

  it("debt is computed when at least one liability source is present (null → 0)", () => {
    const result = computeFinancialIndicators([
      stmt({
        year: 2022,
        shortTermLiabilities: 100,
        longTermLiabilities: null,
        totalAssets: 1000,
      }),
    ]);
    // (100 + 0) / 1000 = 0.1
    assert.equal(result[0].debt, 0.1);
  });

  it("debt is null when totalAssets is null even if liabilities present", () => {
    const result = computeFinancialIndicators([
      stmt({
        year: 2022,
        shortTermLiabilities: 100,
        longTermLiabilities: 50,
        totalAssets: null,
      }),
    ]);
    assert.equal(result[0].debt, null);
  });

  it("roe is null when equity is 0 (safe div by zero)", () => {
    const result = computeFinancialIndicators([
      stmt({ year: 2022, netProfitLoss: 80, equity: 0 }),
    ]);
    assert.equal(result[0].roe, null);
  });

  it("roe is null when netProfitLoss is null", () => {
    const result = computeFinancialIndicators([
      stmt({ year: 2022, netProfitLoss: null, equity: 400 }),
    ]);
    assert.equal(result[0].roe, null);
  });

  it("margin is null when revenue is 0", () => {
    const result = computeFinancialIndicators([
      stmt({ year: 2022, netProfitLoss: 80, mainActivityRevenue: 0 }),
    ]);
    assert.equal(result[0].margin, null);
  });

  it("currentRatio is null when shortTermLiabilities is 0", () => {
    const result = computeFinancialIndicators([
      stmt({ year: 2022, currentAssets: 200, shortTermLiabilities: 0 }),
    ]);
    assert.equal(result[0].currentRatio, null);
  });

  it("mixed null and non-null across years preserves per-year nulls", () => {
    const result = computeFinancialIndicators([
      stmt({ year: 2021, netProfitLoss: 80, equity: 400 }), // roe = 0.2
      stmt({ year: 2022, netProfitLoss: null, equity: 400 }), // roe = null
      stmt({ year: 2023, netProfitLoss: 120, equity: null }), // roe = null
    ]);
    assert.equal(result[0].roe, 0.2);
    assert.equal(result[1].roe, null);
    assert.equal(result[2].roe, null);
  });
});

// ── Data integrity: chart vs table parity ────────────────────────────────────

describe("financial-indicators — chart/table parity", () => {
  it("fmtPct and fmtRatio produce the canonical display strings", () => {
    // These are the exact formats the table shows.
    // The chart tooltip uses the same functions → guaranteed identical display.
    assert.equal(fmtPct(0.392), "39.2%");
    assert.equal(fmtPct(0.162), "16.2%");
    assert.equal(fmtPct(0.098), "9.8%");
    assert.equal(fmtPct(0.039), "3.9%");
    assert.equal(fmtRatio(1.723), "1.72");
  });

  it("computeFinancialIndicators returns the same shape used by chart and table", () => {
    const result = computeFinancialIndicators([stmt({ year: 2025 })]);
    const row: FinancialIndicatorRow = result[0];
    // Chart reads row.debt, row.roe, etc. directly
    // Table reads byYear.get(year).debt, etc. directly
    // Both use the same object → no rounding divergence possible
    assert.ok(typeof row.debt === "number" || row.debt === null);
    assert.ok(typeof row.currentRatio === "number" || row.currentRatio === null);
    assert.ok(typeof row.roe === "number" || row.roe === null);
    assert.ok(typeof row.roa === "number" || row.roa === null);
    assert.ok(typeof row.margin === "number" || row.margin === null);
  });
});
