import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PRICING_PLANS, REPORT_INCLUDES_KEYS } from "../pricing-plans";

describe("pricing-plans.ts — PRICING_PLANS structure", () => {
  it("has exactly 3 plans", () => {
    assert.equal(PRICING_PLANS.length, 3);
  });

  it("all plans have unique IDs", () => {
    const ids = PRICING_PLANS.map((p) => p.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "Plan IDs must be unique");
  });

  it("all plans have required fields", () => {
    for (const plan of PRICING_PLANS) {
      assert.ok(plan.id, "Missing id");
      assert.ok(plan.nameKey, `Missing nameKey in ${plan.id}`);
      assert.ok(plan.subtitleKey, `Missing subtitleKey in ${plan.id}`);
      assert.ok(plan.reports > 0, `Invalid reports in ${plan.id}`);
      assert.ok(plan.price, `Missing price in ${plan.id}`);
      assert.ok(plan.pricePerReport, `Missing pricePerReport in ${plan.id}`);
      assert.ok(typeof plan.isSubscription === "boolean");
      assert.ok(Array.isArray(plan.featureKeys));
      assert.ok(plan.featureKeys.length > 0, `Empty featureKeys in ${plan.id}`);
      assert.ok(typeof plan.highlight === "boolean");
    }
  });

  it("all plans are pay-as-you-go (no subscriptions)", () => {
    for (const plan of PRICING_PLANS) {
      assert.equal(plan.isSubscription, false, `${plan.id} should not be a subscription`);
      assert.ok(["payg1", "payg10", "payg50"].includes(plan.id));
    }
  });

  it("at least one plan is highlighted", () => {
    const highlighted = PRICING_PLANS.filter((p) => p.highlight);
    assert.ok(highlighted.length >= 1, "At least one plan should be highlighted");
  });

  it("payg1 has 1 report", () => {
    const payg1 = PRICING_PLANS.find((p) => p.id === "payg1");
    assert.equal(payg1?.reports, 1);
  });

  it("payg10 has 10 reports", () => {
    const payg10 = PRICING_PLANS.find((p) => p.id === "payg10");
    assert.equal(payg10?.reports, 10);
  });

  it("payg50 has 50 reports", () => {
    const payg50 = PRICING_PLANS.find((p) => p.id === "payg50");
    assert.equal(payg50?.reports, 50);
  });

  it("price per report decreases with volume", () => {
    const payg1 = PRICING_PLANS.find((p) => p.id === "payg1")!;
    const payg10 = PRICING_PLANS.find((p) => p.id === "payg10")!;
    const payg50 = PRICING_PLANS.find((p) => p.id === "payg50")!;
    const p1 = parseFloat(payg1.pricePerReport.replace(",", "."));
    const p10 = parseFloat(payg10.pricePerReport.replace(",", "."));
    const p50 = parseFloat(payg50.pricePerReport.replace(",", "."));
    assert.ok(p1 > p10, "payg1 should be more expensive per report than payg10");
    assert.ok(p10 > p50, "payg10 should be more expensive per report than payg50");
  });

  it("all featureKeys are non-empty strings", () => {
    for (const plan of PRICING_PLANS) {
      for (const key of plan.featureKeys) {
        assert.ok(typeof key === "string" && key.length > 0, `Empty featureKey in ${plan.id}`);
        assert.ok(key.startsWith("pricing."), `Feature key ${key} should start with "pricing."`);
      }
    }
  });

  it("all nameKeys start with 'pricing.'", () => {
    for (const plan of PRICING_PLANS) {
      assert.ok(plan.nameKey.startsWith("pricing."), `nameKey ${plan.nameKey} should start with "pricing."`);
      assert.ok(plan.subtitleKey.startsWith("pricing."), `subtitleKey ${plan.subtitleKey} should start with "pricing."`);
    }
  });
});

describe("pricing-plans.ts — REPORT_INCLUDES_KEYS", () => {
  it("has 12 include keys", () => {
    assert.equal(REPORT_INCLUDES_KEYS.length, 12);
  });

  it("all keys are non-empty strings starting with 'pricing.'", () => {
    for (const key of REPORT_INCLUDES_KEYS) {
      assert.ok(typeof key === "string" && key.length > 0);
      assert.ok(key.startsWith("pricing.inc"), `Key ${key} should start with "pricing.inc"`);
    }
  });

  it("all keys are unique", () => {
    const unique = new Set(REPORT_INCLUDES_KEYS);
    assert.equal(unique.size, REPORT_INCLUDES_KEYS.length);
  });
});
