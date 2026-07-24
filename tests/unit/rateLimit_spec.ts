/**
 * Unit testy pre rateLimit.ts — in-memory fallback logika.
 *
 * Testuje:
 * - rateLimitByKey: prvé volanie povolené, exhausted po maxRequests, reset po window
 * - different keys independent
 * - remaining decrements
 * - resetTime in the future
 * - rateLimitResponse: 429 status, headers
 * - rateLimit via NextRequest: IP extraction
 *
 * Spustenie: npx ts-node --compiler-options '{"module":"CommonJS"}' tests/unit/rateLimit_spec.ts
 */

// Mock Next.js globals before requiring the module
const mockJson = (body: any, init?: { status?: number; headers?: Record<string, string> }) => ({
  status: init?.status ?? 200,
  headers: new Map(Object.entries(init?.headers ?? {})),
  json: () => body,
});

(global as any).NextResponse = { json: mockJson };

class MockNextRequest {
  headers: Map<string, string>;
  constructor(headers: Record<string, string> = {}) {
    this.headers = new Map(Object.entries(headers));
  }
  get(header: string) { return this.headers.get(header); }
}
(global as any).NextRequest = MockNextRequest;

const { rateLimitByKey, rateLimitResponse, rateLimit } = require("../../frontend/src/lib/rateLimit.ts");

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
};

const assertEq = <T>(actual: T, expected: T, message: string) => {
  if (actual !== expected) throw new Error(`FAIL: ${message} — expected ${expected}, got ${actual}`);
  console.log(`  ✓ ${message}`);
};

async function runTests() {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
    } catch (e: any) {
      failed++;
      console.error(`✗ ${name}: ${e.message}`);
    }
  };

  console.log("\n── rateLimit.ts unit tests ──\n");

  // ── rateLimitByKey: basic ──────────────────────────────────────────────────

  await test("first request allowed", async () => {
    const key = `test:first:${Date.now()}`;
    const result = await rateLimitByKey(key, { windowMs: 1000, maxRequests: 5 });
    assert(result.allowed === true, "should be allowed");
    assertEq(result.remaining, 4, "remaining should be 4");
  });

  await test("exhaust requests then blocked", async () => {
    const key = `test:exhaust:${Date.now()}`;
    const opts = { windowMs: 5000, maxRequests: 3 };
    const r1 = await rateLimitByKey(key, opts);
    const r2 = await rateLimitByKey(key, opts);
    const r3 = await rateLimitByKey(key, opts);
    const r4 = await rateLimitByKey(key, opts);
    assert(r1.allowed && r2.allowed && r3.allowed, "first 3 should be allowed");
    assert(r4.allowed === false, "4th should be blocked");
    assertEq(r4.remaining, 0, "remaining should be 0");
  });

  await test("different keys independent", async () => {
    const ts = Date.now();
    const key1 = `test:indep1:${ts}`;
    const key2 = `test:indep2:${ts}`;
    const opts = { windowMs: 5000, maxRequests: 2 };
    await rateLimitByKey(key1, opts);
    await rateLimitByKey(key1, opts);
    const r1 = await rateLimitByKey(key1, opts);
    const r2 = await rateLimitByKey(key2, opts);
    assert(r1.allowed === false, "key1 should be exhausted");
    assert(r2.allowed === true, "key2 should be independent");
  });

  await test("window reset allows again", async () => {
    const key = `test:reset:${Date.now()}`;
    const opts = { windowMs: 100, maxRequests: 1 };
    const r1 = await rateLimitByKey(key, opts);
    assert(r1.allowed === true, "first should be allowed");
    const r2 = await rateLimitByKey(key, opts);
    assert(r2.allowed === false, "second should be blocked");
    await new Promise(resolve => setTimeout(resolve, 150));
    const r3 = await rateLimitByKey(key, opts);
    assert(r3.allowed === true, "should be allowed after window reset");
  });

  await test("remaining decrements correctly", async () => {
    const key = `test:decrement:${Date.now()}`;
    const opts = { windowMs: 5000, maxRequests: 5 };
    const r1 = await rateLimitByKey(key, opts);
    const r2 = await rateLimitByKey(key, opts);
    const r3 = await rateLimitByKey(key, opts);
    assertEq(r1.remaining, 4, "first: remaining 4");
    assertEq(r2.remaining, 3, "second: remaining 3");
    assertEq(r3.remaining, 2, "third: remaining 2");
  });

  await test("resetTime is in the future", async () => {
    const key = `test:resettime:${Date.now()}`;
    const now = Date.now();
    const result = await rateLimitByKey(key, { windowMs: 5000, maxRequests: 3 });
    assert(result.resetTime > now, "resetTime should be in the future");
    assert(result.resetTime <= now + 5100, "resetTime should be within window + buffer");
  });

  // ── rateLimitResponse ──────────────────────────────────────────────────────

  await test("rateLimitResponse returns 429", async () => {
    const result = rateLimitResponse({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 5000,
    });
    assertEq(result.status, 429, "status should be 429");
    const retryAfter = result.headers.get("Retry-After");
    assert(retryAfter !== null, "Retry-After header should exist");
    const xRemaining = result.headers.get("X-RateLimit-Remaining");
    assertEq(xRemaining, "0", "X-RateLimit-Remaining should be 0");
  });

  await test("rateLimitResponse includes error message", async () => {
    const result = rateLimitResponse({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 5000,
    });
    const body = await result.json();
    assert(body !== null && body !== undefined, "json() should return a body");
    assert(body.error !== undefined, "body should have error field");
    assert(typeof body.error === "string", "error should be a string");
  });

  await test("rateLimitResponse Retry-After is positive", async () => {
    const result = rateLimitResponse({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 10000,
    });
    const retryAfter = parseInt(result.headers.get("Retry-After") ?? "0", 10);
    assert(retryAfter > 0, "Retry-After should be positive");
    assert(retryAfter <= 10, "Retry-After should be <= 10 seconds");
  });

  // ── rateLimit (via NextRequest) ────────────────────────────────────────────

  await test("rateLimit extracts IP from x-forwarded-for", async () => {
    const req = new MockNextRequest({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    const result = await rateLimit(req, { windowMs: 5000, maxRequests: 100 });
    assert(result.allowed === true, "should be allowed for new IP");
    assert(typeof result.remaining === "number", "remaining should be a number");
  });

  await test("rateLimit falls back to x-real-ip", async () => {
    const req = new MockNextRequest({ "x-real-ip": "10.0.0.1" });
    const result = await rateLimit(req, { windowMs: 5000, maxRequests: 100 });
    assert(result.allowed === true, "should be allowed for new IP");
  });

  await test("rateLimit falls back to unknown", async () => {
    const req = new MockNextRequest({});
    const result = await rateLimit(req, { windowMs: 5000, maxRequests: 100 });
    assert(result.allowed === true, "should be allowed even with unknown IP");
  });

  await test("rateLimit with x-forwarded-for uses first IP", async () => {
    const req = new MockNextRequest({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    const r1 = await rateLimit(req, { windowMs: 5000, maxRequests: 2 });
    const r2 = await rateLimit(req, { windowMs: 5000, maxRequests: 2 });
    assertEq(r1.remaining, 1, "first: remaining 1");
    assertEq(r2.remaining, 0, "second: remaining 0");
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(console.error);
