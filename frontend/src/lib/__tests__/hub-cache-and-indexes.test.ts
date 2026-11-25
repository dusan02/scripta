import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(process.cwd(), "..");

describe("P0.3 selective port invariants (DB partial indexes & hub caching)", () => {
  it("Company partial covering index SQL uses CONCURRENTLY and fsCount >= 2 predicate", () => {
    const sql = fs.readFileSync(
      path.join(REPO_ROOT, "deploy/db/p0_3_company_partial_indexes.sql"),
      "utf8"
    );
    const createCount = (sql.match(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/g) || []).length;
    assert.equal(createCount, 4);
    assert.ok(sql.includes('WHERE "fsCount" >= 2'));
    assert.ok(sql.includes('"Company_fscount2_kraj_stats_idx"'));
    assert.ok(sql.includes('"Company_fscount2_okres_stats_idx"'));
    assert.ok(sql.includes('"Company_fscount2_city_stats_idx"'));
    assert.ok(sql.includes('"Company_fscount2_nace_stats_idx"'));
  });

  it("hub.ts normalizes cache keys deterministically regardless of property insertion order", async () => {
    const { normalizeHubCacheKey } = await import("@/lib/hub");
    const k1 = normalizeHubCacheKey({ kraj: "SK010", section: "J" }, 1);
    const k2 = normalizeHubCacheKey({ section: "J", kraj: "SK010" }, 1);
    assert.equal(k1, k2);
    assert.notEqual(k1, normalizeHubCacheKey({ section: "J", kraj: "SK010" }, 2));
  });
});
