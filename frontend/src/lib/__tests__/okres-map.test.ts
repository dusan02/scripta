/**
 * Unit tests for src/lib/okres-map.ts — okresName() + OKRES_CODE_TO_NAME
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { OKRES_CODE_TO_NAME, okresName } from "@/lib/okres-map";

describe("okres-map.ts — OKRES_CODE_TO_NAME", () => {
  it("contains all 8 Bratislava districts", () => {
    for (const code of ["SK0101", "SK0102", "SK0103", "SK0104", "SK0105", "SK0106", "SK0107", "SK0108"]) {
      assert.ok(OKRES_CODE_TO_NAME[code], `Missing ${code}`);
    }
  });

  it("has human-readable names (not raw codes)", () => {
    assert.equal(OKRES_CODE_TO_NAME["SK0101"], "Bratislava I");
    assert.equal(OKRES_CODE_TO_NAME["SK031B"], "Žilina");
    assert.equal(OKRES_CODE_TO_NAME["SK0426"], "Košice – okolie");
  });

  it("has >70 districts (all LAU1 codes)", () => {
    assert.ok(Object.keys(OKRES_CODE_TO_NAME).length >= 70,
      `Expected ≥70 districts, got ${Object.keys(OKRES_CODE_TO_NAME).length}`);
  });

  it("all values are non-empty strings", () => {
    for (const [code, name] of Object.entries(OKRES_CODE_TO_NAME)) {
      assert.ok(typeof name === "string" && name.length > 0, `Empty name for ${code}`);
    }
  });
});

describe("okres-map.ts — okresName()", () => {
  it("returns correct name for known code", () => {
    assert.equal(okresName("SK0101"), "Bratislava I");
    assert.equal(okresName("SK0229"), "Trenčín");
    assert.equal(okresName("SK0422"), "Košice I");
  });

  it("returns 'Zahraničné' for SKZZZZ (foreign placeholder)", () => {
    assert.equal(okresName("SKZZZZ"), "Zahraničné");
  });

  it("returns the raw code for unknown codes (fallback)", () => {
    assert.equal(okresName("SK9999"), "SK9999");
    assert.equal(okresName("UNKNOWN"), "UNKNOWN");
  });

  it("returns raw code for empty string", () => {
    assert.equal(okresName(""), "");
  });
});
