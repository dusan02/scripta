import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test IČO validation logic used across company lookup endpoints.
// The regex /^\d{8}$/ is the standard validation used in:
// - /api/lookup/route.ts
// - /api/company/[ico]/route.ts
// - /api/reports/schema.ts (Zod)

const ICO_PATTERN = /^\d{8}$/;

function isValidIco(ico: string | null | undefined): boolean {
  if (!ico) return false;
  return ICO_PATTERN.test(ico);
}

describe("IČO validation", () => {
  it("accepts valid 8-digit IČOs", () => {
    assert.ok(isValidIco("12345678"));
    assert.ok(isValidIco("00000000"));
    assert.ok(isValidIco("99999999"));
    assert.ok(isValidIco("36064820")); // Real Slovak IČO
  });

  it("rejects non-numeric IČOs", () => {
    assert.ok(!isValidIco("abcdefgh"));
    assert.ok(!isValidIco("1234567a"));
    assert.ok(!isValidIco("1234-678"));
    assert.ok(!isValidIco("12 34 56 78"));
  });

  it("rejects wrong-length IČOs", () => {
    assert.ok(!isValidIco("1234567")); // 7 digits
    assert.ok(!isValidIco("123456789")); // 9 digits
    assert.ok(!isValidIco("123456")); // 6 digits
    assert.ok(!isValidIco("")); // empty
  });

  it("rejects null/undefined/empty", () => {
    assert.ok(!isValidIco(null));
    assert.ok(!isValidIco(undefined));
    assert.ok(!isValidIco(""));
    assert.ok(!isValidIco("   "));
  });

  it("rejects IČO with special characters", () => {
    assert.ok(!isValidIco("1234567\n8"));
    assert.ok(!isValidIco("1234567\t8"));
    assert.ok(!isValidIco("12345678 "));
    assert.ok(!isValidIco(" 12345678"));
    assert.ok(!isValidIco("+1234567"));
  });
});

// Test slug parsing for company URLs
describe("parseCompanySlug", () => {
  const SLUG_PATTERN = /^(\d{8,10})-(.+)$/;
  const ICO_ONLY_PATTERN = /^(\d{8,10})$/;

  function parseCompanySlug(param: string): { ico: string; slug: string } | null {
    const match = param.match(SLUG_PATTERN);
    if (match) return { ico: match[1], slug: match[2] };
    const icoOnly = param.match(ICO_ONLY_PATTERN);
    if (icoOnly) return { ico: icoOnly[1], slug: "" };
    return null;
  }

  it("parses IČO with slug", () => {
    const result = parseCompanySlug("12345678-test-firma");
    assert.ok(result);
    assert.equal(result!.ico, "12345678");
    assert.equal(result!.slug, "test-firma");
  });

  it("parses IČO only (no slug)", () => {
    const result = parseCompanySlug("12345678");
    assert.ok(result);
    assert.equal(result!.ico, "12345678");
    assert.equal(result!.slug, "");
  });

  it("returns null for invalid input", () => {
    assert.ok(!parseCompanySlug("invalid"));
    assert.ok(!parseCompanySlug(""));
    assert.ok(!parseCompanySlug("abc-123"));
    assert.ok(!parseCompanySlug("-test"));
  });

  it("accepts 8-10 digit IČOs", () => {
    assert.ok(parseCompanySlug("12345678"));
    assert.ok(parseCompanySlug("1234567890"));
    assert.ok(parseCompanySlug("1234567890-firma"));
  });

  it("rejects too-short IČOs", () => {
    assert.ok(!parseCompanySlug("1234567"));
    assert.ok(!parseCompanySlug("1234567-test"));
  });
});

