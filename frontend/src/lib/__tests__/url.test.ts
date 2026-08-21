import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toURLSearchParams, spStr } from "@/lib/url";

describe("url.ts — toURLSearchParams()", () => {
  it("converts simple string values", () => {
    const params = toURLSearchParams({ q: "test", page: "2" });
    assert.equal(params.get("q"), "test");
    assert.equal(params.get("page"), "2");
  });

  it("handles string[] values (takes first element)", () => {
    const params = toURLSearchParams({ tags: ["a", "b"] });
    assert.equal(params.get("tags"), "a");
  });

  it("skips undefined values", () => {
    const params = toURLSearchParams({ q: "test", page: undefined });
    assert.equal(params.get("q"), "test");
    assert.equal(params.get("page"), null);
  });

  it("skips empty string values", () => {
    const params = toURLSearchParams({ q: "test", empty: "" });
    assert.equal(params.get("q"), "test");
    assert.equal(params.get("empty"), null);
  });

  it("skips empty array values", () => {
    const params = toURLSearchParams({ q: "test", tags: [] as string[] });
    assert.equal(params.get("q"), "test");
    assert.equal(params.get("tags"), null);
  });

  it("handles empty object", () => {
    const params = toURLSearchParams({});
    assert.equal(params.toString(), "");
  });

  it("handles array with first empty string", () => {
    const params = toURLSearchParams({ q: "test", tags: ["", "b"] });
    assert.equal(params.get("q"), "test");
    assert.equal(params.get("tags"), null); // first element is empty → skipped
  });
});

describe("url.ts — spStr()", () => {
  it("returns string value", () => {
    assert.equal(spStr({ q: "test" }, "q"), "test");
  });

  it("returns first element of string[]", () => {
    assert.equal(spStr({ tags: ["a", "b"] }, "tags"), "a");
  });

  it("returns empty string for undefined", () => {
    assert.equal(spStr({ q: "test" }, "page"), "");
  });

  it("returns empty string for missing key", () => {
    assert.equal(spStr({}, "q"), "");
  });

  it("returns empty string for empty array", () => {
    assert.equal(spStr({ tags: [] as string[] }, "tags"), "");
  });

  it("returns empty string for empty string", () => {
    assert.equal(spStr({ q: "" }, "q"), "");
  });
});
