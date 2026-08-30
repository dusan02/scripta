import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateFinancialSummary } from "../financial-summary";

describe("generateFinancialSummary", () => {
  it("returns null when no latest statement", () => {
    assert.equal(generateFinancialSummary("Firma", null, null, "sk"), null);
    assert.equal(generateFinancialSummary("Firma", undefined, undefined, "en"), null);
  });

  it("describes revenue growth + profit growth + margin in Slovak", () => {
    const s = generateFinancialSummary(
      "TestFirma, s.r.o.",
      { year: 2024, mainActivityRevenue: 1_200_000, netProfitLoss: 120_000 },
      { year: 2023, mainActivityRevenue: 1_000_000, netProfitLoss: 100_000 },
      "sk"
    );
    assert.ok(s);
    assert.ok(s.includes("TestFirma, s.r.o. dosiahla rast tržieb o 20%"));
    assert.ok(s.includes("zisk vzrástol o 20%"));
    assert.ok(s.includes("Zisková marža dosiahla 10.0%"));
    assert.ok(s.endsWith("."));
  });

  it("describes declines with absolute percentages", () => {
    const s = generateFinancialSummary(
      "Firma",
      { year: 2024, mainActivityRevenue: 800_000, netProfitLoss: 50_000 },
      { year: 2023, mainActivityRevenue: 1_000_000, netProfitLoss: 100_000 },
      "sk"
    );
    assert.ok(s!.includes("pokles tržieb o 20%"));
    assert.ok(s!.includes("zisk klesol o 50%"));
  });

  it("translates the narrative to English", () => {
    const s = generateFinancialSummary(
      "Acme Ltd.",
      { year: 2024, mainActivityRevenue: 1_100_000, netProfitLoss: 55_000 },
      { year: 2023, mainActivityRevenue: 1_000_000, netProfitLoss: 50_000 },
      "en"
    );
    assert.ok(s!.includes("Acme Ltd. achieved revenue growth of 10%"));
    assert.ok(s!.includes("profit rose by 10%"));
    assert.ok(s!.includes("Profit margin reached 5.0%"));
  });

  it("mentions stable revenue when trend is flat", () => {
    const s = generateFinancialSummary(
      "Firma",
      { year: 2024, mainActivityRevenue: 1_000_000, netProfitLoss: null },
      { year: 2023, mainActivityRevenue: 1_000_000, netProfitLoss: null },
      "sk"
    );
    assert.ok(s!.includes("udržala stabilné tržby"));
  });

  it("skips margin when revenue is zero", () => {
    const s = generateFinancialSummary(
      "Firma",
      { year: 2024, mainActivityRevenue: 0, netProfitLoss: 100 },
      { year: 2023, mainActivityRevenue: 0, netProfitLoss: 50 },
      "sk"
    );
    assert.ok(!s!.includes("marža"));
  });

  it("no Slovak narrative leaks into non-SK languages", () => {
    for (const lang of ["en", "de", "cz", "hu", "pl"] as const) {
      const s = generateFinancialSummary(
        "Firma",
        { year: 2024, mainActivityRevenue: 1_100_000, netProfitLoss: 110_000 },
        { year: 2023, mainActivityRevenue: 1_000_000, netProfitLoss: 100_000 },
        lang
      );
      assert.ok(s, `${lang} summary missing`);
      assert.ok(!s.includes("tržieb"), `${lang} leaked Slovak: ${s}`);
      assert.ok(!s.includes("marža"), `${lang} leaked Slovak: ${s}`);
    }
  });
});
