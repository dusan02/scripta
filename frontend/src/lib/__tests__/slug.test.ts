import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { slugify, buildCompanyUrl, parseCompanySlug } from "@/lib/slug";

describe("slug.ts — slugify()", () => {
  it("returns 'firma' for null input", () => {
    assert.equal(slugify(null), "firma");
  });

  it("returns 'firma' for undefined input", () => {
    assert.equal(slugify(undefined), "firma");
  });

  it("returns 'firma' for empty string", () => {
    assert.equal(slugify(""), "firma");
  });

  it("converts Slovak diacritics to ASCII", () => {
    assert.equal(slugify("Železná"), "zelezna");
    assert.equal(slugify("Čierny"), "cierny");
    assert.equal(slugify("Šťastný"), "stastny");
    assert.equal(slugify("Ľubomír"), "lubomir");
  });

  it("converts Czech diacritics", () => {
    assert.equal(slugify("Děkuji"), "dekuji");
    assert.equal(slugify("Řepa"), "repa");
    assert.equal(slugify("Něco"), "neco");
  });

  it("replaces spaces and special chars with hyphens", () => {
    assert.equal(slugify("ABC s.r.o."), "abc-s-r-o");
    assert.equal(slugify("Foo & Bar"), "foo-bar");
  });

  it("removes leading/trailing hyphens", () => {
    assert.equal(slugify("---test---"), "test");
  });

  it("collapses multiple hyphens", () => {
    assert.equal(slugify("a   b   c"), "a-b-c");
  });

  it("truncates to 60 characters", () => {
    const long = "a".repeat(100);
    const result = slugify(long);
    assert.ok(result.length <= 60);
  });

  it("returns 'firma' if result is empty after processing", () => {
    assert.equal(slugify("!!!"), "firma");
  });

  it("handles mixed case with diacritics", () => {
    assert.equal(slugify("Šílený Účet"), "sileny-ucet");
  });
});

describe("slug.ts — buildCompanyUrl()", () => {
  it("builds URL with IČO and slug", () => {
    const url = buildCompanyUrl("12345678", "ABC s.r.o.");
    assert.equal(url, "/firma/12345678-abc-s-r-o");
  });

  it("handles null company name", () => {
    const url = buildCompanyUrl("12345678", null);
    assert.equal(url, "/firma/12345678-firma");
  });

  it("handles undefined company name", () => {
    const url = buildCompanyUrl("12345678", undefined);
    assert.equal(url, "/firma/12345678-firma");
  });
});

describe("slug.ts — parseCompanySlug()", () => {
  it("parses IČO + slug format", () => {
    const result = parseCompanySlug("12345678-abc-s-r-o");
    assert.equal(result?.ico, "12345678");
    assert.equal(result?.slug, "abc-s-r-o");
  });

  it("parses IČO-only format (8 digits)", () => {
    const result = parseCompanySlug("12345678");
    assert.equal(result?.ico, "12345678");
    assert.equal(result?.slug, "");
  });

  it("parses IČO with 10 digits", () => {
    const result = parseCompanySlug("1234567890");
    assert.equal(result?.ico, "1234567890");
    assert.equal(result?.slug, "");
  });

  it("returns null for invalid format (too few digits)", () => {
    const result = parseCompanySlug("1234567");
    assert.equal(result, null);
  });

  it("returns null for non-numeric IČO", () => {
    const result = parseCompanySlug("abcd5678-test");
    assert.equal(result, null);
  });

  it("returns null for empty string", () => {
    const result = parseCompanySlug("");
    assert.equal(result, null);
  });

  it("returns null for letters only", () => {
    const result = parseCompanySlug("test");
    assert.equal(result, null);
  });
});
