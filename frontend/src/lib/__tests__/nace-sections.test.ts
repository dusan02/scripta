/**
 * Unit tests for src/lib/nace-sections.ts — naceSection()
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { naceSection } from "@/lib/nace-sections";

describe("nace-sections.ts — naceSection()", () => {
  it("returns section A for agriculture (division 1-3)", () => {
    assert.deepEqual(naceSection("01"), { section: "A", sectionName: "Poľnohospodárstvo, lesníctvo a rybolov" });
    assert.deepEqual(naceSection("02"), { section: "A", sectionName: "Poľnohospodárstvo, lesníctvo a rybolov" });
    assert.deepEqual(naceSection("03"), { section: "A", sectionName: "Poľnohospodárstvo, lesníctvo a rybolov" });
  });

  it("returns section C for manufacturing (division 10-33)", () => {
    assert.equal(naceSection("10").section, "C");
    assert.equal(naceSection("25").section, "C");
    assert.equal(naceSection("33").section, "C");
  });

  it("returns section G for wholesale/retail (division 45-47)", () => {
    assert.equal(naceSection("45").section, "G");
    assert.equal(naceSection("47").section, "G");
  });

  it("returns section J for IT (division 58-63)", () => {
    assert.equal(naceSection("62").section, "J");
  });

  it("returns section M for professional services (division 69-75)", () => {
    assert.equal(naceSection("70").section, "M");
  });

  it("handles single-division sections (D, L, O, P)", () => {
    assert.equal(naceSection("35").section, "D");
    assert.equal(naceSection("68").section, "L");
    assert.equal(naceSection("84").section, "O");
    assert.equal(naceSection("85").section, "P");
  });

  it("returns section U for extraterritorial (division 99)", () => {
    assert.equal(naceSection("99").section, "U");
  });

  it("returns empty for gaps between sections (e.g. 34, 40)", () => {
    assert.deepEqual(naceSection("34"), { section: "", sectionName: "" });
    assert.deepEqual(naceSection("40"), { section: "", sectionName: "" });
    assert.deepEqual(naceSection("44"), { section: "", sectionName: "" });
  });

  it("returns empty for invalid/non-numeric input", () => {
    assert.deepEqual(naceSection("XX"), { section: "", sectionName: "" });
    assert.deepEqual(naceSection(""), { section: "", sectionName: "" });
  });

  it("handles full NACE codes (takes first 2 digits)", () => {
    assert.equal(naceSection("620100").section, "J");
    assert.equal(naceSection("471100").section, "G");
    assert.equal(naceSection("011100").section, "A");
  });

  it("sectionName is always a non-empty string for valid sections", () => {
    for (const div of ["01", "10", "35", "45", "62", "70", "85", "99"]) {
      const result = naceSection(div);
      if (result.section) {
        assert.ok(result.sectionName.length > 0, `Empty sectionName for division ${div}`);
      }
    }
  });
});
