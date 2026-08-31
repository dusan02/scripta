/**
 * Unit tests for src/lib/sources.ts — SOURCES, ENABLED_SOURCES, SOURCE_MAP, etc.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SOURCES,
  ENABLED_SOURCES,
  SOURCE_IDS,
  SOURCE_MAP,
  DEFAULT_SELECTED_SOURCES,
  SOURCE_CATEGORIES,
  MANUAL_LOOKUP_URLS,
  SOURCE_DOT_COLOR,
} from "@/lib/sources";

describe("sources.ts — SOURCES", () => {
  it("has >20 sources defined", () => {
    assert.ok(SOURCES.length >= 20, `Expected ≥20 sources, got ${SOURCES.length}`);
  });

  it("all sources have unique IDs", () => {
    const ids = SOURCES.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, "Duplicate source IDs found");
  });

  it("all sources have required fields", () => {
    for (const s of SOURCES) {
      assert.ok(s.id, `Source missing id`);
      assert.ok(s.name, `Source ${s.id} missing name`);
      assert.ok(s.short, `Source ${s.id} missing short`);
      assert.ok(s.description, `Source ${s.id} missing description`);
      assert.ok(s.label, `Source ${s.id} missing label`);
      assert.ok(s.sublabel, `Source ${s.id} missing sublabel`);
      assert.ok(s.category, `Source ${s.id} missing category`);
      assert.equal(typeof s.enabled, "boolean", `Source ${s.id} enabled must be boolean`);
    }
  });

  it("all source categories exist in SOURCE_CATEGORIES", () => {
    const catIds = new Set(SOURCE_CATEGORIES.map(c => c.id));
    for (const s of SOURCES) {
      assert.ok(catIds.has(s.category), `Source ${s.id} has unknown category: ${s.category}`);
    }
  });
});

describe("sources.ts — ENABLED_SOURCES", () => {
  it("contains only enabled sources", () => {
    for (const s of ENABLED_SOURCES) {
      assert.equal(s.enabled, true, `Disabled source ${s.id} in ENABLED_SOURCES`);
    }
  });

  it("is a subset of SOURCES", () => {
    assert.ok(ENABLED_SOURCES.length <= SOURCES.length);
  });

  it("has at least 15 enabled sources", () => {
    assert.ok(ENABLED_SOURCES.length >= 15, `Expected ≥15 enabled, got ${ENABLED_SOURCES.length}`);
  });
});

describe("sources.ts — SOURCE_IDS", () => {
  it("is a non-empty array of strings", () => {
    assert.ok(SOURCE_IDS.length > 0);
    for (const id of SOURCE_IDS) {
      assert.equal(typeof id, "string");
    }
  });

  it("matches ENABLED_SOURCES IDs", () => {
    assert.deepEqual(
      [...SOURCE_IDS],
      ENABLED_SOURCES.map(s => s.id),
    );
  });
});

describe("sources.ts — SOURCE_MAP", () => {
  it("contains all sources (including disabled)", () => {
    for (const s of SOURCES) {
      assert.ok(SOURCE_MAP[s.id], `Source ${s.id} missing from SOURCE_MAP`);
      assert.equal(SOURCE_MAP[s.id].id, s.id);
    }
  });

  it("lookup by ID returns correct source", () => {
    assert.equal(SOURCE_MAP["ORSR"].name, "Obchodný register SR");
    assert.equal(SOURCE_MAP["INSOLVENCY"].category, "risk");
  });
});

describe("sources.ts — DEFAULT_SELECTED_SOURCES", () => {
  it("contains all enabled source IDs", () => {
    assert.deepEqual(
      [...DEFAULT_SELECTED_SOURCES].sort(),
      [...ENABLED_SOURCES.map(s => s.id)].sort(),
    );
  });

  it("does not contain disabled sources", () => {
    for (const id of DEFAULT_SELECTED_SOURCES) {
      const source = SOURCE_MAP[id];
      assert.ok(source, `Unknown source ID in defaults: ${id}`);
      assert.equal(source.enabled, true, `Disabled source ${id} in defaults`);
    }
  });
});

describe("sources.ts — SOURCE_CATEGORIES", () => {
  it("has 6 categories", () => {
    assert.equal(SOURCE_CATEGORIES.length, 6);
  });

  it("all categories have id and label", () => {
    for (const c of SOURCE_CATEGORIES) {
      assert.ok(c.id, "Category missing id");
      assert.ok(c.label, "Category missing label");
    }
  });

  it("has unique category IDs", () => {
    const ids = SOURCE_CATEGORIES.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("sources.ts — MANUAL_LOOKUP_URLS", () => {
  it("has URL for every source", () => {
    for (const s of SOURCES) {
      assert.ok(MANUAL_LOOKUP_URLS[s.id], `Source ${s.id} missing manual lookup URL`);
      assert.ok(MANUAL_LOOKUP_URLS[s.id].startsWith("https://"), `URL for ${s.id} must be HTTPS`);
    }
  });
});

describe("sources.ts — SOURCE_DOT_COLOR", () => {
  it("has colors for all statuses", () => {
    for (const status of ["SUCCESS", "UNAVAILABLE", "FAILED", "PENDING", "PROCESSING"]) {
      assert.ok(SOURCE_DOT_COLOR[status], `Missing color for status ${status}`);
    }
  });

  it("uses CSS variables", () => {
    for (const [, color] of Object.entries(SOURCE_DOT_COLOR)) {
      assert.ok(color.startsWith("var(--"), `Color should be CSS variable: ${color}`);
    }
  });
});
