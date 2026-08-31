/**
 * Unit tests for src/lib/company-insights.ts — generateCompanyInsights()
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateCompanyInsights, type Insight } from "@/lib/company-insights";

type Stmt = Parameters<typeof generateCompanyInsights>[0][number];

function makeStmt(year: number, overrides: Partial<Stmt> = {}): Stmt {
  return {
    year,
    mainActivityRevenue: 1_000_000,
    netProfitLoss: 100_000,
    totalAssets: 2_000_000,
    equity: 800_000,
    grossProfit: 400_000,
    staffCosts: 200_000,
    depreciation: 50_000,
    incomeTax: 20_000,
    shortTermLiabilities: 500_000,
    longTermLiabilities: 300_000,
    currentAssets: 600_000,
    cashAndEquivalents: 100_000,
    ...overrides,
  };
}

describe("company-insights.ts — generateCompanyInsights()", () => {
  it("returns empty array for no statements", () => {
    assert.deepEqual(generateCompanyInsights([]), []);
  });

  it("returns insights for single year (no trend, but margin)", () => {
    const insights = generateCompanyInsights([makeStmt(2023)]);
    // With 1 year: no trend insights, but profit margin should appear
    const marginInsight = insights.find(i => i.text.includes("Zisková marža"));
    assert.ok(marginInsight, "Should have profit margin insight");
  });

  it("generates revenue trend insight when revenue changes ≥1%", () => {
    const prev = makeStmt(2022, { mainActivityRevenue: 1_000_000 });
    const curr = makeStmt(2023, { mainActivityRevenue: 1_200_000 });

    const insights = generateCompanyInsights([prev, curr]);
    const revInsight = insights.find(i => i.text.includes("Tržby vzrástli"));
    assert.ok(revInsight, "Should have revenue growth insight");
    assert.equal(revInsight!.severity, "positive");
  });

  it("generates revenue decline insight", () => {
    const prev = makeStmt(2022, { mainActivityRevenue: 1_000_000 });
    const curr = makeStmt(2023, { mainActivityRevenue: 800_000 });

    const insights = generateCompanyInsights([prev, curr]);
    const revInsight = insights.find(i => i.text.includes("Tržby klesli"));
    assert.ok(revInsight, "Should have revenue decline insight");
    assert.equal(revInsight!.severity, "negative");
  });

  it("does NOT generate revenue insight for <1% change", () => {
    const prev = makeStmt(2022, { mainActivityRevenue: 1_000_000 });
    const curr = makeStmt(2023, { mainActivityRevenue: 1_005_000 }); // 0.5% change

    const insights = generateCompanyInsights([prev, curr]);
    const revInsight = insights.find(i => i.text.includes("Tržby"));
    assert.equal(revInsight, undefined);
  });

  it("generates profit trend insight", () => {
    const prev = makeStmt(2022, { netProfitLoss: 100_000 });
    const curr = makeStmt(2023, { netProfitLoss: 150_000 });

    const insights = generateCompanyInsights([prev, curr]);
    const profitInsight = insights.find(i => i.text.includes("Zisk vzrástol"));
    assert.ok(profitInsight);
    assert.equal(profitInsight!.severity, "positive");
  });

  it("generates loss insight when profit goes negative", () => {
    const prev = makeStmt(2022, { netProfitLoss: 100_000 });
    const curr = makeStmt(2023, { netProfitLoss: -50_000 });

    const insights = generateCompanyInsights([prev, curr]);
    const lossInsight = insights.find(i => i.text.includes("Strata"));
    assert.ok(lossInsight);
  });

  it("generates assets trend insight for ≥5% change", () => {
    const prev = makeStmt(2022, { totalAssets: 2_000_000 });
    const curr = makeStmt(2023, { totalAssets: 2_500_000 }); // 25% increase

    const insights = generateCompanyInsights([prev, curr]);
    const assetsInsight = insights.find(i => i.text.includes("Celkové aktíva"));
    assert.ok(assetsInsight);
  });

  it("does NOT generate assets insight for <5% change", () => {
    const prev = makeStmt(2022, { totalAssets: 2_000_000 });
    const curr = makeStmt(2023, { totalAssets: 2_080_000 }); // 4% change

    const insights = generateCompanyInsights([prev, curr]);
    const assetsInsight = insights.find(i => i.text.includes("Celkové aktíva"));
    assert.equal(assetsInsight, undefined);
  });

  it("generates equity trend insight for ≥5% change", () => {
    const prev = makeStmt(2022, { equity: 800_000 });
    const curr = makeStmt(2023, { equity: 1_000_000 }); // 25% increase

    const insights = generateCompanyInsights([prev, curr]);
    const eqInsight = insights.find(i => i.text.includes("Vlastné imanie"));
    assert.ok(eqInsight);
  });

  it("generates negative equity warning", () => {
    const curr = makeStmt(2023, { equity: -100_000 });

    const insights = generateCompanyInsights([curr]);
    const warning = insights.find(i => i.severity === "warning" && i.text.includes("záporné"));
    assert.ok(warning, "Should have negative equity warning");
  });

  it("generates profit margin insight", () => {
    const curr = makeStmt(2023, { mainActivityRevenue: 1_000_000, netProfitLoss: 100_000 });

    const insights = generateCompanyInsights([curr]);
    const margin = insights.find(i => i.text.includes("Zisková marža"));
    assert.ok(margin);
    assert.ok(margin!.text.includes("10.0 %"));
  });

  it("generates 3-year CAGR insight for ≥2% change", () => {
    const y1 = makeStmt(2021, { mainActivityRevenue: 1_000_000 });
    const y2 = makeStmt(2022, { mainActivityRevenue: 1_200_000 });
    const y3 = makeStmt(2023, { mainActivityRevenue: 1_500_000 });

    const insights = generateCompanyInsights([y1, y2, y3]);
    const cagr = insights.find(i => i.text.includes("Priemerný ročný"));
    assert.ok(cagr);
    assert.ok(cagr!.text.includes("rast"));
  });

  it("does NOT generate CAGR for <2% change", () => {
    const y1 = makeStmt(2021, { mainActivityRevenue: 1_000_000 });
    const y2 = makeStmt(2022, { mainActivityRevenue: 1_010_000 });
    const y3 = makeStmt(2023, { mainActivityRevenue: 1_020_000 }); // ~1% CAGR

    const insights = generateCompanyInsights([y1, y2, y3]);
    const cagr = insights.find(i => i.text.includes("Priemerný ročný"));
    assert.equal(cagr, undefined);
  });

  it("handles ORSR findings — likvidacia", () => {
    const insights = generateCompanyInsights([makeStmt(2023)], {
      orsrFindings: "Spoločnosť je v likvidácii",
    });
    const liq = insights.find(i => i.text.includes("likvidácii"));
    assert.ok(liq);
    assert.equal(liq!.severity, "warning");
  });

  it("handles ORSR findings — vymazaná", () => {
    const insights = generateCompanyInsights([makeStmt(2023)], {
      orsrFindings: "Spoločnosť bola vymazaná z registra",
    });
    const del = insights.find(i => i.text.includes("vymazaná"));
    assert.ok(del);
    assert.equal(del!.severity, "warning");
  });

  it("handles ORSR findings — normal (no insight)", () => {
    const insights = generateCompanyInsights([makeStmt(2023)], {
      orsrFindings: "Spoločnosť je zapísaná v registri",
    });
    const orsrInsight = insights.find(i => i.text.includes("Obchodnom registri"));
    assert.equal(orsrInsight, undefined);
  });

  it("handles Vestnik events", () => {
    const insights = generateCompanyInsights([makeStmt(2023)], {
      vestnikEvents: [
        { title: "Zápis novej osoby", publishedAt: new Date() },
        { title: "Zmena štatutára", publishedAt: new Date() },
      ],
    });
    const vestnikInsights = insights.filter(i => i.text.includes("Obchodnom vestníku"));
    assert.equal(vestnikInsights.length, 2);
  });

  it("limits Vestnik events to 2", () => {
    const insights = generateCompanyInsights([makeStmt(2023)], {
      vestnikEvents: [
        { title: "Event 1", publishedAt: new Date() },
        { title: "Event 2", publishedAt: new Date() },
        { title: "Event 3", publishedAt: new Date() },
        { title: "Event 4", publishedAt: new Date() },
      ],
    });
    const vestnikInsights = insights.filter(i => i.text.includes("Obchodnom vestníku"));
    assert.equal(vestnikInsights.length, 2);
  });

  it("handles null values in statements gracefully", () => {
    const prev = makeStmt(2022, {
      mainActivityRevenue: null,
      netProfitLoss: null,
      totalAssets: null,
      equity: null,
    });
    const curr = makeStmt(2023, {
      mainActivityRevenue: null,
      netProfitLoss: null,
      totalAssets: null,
      equity: null,
    });

    const insights = generateCompanyInsights([prev, curr]);
    // Should not crash, should not generate trend insights
    const trendInsights = insights.filter(i =>
      i.text.includes("Tržby") || i.text.includes("Zisk") || i.text.includes("aktíva") || i.text.includes("imanie")
    );
    assert.equal(trendInsights.length, 0);
  });

  it("sorts statements by year before processing", () => {
    const insights = generateCompanyInsights([
      makeStmt(2023, { mainActivityRevenue: 1_200_000 }),
      makeStmt(2022, { mainActivityRevenue: 1_000_000 }),
    ]);
    // Should detect growth despite unsorted input
    const revInsight = insights.find(i => i.text.includes("Tržby vzrástli"));
    assert.ok(revInsight);
  });
});
