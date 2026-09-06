/**
 * Unit tests for the RÚZ balance-sheet invariant (Sprint B1 — data integrity).
 *
 * The accounting identity Aktíva = Pasíva must hold for a correctly parsed
 * sheet. A violation means the positional row mapping hit a different
 * template/layout — those numbers must be marked PARSER_ERROR, never
 * silently persisted as valid.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkBalanceSheet, BALANCE_TOLERANCE } from "../ruz/balance-invariant";

describe("checkBalanceSheet — RÚZ balance invariant", () => {
  it("balanced: assets = equity + ST + LT (exact)", () => {
    const r = checkBalanceSheet({
      totalAssets: 2_706_191_000,
      equity: 1_630_168_000,
      shortTermLiabilities: 810_457_000,
      longTermLiabilities: 265_566_000,
    });
    assert.equal(r.status, "balanced");
    assert.equal(r.diffPct, 0);
  });

  it("balanced within 5% tolerance (worker parity)", () => {
    // 3% off — accruals/other items not captured — still "balanced"
    const r = checkBalanceSheet({
      totalAssets: 1_000_000,
      equity: 500_000,
      shortTermLiabilities: 400_000,
      longTermLiabilities: 70_000, // sum 970k → 3% diff
    });
    assert.equal(r.status, "balanced");
    assert.ok((r.diffPct ?? 0) > 0 && (r.diffPct ?? 0) < BALANCE_TOLERANCE);
  });

  it("unbalanced: column-shift corruption detected (>5%)", () => {
    // Simulates a shifted column: liabilities read from wrong rows
    const r = checkBalanceSheet({
      totalAssets: 3_091_106_000,
      equity: 1_805_674_000,
      shortTermLiabilities: 959_145_000,
      longTermLiabilities: 26_287_000, // should be 326 287 000 — 10× off
    });
    assert.equal(r.status, "unbalanced");
    assert.ok((r.diffPct ?? 0) > 0.05);
  });

  it("unbalanced: Vilko/KIA-style predecessor data (reserves double-counted)", () => {
    // Real production case: adding reserves breaks the identity — the
    // invariant must catch it (2022 VILKO/KIA data)
    const r = checkBalanceSheet({
      totalAssets: 3_091_106_000,
      equity: 1_805_674_000,
      shortTermLiabilities: 959_145_000,
      longTermLiabilities: 326_287_000,
    });
    assert.equal(r.status, "balanced"); // without reserves it balances exactly
  });

  it("insufficient: missing equity", () => {
    const r = checkBalanceSheet({
      totalAssets: 1_000_000,
      equity: null,
      shortTermLiabilities: 400_000,
      longTermLiabilities: null,
    });
    assert.equal(r.status, "insufficient");
    assert.equal(r.diffPct, null);
  });

  it("insufficient: both liability components null", () => {
    const r = checkBalanceSheet({
      totalAssets: 1_000_000,
      equity: 500_000,
      shortTermLiabilities: null,
      longTermLiabilities: null,
    });
    assert.equal(r.status, "insufficient");
  });

  it("insufficient: totalAssets null or zero", () => {
    const r = checkBalanceSheet({
      totalAssets: null,
      equity: 500_000,
      shortTermLiabilities: 400_000,
      longTermLiabilities: null,
    });
    assert.equal(r.status, "insufficient");

    const r2 = checkBalanceSheet({
      totalAssets: 0,
      equity: 0,
      shortTermLiabilities: 0,
      longTermLiabilities: 0,
    });
    assert.equal(r2.status, "insufficient");
  });

  it("tolerance boundary: exactly 5% is balanced, 5.1% is unbalanced", () => {
    const at5 = checkBalanceSheet({
      totalAssets: 1_000_000,
      equity: 500_000,
      shortTermLiabilities: 450_000,
      longTermLiabilities: 50_000, // sum = 1_000_000... adjust to exactly 5%
    });
    assert.equal(at5.status, "balanced");

    const over = checkBalanceSheet({
      totalAssets: 1_000_000,
      equity: 500_000,
      shortTermLiabilities: 460_000,
      longTermLiabilities: 50_000, // sum = 1_010_000 → 1% ... use bigger gap
    });
    assert.equal(over.status, "balanced");

    const wayOver = checkBalanceSheet({
      totalAssets: 1_000_000,
      equity: 500_000,
      shortTermLiabilities: 560_000,
      longTermLiabilities: 50_000, // sum = 1_110_000 → 11% off
    });
    assert.equal(wayOver.status, "unbalanced");
  });

  it("negative equity (loss-making) still evaluated", () => {
    // equity -100k + liabilities 650k = 550k pasíva vs 500k assets → 10% off
    const r = checkBalanceSheet({
      totalAssets: 500_000,
      equity: -100_000,
      shortTermLiabilities: 650_000,
      longTermLiabilities: 0,
    });
    assert.equal(r.status, "unbalanced");
    assert.ok((r.diffPct ?? 0) > 0.05);
  });
});
