import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { calcTrend } from "@/lib/trend";

describe("trend.ts — calcTrend()", () => {
  it("returns undefined when curr is null", () => {
    assert.equal(calcTrend(null, 100), undefined);
  });

  it("returns undefined when prev is null", () => {
    assert.equal(calcTrend(100, null), undefined);
  });

  it("returns undefined when prev is 0", () => {
    assert.equal(calcTrend(100, 0), undefined);
  });

  it("returns undefined when both are null", () => {
    assert.equal(calcTrend(null, null), undefined);
  });

  it("returns flat when change is < 1%", () => {
    const result = calcTrend(100.5, 100);
    assert.equal(result?.direction, "flat");
    assert.equal(result?.pct, 0);
  });

  it("returns up when curr > prev", () => {
    const result = calcTrend(150, 100);
    assert.equal(result?.direction, "up");
    assert.equal(result?.pct, 50);
  });

  it("returns down when curr < prev", () => {
    const result = calcTrend(50, 100);
    assert.equal(result?.direction, "down");
    assert.equal(result?.pct, 50);
  });

  it("handles negative prev (loss to profit)", () => {
    const result = calcTrend(100000, -50000);
    assert.equal(result?.direction, "up");
    // (100000 - (-50000)) / |-50000| * 100 = 300
    assert.equal(result?.pct, 300);
  });

  it("handles both negative (smaller loss)", () => {
    const result = calcTrend(-100, -200);
    assert.equal(result?.direction, "up");
    assert.equal(result?.pct, 50);
  });

  it("handles both negative (bigger loss)", () => {
    const result = calcTrend(-300, -100);
    assert.equal(result?.direction, "down");
    assert.equal(result?.pct, 200);
  });

  it("handles undefined inputs", () => {
    assert.equal(calcTrend(undefined, undefined), undefined);
    assert.equal(calcTrend(100, undefined), undefined);
  });
});
