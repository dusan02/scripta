/**
 * Unit tests for src/lib/rateLimit.ts — in-memory rate limiting fallback.
 *
 * Tests the memRateLimit logic via rateLimitByKey() when no Redis is configured.
 * Upstash and local Redis are disabled by unsetting their env vars.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Ensure no Redis is configured → forces in-memory fallback
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.REDIS_URL;

import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

describe("rateLimit.ts — rateLimitByKey (in-memory)", () => {
  it("allows first request", async () => {
    const result = await rateLimitByKey("test-first", { windowMs: 60000, maxRequests: 5 });
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 4);
  });

  it("blocks after exceeding maxRequests", async () => {
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await rateLimitByKey(key, { windowMs: 60000, maxRequests: 3 });
    }
    const result = await rateLimitByKey(key, { windowMs: 60000, maxRequests: 3 });
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
  });

  it("counts down remaining correctly", async () => {
    const key = `test-count-${Date.now()}`;
    const r1 = await rateLimitByKey(key, { windowMs: 60000, maxRequests: 5 });
    assert.equal(r1.remaining, 4);
    const r2 = await rateLimitByKey(key, { windowMs: 60000, maxRequests: 5 });
    assert.equal(r2.remaining, 3);
    const r3 = await rateLimitByKey(key, { windowMs: 60000, maxRequests: 5 });
    assert.equal(r3.remaining, 2);
  });

  it("uses separate counters for different keys", async () => {
    const ts = Date.now();
    await rateLimitByKey(`key-a-${ts}`, { windowMs: 60000, maxRequests: 2 });
    await rateLimitByKey(`key-a-${ts}`, { windowMs: 60000, maxRequests: 2 });

    const resultB = await rateLimitByKey(`key-b-${ts}`, { windowMs: 60000, maxRequests: 2 });
    assert.equal(resultB.allowed, true);
    assert.equal(resultB.remaining, 1); // First request for key-b
  });

  it("respects different window sizes as separate keys", async () => {
    const ts = Date.now();
    // Same base key but different window → should be tracked separately
    const r1 = await rateLimitByKey(`same-key-${ts}`, { windowMs: 10000, maxRequests: 1 });
    const r2 = await rateLimitByKey(`same-key-${ts}`, { windowMs: 20000, maxRequests: 1 });
    // Different windowMs → different internal key → both allowed
    assert.equal(r1.allowed, true);
    assert.equal(r2.allowed, true);
  });

  it("resetTime is in the future", async () => {
    const now = Date.now();
    const result = await rateLimitByKey(`test-reset-${now}`, { windowMs: 5000, maxRequests: 1 });
    assert.ok(result.resetTime > now);
    assert.ok(result.resetTime <= now + 6000);
  });
});

describe("rateLimit.ts — rateLimitResponse()", () => {
  it("returns 429 status", async () => {
    const result = { allowed: false, remaining: 0, resetTime: Date.now() + 5000 };
    const response = rateLimitResponse(result);
    assert.equal(response.status, 429);
  });

  it("includes Retry-After header", async () => {
    const result = { allowed: false, remaining: 0, resetTime: Date.now() + 5000 };
    const response = rateLimitResponse(result);
    const retryAfter = response.headers.get("Retry-After");
    assert.ok(retryAfter);
    assert.ok(parseInt(retryAfter!, 10) > 0);
  });

  it("includes X-RateLimit headers", async () => {
    const result = { allowed: false, remaining: 0, resetTime: Date.now() + 5000 };
    const response = rateLimitResponse(result);
    assert.ok(response.headers.get("X-RateLimit-Remaining"));
    assert.ok(response.headers.get("X-RateLimit-Reset"));
  });

  it("returns JSON error body", async () => {
    const result = { allowed: false, remaining: 0, resetTime: Date.now() + 5000 };
    const response = rateLimitResponse(result);
    const body = await response.json();
    assert.ok(body.error);
    assert.ok(typeof body.error === "string");
  });
});
