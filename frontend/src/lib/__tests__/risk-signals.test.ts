import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRiskSignals } from "../risk-signals";

const BASE_COMPANY = { legalStatus: null, legalStatusSource: null, vestnikEvents: [] };

describe("computeRiskSignals", () => {
  it("returns no signals for a healthy company", () => {
    const signals = computeRiskSignals(BASE_COMPANY, { year: 2024, equity: 1000 }, "sk");
    assert.equal(signals.length, 0);
  });

  it("emits critical signal for BANKRUPT with Slovak description", () => {
    const signals = computeRiskSignals(
      { ...BASE_COMPANY, legalStatus: "BANKRUPT", legalStatusSource: "ORSR" },
      null,
      "sk"
    );
    assert.equal(signals.length, 1);
    assert.equal(signals[0].id, "legal-bankrupt");
    assert.equal(signals[0].severity, "critical");
    assert.equal(signals[0].description, "Firma je v konkurznom konaní.");
  });

  it("translates legal status descriptions to English", () => {
    const signals = computeRiskSignals(
      { ...BASE_COMPANY, legalStatus: "LIQUIDATION", legalStatusSource: null },
      null,
      "en"
    );
    assert.equal(signals[0].description, "The company is in liquidation.");
    assert.equal(signals[0].source, "ORSR");
  });

  it("emits forensic signals with interpolated amount and year", () => {
    const signals = computeRiskSignals(
      BASE_COMPANY,
      { year: 2025, socialInsuranceLiabilities: 1_090_000, taxLiabilities: 500, equity: 100 },
      "sk"
    );
    const socIns = signals.find(s => s.id === "forensic-soc-ins");
    const tax = signals.find(s => s.id === "forensic-tax");
    assert.ok(socIns);
    assert.ok(socIns.description.includes("1.09 mil. €"));
    assert.ok(socIns.description.includes("2025"));
    assert.ok(tax);
    assert.equal(socIns.severity, "high");
  });

  it("translates forensic titles to German", () => {
    const signals = computeRiskSignals(
      BASE_COMPANY,
      { year: 2025, socialInsuranceLiabilities: 1000 },
      "de"
    );
    assert.equal(signals[0].title, "Verbindlichkeiten gegenüber der Sozialversicherung");
  });

  it("detects negative equity", () => {
    const signals = computeRiskSignals(BASE_COMPANY, { year: 2024, equity: -5000 }, "sk");
    const neg = signals.find(s => s.id === "financial-neg-equity");
    assert.ok(neg);
    assert.equal(neg.type, "financial");
    assert.ok(neg.description.includes("-5 000 €") || neg.description.includes("tis. €"));
  });

  it("maps vestnik severity levels and localizes the date", () => {
    const signals = computeRiskSignals(
      {
        ...BASE_COMPANY,
        vestnikEvents: [
          { id: "v1", eventType: "Konkurz", summary: "Vyhlásený konkurz", severityLevel: "CRITICAL", publishedAt: "2025-03-15" },
          { id: "v2", eventType: "Zmena", summary: "Zmena sídla", severityLevel: "LOW", publishedAt: "2025-01-10" },
        ],
      },
      null,
      "en"
    );
    assert.equal(signals.length, 2);
    assert.equal(signals[0].severity, "critical");
    assert.equal(signals[1].severity, "low");
    assert.equal(signals[0].source, "Obchodný vestník");
    assert.ok(signals[0].date);
  });

  it("limits vestnik events to 5", () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      id: `v${i}`, eventType: "Udalosť", summary: "s", severityLevel: "LOW", publishedAt: "2025-01-01",
    }));
    const signals = computeRiskSignals({ ...BASE_COMPANY, vestnikEvents: events }, null, "sk");
    assert.equal(signals.filter(s => s.type === "vestnik").length, 5);
  });

  it("renders no hardcoded Slovak UI text in non-SK languages", () => {
    for (const lang of ["en", "de", "cz", "hu", "pl"] as const) {
      const signals = computeRiskSignals(
        { ...BASE_COMPANY, legalStatus: "BANKRUPT", legalStatusSource: "ORSR" },
        { year: 2025, socialInsuranceLiabilities: 100, equity: -1 },
        lang
      );
      const joined = signals.map(s => `${s.title} ${s.description}`).join(" ");
      // Slovak-specific phrases (diacritics/wording not present in correct translations)
      assert.ok(!joined.includes("konkurznom konaní"), `${lang} leaked Slovak: ${joined}`);
      assert.ok(!joined.includes("Záväzky voči"), `${lang} leaked Slovak: ${joined}`);
      assert.ok(!joined.includes("vlastné imanie"), `${lang} leaked Slovak: ${joined}`);
    }
  });
});
