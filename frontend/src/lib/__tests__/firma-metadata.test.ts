import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Test generateFirmaMetadata ──────────────────────────────────────
// We import the real function to test actual output.

import { generateFirmaMetadata } from "../seo";

describe("generateFirmaMetadata", () => {
  it("SK: includes 'riziká' in title when hasRiskSignals=true", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", "Galanta", "sk", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.includes("riziká"), `title should contain 'riziká': ${title}`);
    assert.ok(title.includes("Novogal"), `title should contain company name: ${title}`);
    assert.ok(title.includes("00199567"), `title should contain IČO: ${title}`);
    assert.ok(title.includes("Verifa"), `title should contain brand: ${title}`);
  });

  it("SK: does NOT include 'riziká' when hasRiskSignals=false", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", "Galanta", "sk", false);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(!title.includes("riziká"), `title should NOT contain 'riziká': ${title}`);
    assert.ok(title.includes("finančné údaje"), `title should contain 'finančné údaje': ${title}`);
  });

  it("SK: default hasRiskSignals=false (no 'riziká')", () => {
    const md = generateFirmaMetadata("Test s.r.o.", "12345678", null, "sk");
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(!title.includes("riziká"), `default should NOT contain 'riziká': ${title}`);
  });

  it("SK: description includes 'rizikové signály' when hasRiskSignals=true", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", "Galanta", "sk", true);
    assert.ok(md.description!.includes("rizikové signály"), `desc should contain 'rizikové signály': ${md.description}`);
  });

  it("SK: description does NOT include 'rizikové signály' when hasRiskSignals=false", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", "Galanta", "sk", false);
    assert.ok(!md.description!.includes("rizikové signály"), `desc should NOT contain 'rizikové signály': ${md.description}`);
  });

  it("SK: description includes city when provided", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", "Galanta", "sk", true);
    assert.ok(md.description!.includes("Galanta"), `desc should contain city: ${md.description}`);
  });

  it("SK: description excludes city when null", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", null, "sk", true);
    assert.ok(!md.description!.includes(", Galanta"), `desc should not contain city: ${md.description}`);
  });

  it("EN: includes 'risk signals' when hasRiskSignals=true", () => {
    const md = generateFirmaMetadata("Test Corp", "12345678", null, "en", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.includes("risk signals"), `EN title should contain 'risk signals': ${title}`);
  });

  it("EN: does NOT include 'risk signals' when hasRiskSignals=false", () => {
    const md = generateFirmaMetadata("Test Corp", "12345678", null, "en", false);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(!title.includes("risk signals"), `EN title should NOT contain 'risk signals': ${title}`);
  });

  it("DE: includes 'Risikosignale' when hasRiskSignals=true", () => {
    const md = generateFirmaMetadata("Test GmbH", "12345678", null, "de", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.includes("Risikosignale"), `DE title should contain 'Risikosignale': ${title}`);
  });

  it("CS: includes 'riziková signály' when hasRiskSignals=true", () => {
    const md = generateFirmaMetadata("Test s.r.o.", "12345678", null, "cz", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.includes("riziková signály"), `CS title should contain 'riziková signály': ${title}`);
  });

  it("HU: includes 'kockázati jelek' when hasRiskSignals=true", () => {
    const md = generateFirmaMetadata("Test Kft.", "12345678", null, "hu", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.includes("kockázati jelek"), `HU title should contain 'kockázati jelek': ${title}`);
  });

  it("PL: includes 'sygnały ryzyka' when hasRiskSignals=true", () => {
    const md = generateFirmaMetadata("Test Sp.z o.o.", "12345678", null, "pl", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.includes("sygnały ryzyka"), `PL title should contain 'sygnały ryzyka': ${title}`);
  });

  // ── Title length constraints ──
  it("title length ≤ 65 chars for short names", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", "Galanta", "sk", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.length <= 65, `title too long (${title.length}): ${title}`);
  });

  it("title length ≤ 65 chars for long names (truncation)", () => {
    const longName = "RPC Bramlage Velký Meder s.r.o. Very Long Company Name That Exceeds Limit";
    const md = generateFirmaMetadata(longName, "36690929", null, "sk", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.length <= 65, `title too long (${title.length}): ${title}`);
  });

  it("title still contains IČO for long names", () => {
    const longName = "RPC Bramlage Velký Meder s.r.o. Very Long Company Name That Exceeds Limit";
    const md = generateFirmaMetadata(longName, "36690929", null, "sk", true);
    const title = (md.title as { absolute: string }).absolute;
    assert.ok(title.includes("36690929"), `truncated title should still contain IČO: ${title}`);
  });

  // ── Description length constraints ──
  it("description length ≤ 160 chars for short names", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", "Galanta", "sk", true);
    assert.ok(md.description!.length <= 160, `desc too long (${md.description!.length}): ${md.description}`);
  });

  it("description length ≤ 160 chars for long names", () => {
    const longName = "RPC Bramlage Velký Meder s.r.o. Very Long Company Name That Exceeds Limit And Then Some More";
    const md = generateFirmaMetadata(longName, "36690929", "Velký Meder", "sk", true);
    assert.ok(md.description!.length <= 160, `desc too long (${md.description!.length}): ${md.description}`);
  });

  it("description length ≥ 50 chars (minimum for regression tests)", () => {
    const md = generateFirmaMetadata("ABC", "12345678", null, "sk", false);
    assert.ok(md.description!.length >= 50, `desc too short (${md.description!.length}): ${md.description}`);
  });

  // ── Canonical + hreflang ──
  it("canonical URL includes slug", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", null, "sk", true);
    const canonical = (md.alternates as { canonical: string }).canonical;
    assert.ok(canonical.includes("/firma/00199567-"), `canonical should include slug: ${canonical}`);
  });

  it("hreflang alternates include all 6 languages + x-default", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", null, "sk", true);
    const languages = (md.alternates as { languages: Record<string, string> }).languages;
    assert.ok(languages["sk"], "missing sk hreflang");
    assert.ok(languages["en"], "missing en hreflang");
    assert.ok(languages["de"], "missing de hreflang");
    assert.ok(languages["cs"], "missing cs hreflang");
    assert.ok(languages["hu"], "missing hu hreflang");
    assert.ok(languages["pl"], "missing pl hreflang");
    assert.ok(languages["x-default"], "missing x-default hreflang");
  });

  // ── Robots ──
  it("robots index+follow for indexable company", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", null, "sk", true);
    assert.equal(md.robots?.index, true);
    assert.equal(md.robots?.follow, true);
  });

  // ── No duplicates in title ──
  it("title does not duplicate company name", () => {
    const md = generateFirmaMetadata("Novogal a.s.", "00199567", null, "sk", true);
    const title = (md.title as { absolute: string }).absolute;
    const nameCount = (title.match(/Novogal a\.s\./g) || []).length;
    assert.equal(nameCount, 1, `name appears ${nameCount} times in title: ${title}`);
  });
});