// Test slugify for company names
describe("slugify", () => {
  function slugify(name: string | null | undefined): string {
    if (!name) return "firma";
    return name
      .toLowerCase()
      .replace(/[áä]/g, "a")
      .replace(/[éě]/g, "e")
      .replace(/[í]/g, "i")
      .replace(/[óô]/g, "o")
      .replace(/[úů]/g, "u")
      .replace(/[ý]/g, "y")
      .replace(/[ž]/g, "z")
      .replace(/[š]/g, "s")
      .replace(/[č]/g, "c")
      .replace(/[ř]/g, "r")
      .replace(/[ď]/g, "d")
      .replace(/[ť]/g, "t")
      .replace(/[ň]/g, "n")
      .replace(/[ľĺ]/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "firma";
  }

  it("handles Slovak diacritics", () => {
    assert.equal(slugify("Živnostník Ján"), "zivnostnik-jan");
    assert.equal(slugify("Slovenská sporiteľňa"), "slovenska-sporitelna");
    assert.equal(slugify("ČSOB"), "csob");
  });

  it("handles null/undefined/empty", () => {
    assert.equal(slugify(null), "firma");
    assert.equal(slugify(undefined), "firma");
    assert.equal(slugify(""), "firma");
  });

  it("handles special characters", () => {
    assert.equal(slugify("Firma s.r.o."), "firma-s-r-o");
    assert.equal(slugify("Test & Co."), "test-co");
    assert.equal(slugify("A/B/C"), "a-b-c");
  });

  it("truncates to 60 characters", () => {
    const long = "a".repeat(100);
    const result = slugify(long);
    assert.ok(result.length <= 60);
  });
});

// Test toFloat parsing for RUZ financial data
describe("toFloat parsing", () => {
  function toFloat(val: any): number | null {
    if (val === null || val === undefined || val === "" || val === " ") return null;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      let c = val.trim();
      if (!c) return null;
      let neg = false;
      if (c.startsWith("(") && c.endsWith(")")) { neg = true; c = c.slice(1, -1).trim(); }
      c = c.replace(/[\s\xa0]/g, "");
      if (c.includes(",") && c.includes(".")) {
        if (c.lastIndexOf(",") > c.lastIndexOf(".")) c = c.replace(/\./g, "").replace(",", ".");
        else c = c.replace(/,/g, "");
      } else if (c.includes(",")) c = c.replace(",", ".");
      if ((c.match(/\./g) || []).length > 1) {
        const p = c.split("."); c = p.slice(0, -1).join("") + "." + p[p.length - 1];
      }
      const r = parseFloat(c);
      if (isNaN(r)) return null;
      return neg ? -r : r;
    }
    return null;
  }

  it("handles null/undefined/empty", () => {
    assert.equal(toFloat(null), null);
    assert.equal(toFloat(undefined), null);
    assert.equal(toFloat(""), null);
    assert.equal(toFloat(" "), null);
  });

  it("handles numbers directly", () => {
    assert.equal(toFloat(123), 123);
    assert.equal(toFloat(123.45), 123.45);
    assert.equal(toFloat(0), 0);
  });

  it("handles string numbers", () => {
    assert.equal(toFloat("123"), 123);
    assert.equal(toFloat("123.45"), 123.45);
    assert.equal(toFloat(" 123 "), 123);
  });

  it("handles Slovak number format (comma decimal)", () => {
    assert.equal(toFloat("123,45"), 123.45);
    assert.equal(toFloat("1 234,56"), 1234.56);
  });

  it("handles thousands separators", () => {
    assert.equal(toFloat("1.234,56"), 1234.56);
    assert.equal(toFloat("1,234.56"), 1234.56);
  });

  it("handles negative values in parentheses", () => {
    assert.equal(toFloat("(123)"), -123);
    assert.equal(toFloat("(123.45)"), -123.45);
    assert.equal(toFloat("(1 234)"), -1234);
  });

  it("handles non-breaking spaces", () => {
    assert.equal(toFloat("1\xa0234"), 1234);
  });

  it("returns null for invalid input", () => {
    assert.equal(toFloat("abc"), null);
    assert.equal(toFloat("N/A"), null);
  });
});
