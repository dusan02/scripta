/**
 * Security regression tests across Next.js API route handlers (P0.2).
 * Ensures no debug endpoints or raw secret prefix disclosures exist in src/app/api.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const API_ROOT = path.resolve(process.cwd(), "src/app/api");

function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkRoutes(full));
    } else if (entry.isFile() && /\.(ts|tsx|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("API route security hygiene", () => {
  it("does not expose /api/billing/debug or any */debug/* route handler", () => {
    const debugRoute = path.join(API_ROOT, "billing/debug/route.ts");
    assert.equal(fs.existsSync(debugRoute), false, "/api/billing/debug/route.ts must be removed");

    const allRoutes = walkRoutes(API_ROOT);
    const anyDebug = allRoutes.filter((f) => /(?:^|\/)debug(?:\/|$)/i.test(path.relative(API_ROOT, f)));
    assert.deepEqual(anyDebug, [], "No unguarded debug API routes allowed");
  });

  it("never slices or logs secret/API-key env prefixes into HTTP responses", () => {
    const allRoutes = walkRoutes(API_ROOT);
    const leakyPattern = /process\.env\.[A-Z0-9_]*(KEY|SECRET|TOKEN)[A-Z0-9_]*\.(substring|slice)\(/;
    const offenders = allRoutes.filter((f) => leakyPattern.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(offenders, [], "No route may expose secret/key substrings");
  });
});
