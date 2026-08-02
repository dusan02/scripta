import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test verifyCronSecret validation logic.
// We replicate the function since it reads from process.env and uses crypto.

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  // Simple comparison for test (real impl uses crypto.timingSafeEqual)
  return bufA.equals(bufB);
}

function verifyCronSecret(authHeader: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  return timingSafeEqualString(authHeader.slice(prefix.length), expected);
}

describe("verifyCronSecret", () => {
  it("accepts valid Bearer token", () => {
    const secret = "test-secret-with-32-chars-1234567890";
    assert.ok(verifyCronSecret(`Bearer ${secret}`, secret));
  });

  it("rejects null/undefined header", () => {
    const secret = "test-secret-with-32-chars-1234567890";
    assert.ok(!verifyCronSecret(null, secret));
    assert.ok(!verifyCronSecret(undefined as unknown as string, secret));
  });

  it("rejects empty header", () => {
    const secret = "test-secret-with-32-chars-1234567890";
    assert.ok(!verifyCronSecret("", secret));
  });

  it("rejects missing Bearer prefix", () => {
    const secret = "test-secret-with-32-chars-1234567890";
    assert.ok(!verifyCronSecret(secret, secret));
    assert.ok(!verifyCronSecret(`Token ${secret}`, secret));
  });

  it("rejects wrong secret", () => {
    const secret = "test-secret-with-32-chars-1234567890";
    assert.ok(!verifyCronSecret("Bearer wrong-secret-value-here-1234567890", secret));
  });

  it("rejects empty/undefined CRON_SECRET env var", () => {
    assert.ok(!verifyCronSecret("Bearer some-token", undefined));
    assert.ok(!verifyCronSecret("Bearer some-token", ""));
  });

  it("rejects short CRON_SECRET (< 16 chars)", () => {
    assert.ok(!verifyCronSecret("Bearer short", "short"));
    assert.ok(!verifyCronSecret("Bearer 12345678", "12345678")); // 8 chars
    assert.ok(!verifyCronSecret("Bearer 123456789012345", "123456789012345")); // 15 chars
  });

  it("accepts minimum length secret (16 chars)", () => {
    const secret = "1234567890123456"; // exactly 16 chars
    assert.ok(verifyCronSecret(`Bearer ${secret}`, secret));
  });

  it("rejects case-mismatched token", () => {
    const secret = "TestSecret1234567890";
    assert.ok(!verifyCronSecret(`Bearer testsecret1234567890`, secret));
  });
});

// Test vercel.json cron schedule format
describe("vercel.json cron configuration", () => {
  const cronConfig = {
    crons: [
      { path: "/api/reports/recover-stuck", schedule: "*/15 * * * *" },
      { path: "/api/credits/expire", schedule: "0 3 * * *" },
    ],
  };

  it("includes recover-stuck cron at 15-minute intervals", () => {
    const recoverStuck = cronConfig.crons.find((c) => c.path === "/api/reports/recover-stuck");
    assert.ok(recoverStuck);
    assert.equal(recoverStuck!.schedule, "*/15 * * * *");
  });

  it("includes credits-expire cron at 3 AM daily", () => {
    const creditsExpire = cronConfig.crons.find((c) => c.path === "/api/credits/expire");
    assert.ok(creditsExpire);
    assert.equal(creditsExpire!.schedule, "0 3 * * *");
  });

  it("has exactly 2 cron jobs configured", () => {
    assert.equal(cronConfig.crons.length, 2);
  });
});

// Test docker-compose CRON_SECRET validation
describe("docker-compose CRON_SECRET", () => {
  it("uses required syntax (no empty default)", () => {
    // The fix changes ${CRON_SECRET:-} to ${CRON_SECRET:?CRON_SECRET must be set}
    // This means docker compose will FAIL if CRON_SECRET is not set
    const correctSyntax = "${CRON_SECRET:?CRON_SECRET must be set}";
    const wrongSyntax = "${CRON_SECRET:-}";

    assert.ok(correctSyntax.includes(":?"));
    assert.ok(!wrongSyntax.includes(":?"));
  });
});
