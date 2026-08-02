import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the S3 key validation logic in isolation.
// We replicate the pattern here since it's a module-internal function
// not exported from the route file (Next.js API routes don't export helpers).

const S3_KEY_PATTERN = /^reports\/[a-zA-Z0-9]{20,40}\/[a-zA-Z0-9._-]+$/;

function isValidS3Key(key: string): boolean {
  if (!key || key.length > 512) return false;
  if (key.includes("..") || key.includes("\0")) return false;
  return S3_KEY_PATTERN.test(key);
}

describe("S3 key validation", () => {
  it("accepts valid S3 keys", () => {
    assert.ok(isValidS3Key("reports/cmqmyyfix000aegmcy4x7e5cl/evidence_binder.pdf"));
    assert.ok(isValidS3Key("reports/abc123def456ghi789jkl012/report.pdf"));
    assert.ok(isValidS3Key("reports/cmqmyyfix000aegmcy4x7e5cl/my-report.final.pdf"));
  });

  it("rejects path traversal attempts", () => {
    assert.ok(!isValidS3Key("reports/../../../etc/passwd"));
    assert.ok(!isValidS3Key("reports/..%2F..%2F/etc/passwd"));
    assert.ok(!isValidS3Key("reports/valid_id/../../../etc/passwd"));
    assert.ok(!isValidS3Key("reports/valid_id/../../other_report/file.pdf"));
  });

  it("rejects null bytes", () => {
    assert.ok(!isValidS3Key("reports/valid_id/file\0.pdf"));
    assert.ok(!isValidS3Key("reports/valid\0id/file.pdf"));
  });

  it("rejects empty or null keys", () => {
    assert.ok(!isValidS3Key(""));
    assert.ok(!isValidS3Key(null as unknown as string));
    assert.ok(!isValidS3Key(undefined as unknown as string));
  });

  it("rejects keys that are too long", () => {
    const longKey = "reports/" + "a".repeat(20) + "/" + "b".repeat(500);
    assert.ok(!isValidS3Key(longKey));
  });

  it("rejects keys with invalid report_request_id format", () => {
    assert.ok(!isValidS3Key("reports/short/file.pdf"));
    assert.ok(!isValidS3Key("reports/way-too-long-id-that-is-not-a-valid-cuid/file.pdf"));
    assert.ok(!isValidS3Key("reports/contains spaces/file.pdf"));
    assert.ok(!isValidS3Key("reports/contains-slashes/in-here/file.pdf"));
  });

  it("rejects keys with special characters in filename", () => {
    assert.ok(!isValidS3Key("reports/abc123def456ghi789jkl012/file with spaces.pdf"));
    assert.ok(!isValidS3Key("reports/abc123def456ghi789jkl012/file\"quote.pdf"));
    assert.ok(!isValidS3Key("reports/abc123def456ghi789jkl012/file;semicolon.pdf"));
  });

  it("rejects keys not starting with reports/", () => {
    assert.ok(!isValidS3Key("other/cmqmyyfix000aegmcy4x7e5cl/file.pdf"));
    assert.ok(!isValidS3Key("cmqmyyfix000aegmcy4x7e5cl/file.pdf"));
    assert.ok(!isValidS3Key("/reports/cmqmyyfix000aegmcy4x7e5cl/file.pdf"));
  });
});
