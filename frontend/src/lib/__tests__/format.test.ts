import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the actual implementation by importing from source
import {
  num,
  fmtEUR,
  fmtNum,
  fmtYear,
  formatCompanyName,
} from "@/lib/format";

describe("format.ts — num()", () => {
  it("returns null for null input", () => {
    assert.equal(num(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(num(undefined), null);
  });

  it("returns number as-is", () => {
    assert.equal(num(42), 42);
    assert.equal(num(0), 0);
    assert.equal(num(-3.14), -3.14);
  });

  it("converts Decimal-like object with toNumber()", () => {
    const fakeDecimal = { toNumber: () => 99.5 };
    assert.equal(num(fakeDecimal as any), 99.5);
  });
});

describe("format.ts — fmtEUR()", () => {
  it("returns em-dash for null/undefined", () => {
    assert.equal(fmtEUR(null), "—");
    assert.equal(fmtEUR(undefined), "—");
  });

  it("formats millions", () => {
    const result = fmtEUR(1_500_000);
    assert.ok(result.includes("mil."));
    assert.ok(result.includes("1.50"));
  });

  it("formats thousands", () => {
    const result = fmtEUR(15_000);
    assert.ok(result.includes("tis."));
    assert.ok(result.includes("15.0"));
  });

  it("formats small numbers without prefix", () => {
    const result = fmtEUR(500);
    assert.equal(result, "500 €");
  });

  it("handles negative millions", () => {
    const result = fmtEUR(-2_500_000);
    assert.ok(result.includes("mil."));
    assert.ok(result.includes("-2.50"));
  });

  it("handles zero", () => {
    assert.equal(fmtEUR(0), "0 €");
  });
});

describe("format.ts — fmtNum()", () => {
  it("returns em-dash for null/undefined", () => {
    assert.equal(fmtNum(null), "—");
    assert.equal(fmtNum(undefined), "—");
  });

  it("formats numbers with thousands separator", () => {
    const result = fmtNum(5000);
    // sk-SK locale uses non-breaking space as thousands separator
    assert.ok(result.includes("5"));
  });

  it("handles zero", () => {
    const result = fmtNum(0);
    assert.ok(result.includes("0"));
  });
});

describe("format.ts — fmtYear()", () => {
  it("returns em-dash for null/undefined", () => {
    assert.equal(fmtYear(null), "—");
    assert.equal(fmtYear(undefined), "—");
  });

  it("extracts year from Date", () => {
    const date = new Date("2024-06-15T10:30:00Z");
    assert.equal(fmtYear(date), "2024");
  });

  it("extracts year from ISO string", () => {
    assert.equal(fmtYear(new Date("2023-01-01")), "2023");
  });
});

describe("format.ts — formatCompanyName()", () => {
  it("splits simple company name without legal status", () => {
    const result = formatCompanyName("ABC s.r.o.");
    assert.deepEqual(result, ["ABC s.r.o."]);
  });

  it("splits company name with 'v konkurze'", () => {
    const result = formatCompanyName("ABC s.r.o. v konkurze");
    assert.equal(result.length, 2);
    assert.ok(result[0].includes("ABC"));
    assert.ok(result[1].includes("konkurze"));
  });

  it("splits company name with 'v likvidácii'", () => {
    const result = formatCompanyName("XYZ a.s. v likvidácii");
    assert.equal(result.length, 2);
    assert.ok(result[0].includes("XYZ"));
    assert.ok(result[1].includes("likvid"));
  });

  it("extracts parenthesized text as separate line", () => {
    const result = formatCompanyName("ABC s.r.o. (od: 01.01.2023)");
    assert.ok(result.some((l) => l.includes("(od:")));
    assert.ok(result.some((l) => l.includes("ABC")));
  });

  it("handles name with both legal status and parentheses", () => {
    const result = formatCompanyName("ABC s.r.o. v konkurze (od: 01.01.2023)");
    assert.ok(result.length >= 2);
  });

  it("handles empty string gracefully", () => {
    const result = formatCompanyName("");
    // Empty string → returns [""] since lines is empty and name is ""
    assert.ok(result.length >= 1);
  });

  it("handles whitespace-only string", () => {
    const result = formatCompanyName("   ");
    assert.ok(result.length >= 1);
  });

  it("handles 'v reštrukturalizácii'", () => {
    const result = formatCompanyName("Firma v reštrukturalizácii");
    assert.ok(result.some((l) => l.includes("reštrukturaliz")));
  });

  it("handles 'konkurz' keyword", () => {
    const result = formatCompanyName("Firma konkurz");
    assert.ok(result.some((l) => l.includes("konkurz")));
  });
});
