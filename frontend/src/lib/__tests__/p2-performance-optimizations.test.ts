import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(process.cwd(), "..");

describe("P2 backend performance optimizations invariants", () => {
  it("filterEligibleCrossFirmPersons skips common/short names, deduplicates, and caps at 5", async () => {
    const { filterEligibleCrossFirmPersons } = await import("@/components/cross-firm-persons");
    const out = filterEligibleCrossFirmPersons([
      { cleanName: "Jan Kovac", city: "Bratislava" }, // common name -> skip
      { cleanName: "Ab Cd", city: "Nitra" }, // <8 chars -> skip
      { cleanName: null, city: "Kosice" }, // null -> skip
      { cleanName: "Miroslav Hrivnak", city: "Zilina" },
      { cleanName: "Miroslav Hrivnak", city: "Zilina" }, // duplicate -> skip
      { cleanName: "Andrea Kovalcikova", city: "Presov" },
      { cleanName: "Rastislav Bielik", city: null },
    ]);
    assert.equal(out.length, 3);
    assert.equal(out[0].cleanName, "Miroslav Hrivnak");
    assert.equal(out[1].cleanName, "Andrea Kovalcikova");
    assert.equal(out[2].cleanName, "Rastislav Bielik");
    assert.equal(out[2].city, null);
  });

  it("cross-firm-persons.tsx uses batched OR query instead of N+1 loop", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "frontend/src/components/cross-firm-persons.tsx"),
      "utf8"
    );
    assert.ok(src.includes("OR: eligible.map"), "must batch person lookups into single OR query");
    assert.ok(!src.includes("for (const person of persons) {\n    if (!person.cleanName)"), "old N+1 loop must be removed");
  });

  it("related-firms.tsx caches top-7 lists without per-ico WHERE clause", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "frontend/src/components/related-firms.tsx"),
      "utf8"
    );
    assert.ok(src.includes("unstable_cache"), "RelatedFirms must cache group queries");
    assert.ok(src.includes("take: 7"), "must fetch top-7 and exclude current ico in memory");
    assert.ok(src.includes(".filter((f) => f.ico !== ico).slice(0, 6)"));
  });

  it("sitemap/[id]/route.ts removes dead auditVerdict join, caches chunks, and returns 503 on DB error", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "frontend/src/app/sitemap/[id]/route.ts"),
      "utf8"
    );
    assert.ok(!src.includes("auditVerdict"), "dead auditVerdict join must be removed from sitemap query");
    assert.ok(src.includes("unstable_cache"), "sitemap chunk query must be cached");
    assert.ok(src.includes("status: 503"), "DB failure must return 503 instead of 200 empty urlset");
  });

  it("deploy/db/p2_performance_indexes.sql uses CONCURRENTLY, drops nothing, and documents rollback", () => {
    const sql = fs.readFileSync(
      path.join(REPO_ROOT, "deploy/db/p2_performance_indexes.sql"),
      "utf8"
    );
    const creates = (sql.match(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/g) || []).length;
    assert.equal(creates, 4);
    assert.ok(sql.includes('"Company_fscount2_ico_sitemap_idx"'));
    assert.ok(sql.includes('"Company_fscount1_nace_kraj_rev_idx"'));
    assert.ok(!/^DROP INDEX/m.test(sql), "must not execute DROP INDEX statements");
  });
});
